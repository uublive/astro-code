// Read-only environment detection for the `ac mutate` install hint (phase 48 D6, P12).
//
// Why it exists: the hint has to match how the project manages its environment. Waupaca's uv
// `.venv` had no pip, so `pip install mutmut` failed; a pnpm project wants `pnpm add -D`. And
// when the environment pins versions, a manual install may be dropped by the next sync, so the
// hint says so.
//
// Pure `fs` reads only. It never spawns a package manager (phase 47 P5: lookup never runs
// npm/pip/uv/go) and never writes, so `ac mutate` cannot change the environment (ADR-083).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (root, f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return null; } };
const has = (root, f) => existsSync(join(root, f));

/**
 * `{ node: { manager, via }, python: { installer, via, locked } }`.
 * `manager` is pnpm | yarn | npm; `installer` is uv-venv | pip; `locked` names the lock file of a
 * lock-managed Python environment (uv/poetry/pipenv), else null.
 */
export function detectEnv(root) {
  const node = has(root, 'pnpm-lock.yaml') ? { manager: 'pnpm', via: 'pnpm-lock.yaml' }
    : has(root, 'yarn.lock') ? { manager: 'yarn', via: 'yarn.lock' }
      : { manager: 'npm', via: has(root, 'package-lock.json') ? 'package-lock.json' : null };
  // A venv with an interpreter but no pip is uv's layout (`uv venv` installs no pip).
  let hasPip = false;
  try { hasPip = readdirSync(join(root, '.venv', 'bin')).some((n) => /^pip(\d|$)/.test(n)); } catch { /* no venv */ }
  const venv = has(root, join('.venv', 'bin', 'python'));
  const locked = ['uv.lock', 'poetry.lock', 'Pipfile.lock'].find((f) => has(root, f)) ?? null;
  const python = venv && !hasPip
    ? { installer: 'uv-venv', via: '.venv', locked }
    : { installer: 'pip', via: venv ? '.venv' : null, locked };
  return { node, python };
}

const PY_FILES = (root) => {
  const reqs = [];
  for (const dir of ['', 'requirements']) {
    try {
      for (const n of readdirSync(join(root, dir))) if (/^requirements.*\.txt$/.test(n) || (dir && n.endsWith('.txt'))) reqs.push(join(dir, n));
    } catch { /* no such dir */ }
  }
  return [...reqs.sort(), 'pyproject.toml', 'Pipfile'];
};
const PY_LOCKS = ['uv.lock', 'poetry.lock', 'Pipfile.lock'];
const NODE_LOCKS = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json'];
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where `pkg` is pinned in this project: `[{ file, spec }]`, `[]` when nowhere. "Pinned" means an
 * exact or bounded spec in a manifest, or any entry in a lock file for that ecosystem.
 */
export function pinsOf(root, pkg, ecosystem) {
  const out = [];
  const p = escRe(pkg);
  if (ecosystem === 'python') {
    const spec = new RegExp(`(?:^|[\\s"'])${p}(?:\\[[^\\]]*\\])?["']?\\s*=?\\s*["']?(===|==|>=|<=|~=|!=|<|>|\\^|~)\\s*([^\\s"',;]*)`, 'mi');
    for (const f of PY_FILES(root)) {
      const m = spec.exec(read(root, f) ?? '');
      if (m) out.push({ file: f, spec: `${m[1]}${m[2]}` });
    }
    for (const f of PY_LOCKS) {
      const t = read(root, f);
      if (t === null) continue;
      if (new RegExp(`name\\s*=\\s*"${p}"|"${p}"\\s*:`, 'i').test(t)) out.push({ file: f, spec: 'locked' });
    }
  } else if (ecosystem === 'node') {
    const t = read(root, 'package.json');
    if (t !== null) {
      try {
        const j = JSON.parse(t);
        for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
          if (j?.[k]?.[pkg] !== undefined) out.push({ file: 'package.json', spec: String(j[k][pkg]) });
        }
      } catch { /* a malformed manifest pins nothing we can read */ }
    }
    for (const f of NODE_LOCKS) if ((read(root, f) ?? '').includes(pkg)) out.push({ file: f, spec: 'locked' });
  } else if (ecosystem === 'go') {
    const line = (read(root, 'go.mod') ?? '').split('\n').find((l) => l.includes(pkg));
    if (line) out.push({ file: 'go.mod', spec: line.trim().split(/\s+/).pop() });
  }
  return out;
}
