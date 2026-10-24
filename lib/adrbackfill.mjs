// The one-time upgrade for a project that already has an ADR folder (phase 53, ADR-087):
// claim every number that exists, and relabel the OLD decision-log series to `D-NNN` so that
// `ADR-0xx` stops meaning two things. Nothing in the ADR folder is renamed or renumbered.
//
// `ac decision backfill` is a DRY RUN; `--apply` is the human act (principle 1a0d). Idempotent: a
// `backfill` marker in the claims record means it already ran, and a second run changes nothing and
// claims nothing. A project without an ADR folder is untouched (C9). Relabel detection is exact
// title equality plus digit width, with no similarity score (principle 333f, ADR-053).
//
// Duplicates and title mismatches are REPORTED with their `ac decision renumber … next` fix and
// never resolved here: picking which of two different decisions keeps a number is a human call.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { atomicWriteText } from './util.mjs';
import { isRepo, hasRemote, git, gitIdentity } from './git.mjs';
import { registryBranch, registryRemote } from './registry.mjs';
import { snapshot, transact, probeBranch } from './shared.mjs';
import { parseDecisionEntries, decisionTitle, ENTRY_ID } from './decisions.mjs';
import { mergeDecisions, writeDecisionLog } from './canon.mjs';
import {
  ADR_CLAIMS_FILE, detectAdrDir, scanAdrFiles, parseClaims, claimsText, readClaimsMirror, writeClaimsMirror,
  applyRelabel, buildRelabelMap, adrConsistency, parseAdrRef,
} from './adr.mjs';

const DECISIONS_REL = '.astrocode/DECISIONS.md';
const MAX_BYTES = 2 * 1024 * 1024;

// A file whose references are never rewritten here: the log is rewritten through the transact path,
// the in-force view is regenerated, and `.local/` is machine state.
const skipRel = (rel) => rel === DECISIONS_REL || rel === '.astrocode/DECISIONS.in-force.md' || rel.startsWith('.astrocode/.local/');

// Every project text file and its content, from git's own file list (tracked + untracked, never ignored).
function projectTexts(root) {
  if (!isRepo(root)) return [];
  const r = git(['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root });
  if (r.status !== 0) return [];
  const out = [];
  for (const rel of r.stdout.split('\0').filter(Boolean)) {
    if (skipRel(rel)) continue;
    const abs = join(root, rel);
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      const text = readFileSync(abs, 'utf8');
      if (text.includes('\0')) continue;
      out.push({ rel, text });
    } catch { /* vanished or unreadable: not ours to rewrite */ }
  }
  return out;
}

// What the relabel would do to the OTHER files, and which references it leaves for a human (the log's
// width equals the folder's, so `ADR-0002` could mean either and is never guessed).
function planRewrites(root, relabel, folderWidth) {
  const rewrites = [];
  const ambiguous = [];
  const keys = new Set(Object.keys(relabel));
  const ref = new RegExp(`(?<![\\w-])(${ENTRY_ID})(?!\\d)`, 'g');
  for (const { rel, text } of projectTexts(root)) {
    const next = applyRelabel(text, relabel, { folderWidth });
    if (next !== text) {
      let count = 0;
      const a = text.split('\n');
      const b = next.split('\n');
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
      rewrites.push({ rel, text: next, count });
    }
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(ref)) {
        if (keys.has(m[1]) && parseAdrRef(m[1]).width === folderWidth) { ambiguous.push({ file: rel, line: i + 1 }); break; }
      }
    });
  }
  return { rewrites, ambiguous };
}

/**
 * Plan (and with `apply`, perform) the backfill.
 * @returns {{ active: boolean, already?: string, refused?: string, error?: string, collisions?: object[],
 *   candidates?: string[], relabel: Record<string,string>, rewrites: {file:string,count:number}[],
 *   ambiguous: {file:string,line:number}[], claims: number[], findings: object[], files: string[], applied: boolean }}
 */
