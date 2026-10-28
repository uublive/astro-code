// `ac verdict defer`: a human defers FAILED `[edge]` criteria into tracked fixes (phase 54, ADR-090).
//
// The bug this prevents: a phase whose goal was met still could not verify because one corner
// criterion kept failing (astrobot 104/105: ten verify runs). The fix is a human choice, never an
// automatic one: the FAIL report lists which failures are deferrable, the human names the ones to
// defer, and each becomes a fix in the fix register pre-filled with the verifier's failing command and
// output. The verdict then records the criterion as `deferred` with the fix id.
//
// What may be deferred is decided by `canDefer` in lib/verdict.mjs, once (9173): edge at
// pre-registration, never core, never a suite criterion. This module validates EVERY id first, so a
// refusal changes nothing (neither VERDICT.json nor fixes.json), then opens the fixes, then rewrites
// VERDICT.json under the lock after re-checking that its run did not move. `addFix` is never called
// while holding the lock (it takes the same lock). No workflow or agent calls this: the CLI refuses
// `--agent` (ADR-074/033).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { git } from './git.mjs';
import { withLock, atomicWriteJSON, assertSafeSlug } from './util.mjs';
import { addFix } from './fixes.mjs';
import { criterionBlocks } from './impact.mjs';
import { canDefer, deferReference, criteriaFile, verdictFile, readVerdict } from './verdict.mjs';

// The claim of a criterion heading: `### C7 [edge] — the claim` -> `the claim`.
function claimOf(text, id) {
  const b = criterionBlocks(text).find((x) => x.id === id);
  if (!b) return id;
  return b.heading.replace(/^#{1,6}[ \t]*C\d+(?:[ \t]*\[[^\]\r\n]*\])*[ \t]*[—–:-]*[ \t]*/, '').trim() || id;
}

/**
 * Defer `ids` (already-failed criteria of the phase's latest verdict) into fixes. Throws ONE Error
 * naming every refusal and changing nothing; otherwise returns
 * `{ deferred: [{ id, fix_id }], run, committed }`.
 */
export async function deferCriteria(root, slug, ids, { by = '', now = new Date() } = {}) {
  assertSafeSlug(slug);
  const want = [...new Set(Array.isArray(ids) ? ids : [])];
  if (!want.length) throw new Error('name the criteria to defer, e.g. `ac verdict defer <phase> C2` — nothing is deferred automatically');
  const cfile = criteriaFile(root, slug);
  const text = existsSync(cfile) ? readFileSync(cfile, 'utf8') : '';
  const file = verdictFile(root, slug);
  const { verdict, reason: why } = readVerdict(file);
  if (!verdict) throw new Error(`nothing to defer: ${why}`);

  const ref = deferReference(root, slug, text);
  const refusals = [];
  for (const id of want) {
    const e = verdict.criteria.find((c) => c.id === id);
    if (!e) { refusals.push(`${id}: not in the latest verdict`); continue; }
    if (e.status === 'deferred') { refusals.push(`${id}: already deferred to ${e.fix_id}`); continue; }
    if (!(e.status === 'failed' || (e.status === 'carried' && e.last === 'failed'))) {
      refusals.push(`${id}: it did not fail in the latest verdict (${e.status}) — only a failed criterion is deferred`);
      continue;
    }
    const can = canDefer(root, slug, id, text, { verdict, ref });
    if (!can.ok) refusals.push(`${id}: ${can.reason}`);
  }
  if (refusals.length) throw new Error(`refusing to defer — nothing was changed:\n  ${refusals.join('\n  ')}`);

  const num = /^(\d+)/.exec(slug)?.[1] ?? slug;
  const opened = [];
  for (const id of want) {
    const e = verdict.criteria.find((c) => c.id === id);
    const claim = claimOf(text, id);
    const report = [
      `Deferred from phase ${slug} criterion ${id} — ${claim}`,
      `Failed in verdict run ${verdict.run} @ ${String(verdict.commit ?? '').slice(0, 7)}.`,
      e.command ? `\nFailing command:\n${e.command}` : '\n(no failing command was recorded for this run)',
      e.output ? `\nObserved output:\n${e.output}` : '',
    ].join('\n');
    const fix = await addFix(root, {
      title: `deferred: phase ${num} ${id} — ${claim}`,
      report,
      deferredFrom: { phase: slug, criterion: id, run: verdict.run, commit: verdict.commit ?? null, ...(by ? { by } : {}) },
      now,
    });
    opened.push({ id, fix_id: fix.id });
  }

  const files = await withLock(paths(root).lock, () => {
    const now2 = readVerdict(file).verdict;
    if (!now2 || now2.run !== verdict.run) {
      throw new Error(`the verdict moved while deferring (run ${verdict.run} → ${now2?.run ?? '?'}); the fixes ${opened.map((o) => o.fix_id).join(', ')} were opened, but the verdict was not changed — re-run \`ac verdict defer\``);
    }
    for (const o of opened) {
      const e = now2.criteria.find((c) => c.id === o.id);
      e.status = 'deferred';
      e.fix_id = o.fix_id;
      e.deferred_at_run = now2.run;
      delete e.last;
    }
    atomicWriteJSON(file, now2);
    return [file, paths(root).fixes];
  });

  const msg = `chore(verdict): phase ${num} defer ${opened.map((o) => `${o.id} → ${o.fix_id}`).join(', ')}`;
  const add = git(['add', '--', ...files], { cwd: root });
  const c = add.status === 0 ? git(['commit', '-m', msg, '--', ...files], { cwd: root }) : add;
  return { deferred: opened, run: verdict.run, committed: c.status === 0 };
}
