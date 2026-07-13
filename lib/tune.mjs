// `ac tune` — apply astro-recommended Claude Code settings to a settings.json,
// additively and reversibly (the same contract as the install hooks wiring).
//
// Scope: ONLY officially supported settings.json keys. The /config panel's
// internal-only entries (auto-compact, dynamic workflows, notifications, UI
// preferences…) live in ~/.claude.json / feature flags where programmatic writes
// are unsupported and version-fragile — tune never touches them, it just names them.
//
// Reversibility: every write is recorded in ~/.astro/code/tune.json keyed by the
// settings file path — exactly which allow-entries were ADDED and which keys were
// SET (only ones that were absent). `ac tune --undo` removes precisely those and
// nothing else, so user-authored config always survives a tune/undo round-trip.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readJSON, atomicWriteJSON } from './util.mjs';

const manifestFile = () => join(homedir(), '.astro', 'code', 'tune.json');

// Fewer permission prompts during the astro loop on machines NOT running Bypass
// Permissions: the `ac` CLI, the test runner, and read-only git. Deliberately
// conservative — nothing here mutates the repo or reaches the network.
export const TUNE_ALLOW = [
  'Bash(ac *)',
  'Bash(node --test*)',
  'Bash(git status*)',
  'Bash(git log*)',
  'Bash(git diff*)',
  'Bash(git show*)',
  'Bash(git branch*)',
];

// Correctness-first posture, set ONLY when the user hasn't chosen a value —
// a deliberate user setting (even the opposite one) is never overridden.
export const TUNE_DEFAULTS = {
  alwaysThinkingEnabled: true, // thinking mode on for plan/verify-grade reasoning
  fastMode: false,             // speed must never silently cost correctness
};

// /config entries tune deliberately does NOT touch (internal-only storage).
export const UNTUNABLE = [
  'Auto-compact', 'Dynamic workflows / Ultracode / workflow size', 'Artifacts',
  'Checkpoints', 'Notifications (local/push)', 'Tips / progress bar / turn duration',
  'Copy-on-select / auto-scroll / agents view', 'Chrome / Remote Control',
];

export function applyTune(settingsFile) {
  const existed = existsSync(settingsFile);
  const data = readJSON(settingsFile) || {};
  const added = { allow: [], keys: [], created: !existed };

  data.permissions ??= {};
  data.permissions.allow ??= [];
  for (const entry of TUNE_ALLOW) {
    if (!data.permissions.allow.includes(entry)) {
      data.permissions.allow.push(entry);
      added.allow.push(entry);
    }
  }
  for (const [key, value] of Object.entries(TUNE_DEFAULTS)) {
    if (!(key in data)) {
      data[key] = value;
      added.keys.push(key);
    }
  }

  atomicWriteJSON(settingsFile, data);
  const manifest = readJSON(manifestFile()) || {};
  manifest[settingsFile] = added;
  mkdirSync(dirname(manifestFile()), { recursive: true });
  atomicWriteJSON(manifestFile(), manifest);
  return { file: settingsFile, added, skippedAllow: TUNE_ALLOW.length - added.allow.length };
}

export function undoTune(settingsFile) {
  const manifest = readJSON(manifestFile()) || {};
  const added = manifest[settingsFile];
  if (!added) return { file: settingsFile, undone: false };
  const data = readJSON(settingsFile);
  if (data) {
    if (data.permissions?.allow) {
      data.permissions.allow = data.permissions.allow.filter((e) => !added.allow.includes(e));
      if (data.permissions.allow.length === 0) delete data.permissions.allow;
      if (Object.keys(data.permissions).length === 0) delete data.permissions;
    }
    for (const key of added.keys || []) delete data[key];
    // If tune CREATED this file and the undo emptied it, remove the file entirely —
    // a leftover `{}` reads as user config that never existed.
    if (added.created && Object.keys(data).length === 0) rmSync(settingsFile, { force: true });
    else atomicWriteJSON(settingsFile, data);
  }
  delete manifest[settingsFile];
  atomicWriteJSON(manifestFile(), manifest);
  return { file: settingsFile, undone: true, removed: added };
}

// Resolve the settings.json path for a tune scope.
//  - project: <projectRoot>/.claude/settings.json (committed — travels with the repo)
//  - user:    <baseConfigDir>/settings.json
export function tuneTarget(scope, { projectRoot, configDir } = {}) {
  if (scope === 'user') return join(configDir, 'settings.json');
  const dir = join(projectRoot, '.claude');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, 'settings.json');
}
