// ADR-094: bounded repair of the fixes the milestone full check opened. The loop that edits code is an
// agent (commands/astro-verify-milestone.md); everything that must be exact lives here, in code, so an
// overnight run can neither grind forever nor call a fix repaired on its own say-so:
// - only a check-created fix (`fullcheck_from`) is repairable: a human-deferred or plain fix has no stored
//   command that re-checks it, and repairing it would invent one;
// - at most `verify.repair_attempts` attempts per fix (`repair_attempts` counts them on the fix): past the
//   limit `repairFix` runs NOTHING and says `exhausted`, so a stuck fix cannot burn the night;
// - "fixed" means the fix's own re-check command (`fullcheck_from.command`) exits 0 at HEAD, never the
//   agent's claim. The fix becomes `verified` (the lifecycle: the reproduction passes), and a human still
//   accepts it;
// - every attempt commits `fixes.json` path-limited, so the tree is clean for the re-check that follows
//   (a dirty tree could never pass the close gate).
import { spawnSync } from 'node:child_process';
import { git } from './git.mjs';
import { paths } from './paths.mjs';
import { resolveFix, setFixStatus, fullCheckFixes } from './fixes.mjs';
import { repairAttempts } from './config.mjs';

/**
 * One repair attempt. Returns `{ id, attempt, limit, passed, exhausted }`; throws for an unknown, deferred
 * or plain fix (those are not check-created).
 */
export async function repairFix(root, ref, { spawn = spawnSync } = {}) {
  const { fix, ambiguous } = resolveFix(root, ref);
  if (ambiguous) throw new Error(`"${ref}" matches more than one fix: ${ambiguous.join(', ')}`);
  if (!fix) throw new Error(`no such fix: ${ref}`);
  if (!fix.fullcheck_from) throw new Error(`fix ${fix.id} was not opened by the milestone full check — only check-created fixes are repaired here`);
  const limit = repairAttempts(root, []);
  const used = fix.repair_attempts ?? 0;
  if (used >= limit) return { id: fix.id, attempt: used, limit, passed: false, exhausted: true };
  const attempt = used + 1;
  const res = spawn(fix.fullcheck_from.command, { shell: true, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const passed = (res?.status ?? 1) === 0;
  const head = git(['rev-parse', 'HEAD'], { cwd: root }).stdout?.trim() ?? null;
  await setFixStatus(root, fix.id, passed ? 'verified' : fix.status, {
    repair_attempts: attempt,
    last_repair: { attempt, commit: head, passed, at: new Date().toISOString() },
  });
  const file = paths(root).fixes;
  const add = git(['add', '--', file], { cwd: root });
  if (add.status === 0) git(['commit', '-m', `chore(fullcheck): repair ${fix.id} attempt ${attempt} — ${passed ? 'fixed' : 'still failing'}`, '--', file], { cwd: root });
  return { id: fix.id, attempt, limit, passed, exhausted: false };
}

/** The morning report data: `{ fixed: [{id,title}], open: [{id,title,status,attempts,limit}] }`. */
export function repairReport(root, { milestone } = {}) {
  const limit = repairAttempts(root, []);
  const all = fullCheckFixes(root, { milestone });
  return {
    fixed: all.filter((f) => f.status === 'verified').map((f) => ({ id: f.id, title: f.title })),
    open: all.filter((f) => f.status !== 'verified').map((f) => ({ id: f.id, title: f.title, status: f.status, attempts: f.repair_attempts ?? 0, limit })),
  };
}
