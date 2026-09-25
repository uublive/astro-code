// Stack detection (P5, phase 25 CONTEXT D6): what language/framework tags a project
// carries, for the scope matcher in lib/principlebrief.mjs.
//
// ## Why manifests only, never a package manager or node_modules
//
// ADR-001 (zero deps) rules out shelling into `npm ls`/`pip show`/`cargo metadata` for
// the answer, and `node_modules` is a resolved, installed-machine artefact — its
// presence says nothing about what the PROJECT declares, only what happened to get
// installed on this checkout. A manifest at the project root is the one thing every
// contributor's checkout agrees on, uninstalled or not.
//
// ## Why the config override REPLACES rather than merges
//
// A monorepo root's manifest can legitimately lie about the stack a subproject cares
// about (a Python service living under a Node-tooled root, say). Merging would make
// that lie unfixable — the wrong tags would always be present alongside the right
// ones. Replacing means one `ac config set stack '[...]'` line fixes it outright.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';

/** manifest file -> the tag(s) its bare presence contributes (before any deps parsing). */
export const STACK_MANIFESTS = [
  { file: 'package.json', tags: ['node'] },
  { file: 'tsconfig.json', tags: ['typescript'] },
  { file: 'go.mod', tags: ['go'] },
  { file: 'Cargo.toml', tags: ['rust'] },
  { file: 'pyproject.toml', tags: ['python'] },
  { file: 'requirements.txt', tags: ['python'] },
  { file: 'setup.py', tags: ['python'] },
  { file: 'Pipfile', tags: ['python'] },
  { file: 'Gemfile', tags: ['ruby'] },
  { file: 'pom.xml', tags: ['java'] },
  { file: 'build.gradle', tags: ['java'] },
  { file: 'build.gradle.kts', tags: ['java'] },
  { file: 'composer.json', tags: ['php'] },
  { file: 'Package.swift', tags: ['swift'] },
  { file: 'mix.exs', tags: ['elixir'] },
  { file: 'deno.json', tags: ['deno'] },
];

/** package.json's dependencies + devDependencies keys, lowercased — never a throw. */
function packageJsonDepTags(path) {
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return Object.keys(deps).map((k) => k.toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Manifest presence at `root` only (P5). Returns `{ tags, sources }`, tags
 * deduplicated and sorted, `sources: [{ file, tags }]` naming which manifest
 * contributed which tags.
 *
 * @param {string} root
 * @returns {{ tags: string[], sources: { file: string, tags: string[] }[] }}
 */
export function detectStack(root) {
  const tagSet = new Set();
  const sources = [];
  for (const { file, tags } of STACK_MANIFESTS) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    let fileTags = [...tags];
    if (file === 'package.json') fileTags = [...new Set([...fileTags, ...packageJsonDepTags(path)])];
    for (const t of fileTags) tagSet.add(t);
    sources.push({ file, tags: fileTags });
  }
  return { tags: [...tagSet].sort(), sources };
}

/**
 * The project's stack: detection unless `.astrocode/config.json`'s `stack` key is
 * present and non-empty — an array or comma-separated string, lowercased — in which
 * case it REPLACES detection entirely (see module header). Config is only ever read
 * when `.astrocode/` exists, so a directory with no astro-code project pays no cost.
 *
 * @param {string} root
 * @returns {{ tags: string[], sources: { file: string, tags: string[] }[], override: boolean }}
 */
export function projectStack(root) {
  const detected = detectStack(root);
  if (!existsSync(join(root, '.astrocode'))) return { ...detected, override: false };

  const config = loadConfig(root) || {};
  const raw = config.stack;
  const list = Array.isArray(raw) ? raw
    : typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  if (!list.length) return { ...detected, override: false };

  return { tags: [...new Set(list.map((t) => String(t).toLowerCase()))], sources: detected.sources, override: true };
}