export function backfillAdr(root, { apply = false } = {}) {
  const empty = { relabel: {}, rewrites: [], ambiguous: [], claims: [], findings: [], files: [], applied: false };
  const det = detectAdrDir(root);
  if (det.source === 'ambiguous') {
    return { ...empty, active: false, refused: 'adr-ambiguous', candidates: det.candidates, error: `more than one ADR folder holds numbered files (${det.candidates.join(', ')}) — nothing was changed`, fix: `ac config set decisions.adr_dir ${det.candidates[0]}` };
  }
  if (!det.active) return { ...empty, active: false };

  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  const useRegistry = isRepo(root) && hasRemote(remote, root);
  const files = scanAdrFiles(det.abs, det.dir);
  const localText = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
  const who = gitIdentity(root);
  const now = new Date().toISOString();

  let sharedDecisions = null;
  let sharedClaims = null;
  if (useRegistry) {
    const where = probeBranch(root, { remote, branch });
    if (where === 'unreachable') {
      return { ...empty, active: true, refused: 'registry-unreachable', error: `cannot reach \`${remote}\` to claim the existing ADR numbers on ${branch} — nothing was changed` };
    }
    if (where === 'present') {
      const snap = snapshot(root, { remote, branch });
      if (snap.unreadable) return { ...empty, active: true, refused: 'registry-unreachable', error: `${branch} could not be read — nothing was changed` };
      sharedDecisions = snap.files['DECISIONS.md'] ?? null;
      sharedClaims = snap.files[ADR_CLAIMS_FILE] != null ? parseClaims(snap.files[ADR_CLAIMS_FILE]) : null;
    }
  } else {
    sharedClaims = readClaimsMirror(root);
  }
  const already = (c) => (c?.backfill ? { ...empty, active: true, already: String(c.backfill.at || '').slice(0, 10) || 'earlier' } : null);

  // The pure plan over (shared DECISIONS text, shared claims): the same function runs in the dry run and
  // inside the compare-and-swap, so a concurrent second developer sees the first one's marker and no-ops.
  const plan = (decisionsShared, claimsShared) => {
    const done = already(claimsShared);
    if (done) return { done };
    const base = decisionsShared != null ? mergeDecisions(decisionsShared, localText) : { ok: true, text: localText, collisions: [] };
    if (!base.ok) return { collisions: base.collisions };
    const entries = parseDecisionEntries(base.text);
    const { relabel, logWidth } = buildRelabelMap({
      entries, files, folderWidth: det.width,
      claimedByAdd: new Set((claimsShared?.claims || []).filter((c) => c.source === 'add' || c.source === 'renumber').map((c) => Number(c.number))),
    });
    const text = applyRelabel(base.text, relabel, { folderWidth: det.width });
    const have = new Set((claimsShared?.claims || []).map((c) => Number(c.number)));
    const numbers = new Map();
    for (const f of files) numbers.set(f.number, f.title);
    for (const e of parseDecisionEntries(text)) {
      const r = parseAdrRef(e.id);
      if (r.series === 'ADR' && !numbers.has(r.number)) numbers.set(r.number, decisionTitle(e.text));
    }
    const fresh = [...numbers.keys()].filter((n) => !have.has(n)).sort((a, b) => a - b);
    const claims = {
      version: 1,
      ...(claimsShared || {}),
      claims: [
        ...(claimsShared?.claims || []),
        ...fresh.map((number) => ({ number, title: numbers.get(number), owner: who.owner, branch: who.branch, claimed_at: now, source: 'backfill' })),
      ],
      backfill: { at: now, owner: who.owner, log_width: logWidth, folder_width: det.width, relabel },
    };
    return { text, relabel, claims, fresh };
  };

  const first = plan(sharedDecisions, sharedClaims);
  if (first.done) return first.done;
  if (first.collisions) {
    return { ...empty, active: true, refused: 'decision-collision', collisions: first.collisions, error: 'DECISIONS.md has a same-id collision with the shared log — nothing was changed' };
  }

  let { rewrites, ambiguous } = planRewrites(root, first.relabel, det.width);
  const report = (pl, applied) => ({
    active: true,
    relabel: pl.relabel,
    rewrites: rewrites.map((r) => ({ file: r.rel, count: r.count })),
    ambiguous,
    claims: pl.fresh,
    findings: adrConsistency({ detection: det, files, decisionsText: pl.text, claims: pl.claims }),
    files: [
      ...(pl.text !== localText ? [DECISIONS_REL] : []),
      ...rewrites.map((r) => r.rel),
    ],
    applied,
  });
  if (!apply) return report(first, false);

  let used = first;
  if (useRegistry) {
    let racedDone = null;
    const res = transact(root, { remote, branch, message: 'canon: claim existing ADR numbers (backfill)' }, (shared) => {
      const pl = plan(shared['DECISIONS.md'] ?? null, shared[ADR_CLAIMS_FILE] != null ? parseClaims(shared[ADR_CLAIMS_FILE]) : null);
      racedDone = pl.done || null;
      if (pl.done || pl.collisions) return { updates: {}, result: pl };
      used = pl;
      return { updates: { 'DECISIONS.md': pl.text, [ADR_CLAIMS_FILE]: claimsText(pl.claims) }, result: pl };
    });
    if (!res.ok) {
      return { ...empty, active: true, refused: 'registry-unreachable', error: `could not claim the ADR numbers on ${branch}: ${res.error || 'registry unavailable'} — nothing was changed` };
    }
    if (racedDone) return racedDone;
    if (res.result?.collisions) return { ...empty, active: true, refused: 'decision-collision', collisions: res.result.collisions, error: 'DECISIONS.md has a same-id collision with the shared log — nothing was changed' };
  }
  // The claim may have landed on a shared log that moved since the dry plan: rewrite for what was claimed.
  if (JSON.stringify(used.relabel) !== JSON.stringify(first.relabel)) ({ rewrites, ambiguous } = planRewrites(root, used.relabel, det.width));
  // Only after the claim landed: the local log, the mirror, then every reference file.
  writeDecisionLog(root, used.text);
  writeClaimsMirror(root, used.claims, det);
  for (const r of rewrites) atomicWriteText(join(root, r.rel), r.text);
  return report(used, true);
}
