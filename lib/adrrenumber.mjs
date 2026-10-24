// `ac decision renumber <file|id> <N|next>`: move ONE decision to a fresh claimed number and rewrite only
// the references its own branch added (phase 53, ADR-087 D3/D5).
//
// The collision this repairs: two branches each took the same number. Renumbering one side must not
// disturb the other, so a citation of the old number is rewritten only when git history says the moving
// decision's own branch added that line. A line the other same-numbered decision's branch added is left
// (and counted); a line git cannot attribute to either — a post-merge citation, a squash, a fast-forward —
// is LISTED for a human, never guessed (principle 333f). Exact references to the old FILE NAME are
// unambiguous (the slug identifies the decision) and are rewritten everywhere.
//
// The claim lands first (one compare-and-swap, like `decision add`); every local change is computed in
// memory and then written, restoring the originals if any write fails. A claim that landed and was never
// used is a harmless gap.
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, posix } from 'node:path';
import { paths } from './paths.mjs';
import { atomicWriteText, withLock } from './util.mjs';
import { isRepo, hasRemote, git, gitIdentity, addingCommit, branchSideOf, blameCommits } from './git.mjs';
import { registryBranch, registryRemote } from './registry.mjs';
import { snapshot, transact, probeBranch } from './shared.mjs';
import { ENTRY_ID, parseDecisionEntries, decisionTitle } from './decisions.mjs';
import { writeDecisionLog } from './canon.mjs';
import { projectTexts } from './adrbackfill.mjs';
import {
  ADR_CLAIMS_FILE, detectAdrDir, scanAdrFiles, parseClaims, claimsText, readClaimsMirror, writeClaimsMirror,
  nextAdrClaim, formatAdrId, parseAdrRef, normTitle,
} from './adr.mjs';

const ZERO = '0'.repeat(40);
const DECISIONS_REL = '.astrocode/DECISIONS.md';
const skip = (rel) => rel === '.astrocode/DECISIONS.in-force.md' || rel.startsWith('.astrocode/.local/');
const citation = (n) => new RegExp(`(?<![\\w-])ADR-0*${n}(?!\\d)`, 'g');

// Retag the one entry (matched by numeric id AND exact title, so two entries sharing an id are told apart)
// and every self-reference inside it.
function retagEntry(text, { number, title, newId }) {
  const src = String(text || '');
  const heads = [...src.matchAll(new RegExp(`^##\\s+(${ENTRY_ID})`, 'gm'))];
  for (let i = 0; i < heads.length; i++) {
    const ref = parseAdrRef(heads[i][1]);
    const end = i + 1 < heads.length ? heads[i + 1].index : src.length;
    const entry = src.slice(heads[i].index, end);
    if (ref.series !== 'ADR' || ref.number !== number || normTitle(decisionTitle(entry.trim())) !== normTitle(title)) continue;
    return { text: src.slice(0, heads[i].index) + entry.replace(citation(number), newId) + src.slice(end), found: true };
  }
  return { text: src, found: false };
}

// The numbers already used by anything: claims, ADR-/D- headings, files.
function usedNumbers({ claims, decisionsText, files }) {
  const used = new Set();
  for (const c of claims?.claims || []) used.add(Number(c.number));
  for (const e of parseDecisionEntries(decisionsText)) used.add(parseAdrRef(e.id).number);
  for (const f of files) used.add(f.number);
  return used;
}

const refuse = (refused, error) => ({ ok: false, refused, error, changed: [], unattributed: [], otherSide: 0 });

/**
 * @param {string} root project root
 * @param {string} target a path in the ADR folder, or an `ADR-…` id
 * @param {number|string} to a number, or `next`
 * @returns {Promise<{ ok: boolean, from?: number, to?: number, fromId?: string, toId?: string, changed: string[],
 *   unattributed: {file:string,line:number}[], otherSide: number, dryRun?: boolean, refused?: string, error?: string }>}
 */
export async function renumberDecision(root, target, to, { dryRun = false } = {}) {
  const det = detectAdrDir(root);
  if (det.source === 'ambiguous') return refuse('adr-ambiguous', `more than one ADR folder holds numbered files (${det.candidates.join(', ')}); run \`ac config set decisions.adr_dir ${det.candidates[0]}\` first`);
  if (!det.active) return refuse('no-adr-folder', 'this project has no ADR folder to renumber in');
  const p = paths(root);
  const files = scanAdrFiles(det.abs, det.dir);
  const localText = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
  const entries = parseDecisionEntries(localText).map((e) => ({ ...e, ref: parseAdrRef(e.id) }));

  // ── resolve what moves ──
  let file = null;
  let entry = null;
  let from;
  const idRef = parseAdrRef(String(target || '').trim().toUpperCase());
  if (idRef && idRef.series === 'ADR') {
    from = idRef.number;
    if (idRef.width === det.width) {
      const withNumber = files.filter((f) => f.number === from);
      if (withNumber.length > 1) return refuse('ambiguous', `ADR-${idRef.digits} is carried by ${withNumber.length} files (${withNumber.map((f) => f.rel).join(', ')}) — ambiguous, name the file`);
      file = withNumber[0] || null;
    }
    entry = file
      ? entries.find((e) => e.ref.series === 'ADR' && e.ref.number === from && e.ref.width === det.width && normTitle(decisionTitle(e.text)) === normTitle(file.title))
      : entries.find((e) => e.id === `ADR-${idRef.digits}`);
    if (!file && !entry) return refuse('not-found', `no such decision: ${target}`);
  } else {
    const rel = isAbsolute(String(target)) ? relative(root, String(target)) : posix.normalize(String(target).replace(/\\/g, '/'));
    file = files.find((f) => f.rel === rel);
    if (!file) return refuse('not-found', `${target} is not a numbered file in ${det.dir}`);
    from = file.number;
    entry = entries.find((e) => e.ref.series === 'ADR' && e.ref.number === from && e.ref.width === det.width && normTitle(decisionTitle(e.text)) === normTitle(file.title));
  }
  const title = file ? file.title : decisionTitle(entry.text);
  const oldId = formatAdrId(from, det.width);
  const others = file ? files.filter((f) => f !== file && f.number === from) : [];

  // ── the new number ──
  const explicit = String(to) === 'next' ? null : Number(to);
  if (explicit !== null && (!Number.isInteger(explicit) || explicit < 1)) return refuse('bad-number', `"${to}" is not a positive number or \`next\``);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  const useRegistry = isRepo(root) && hasRemote(remote, root);
  const who = gitIdentity(root);
  const pick = (claims, decisionsText) => {
    if (explicit === null) return { number: nextAdrClaim({ claims, decisionsText, files }) };
    if (usedNumbers({ claims, decisionsText, files }).has(explicit)) {
      return { error: `${explicit} is already used or claimed — nothing was changed; use \`next\` or another number` };
    }
    return { number: explicit };
  };
  const claimFor = (number) => ({ number, title, owner: who.owner, branch: who.branch, claimed_at: new Date().toISOString(), source: 'renumber', from });
  const withClaim = (shared, number) => ({ version: 1, ...(shared || {}), claims: [...(shared?.claims || []), claimFor(number)], backfill: shared?.backfill || null });

  let number;
  let nextClaims;
  if (useRegistry) {
    const where = probeBranch(root, { remote, branch });
    if (where === 'unreachable') return refuse('registry-unreachable', `cannot reach \`${remote}\` to claim a number on ${branch} — nothing was changed`);
    if (dryRun) {
      const snap = where === 'present' ? snapshot(root, { remote, branch }) : { files: {} };
      if (snap.unreadable) return refuse('registry-unreachable', `${branch} could not be read — nothing was changed`);
      const picked = pick(snap.files[ADR_CLAIMS_FILE] != null ? parseClaims(snap.files[ADR_CLAIMS_FILE]) : null, localText);
      if (picked.error) return refuse('number-used', picked.error);
      number = picked.number;
    } else {
      let failure = null;
      const res = transact(root, { remote, branch, message: `canon: renumber ${oldId} "${title}"` }, (shared) => {
        failure = null;
        const claims = shared[ADR_CLAIMS_FILE] != null ? parseClaims(shared[ADR_CLAIMS_FILE]) : null;
        const sharedText = shared['DECISIONS.md'] ?? '';
        const picked = pick(claims, [sharedText, localText].join('\n'));
        if (picked.error) { failure = picked.error; return { updates: {} }; }
        number = picked.number;
        nextClaims = withClaim(claims, number);
        const updates = { [ADR_CLAIMS_FILE]: claimsText(nextClaims) };
        const moved = retagEntry(sharedText, { number: from, title, newId: formatAdrId(number, det.width) });
        if (moved.found) updates['DECISIONS.md'] = moved.text;
        return { updates };
      });
      if (failure) return refuse('number-used', failure);
      if (!res.ok) return refuse('registry-unreachable', `could not claim a number on ${branch}: ${res.error || 'registry unavailable'} — nothing was changed`);
    }
  } else {
    const mirror = readClaimsMirror(root);
    const picked = pick(mirror, localText);
    if (picked.error) return refuse('number-used', picked.error);
    number = picked.number;
    nextClaims = withClaim(mirror, number);
  }
  const newId = formatAdrId(number, det.width);

  // ── compute every new content in memory ──
  const writes = new Map(); // rel -> text
  let newFileRel = null;
  const texts = projectTexts(root, { skip });
  if (file) {
    const base = posix.basename(file.rel);
    const digits = String(from).padStart(det.width, '0');
    const newName = String(number).padStart(det.width, '0') + base.slice(digits.length);
    newFileRel = posix.join(posix.dirname(file.rel), newName);
    if (existsSync(join(root, newFileRel))) return refuse('exists', `${newFileRel} already exists — nothing was changed`);
  }
  const moved = retagEntry(localText, { number: from, title, newId });
  if (moved.found) writes.set(DECISIONS_REL, moved.text);

  // attribution of the moving decision, and of the other same-numbered decision(s)
  let ownSide = { kind: 'unattributable', reason: 'not computed' };
  const otherCommits = new Set();
  if (isRepo(root)) {
    if (file) {
      ownSide = branchSideOf(root, addingCommit(root, file.rel));
      for (const o of others) {
        const s = branchSideOf(root, addingCommit(root, o.rel));
        if (s.commits) for (const c of s.commits) otherCommits.add(c);
      }
    } else {
      const bl = blameCommits(root, DECISIONS_REL);
      const idx = localText.split('\n').findIndex((l) => new RegExp(`^##\\s+${entry.id}(?!\\d)`).test(l));
      const sha = bl && idx >= 0 ? bl[idx] : null;
      ownSide = sha && sha !== ZERO ? branchSideOf(root, sha) : { kind: 'unmerged', commits: new Set() };
    }
  }
  const isOwn = (sha) => (ownSide.kind === 'merged' || ownSide.kind === 'unmerged')
    && ((sha && sha !== ZERO && ownSide.commits.has(sha)) || (sha === ZERO && ownSide.kind === 'unmerged'));

  const oldName = file ? posix.basename(file.rel) : null;
  const nameRef = oldName ? new RegExp(`(?<![\\w.-])${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g') : null;
  const newName = newFileRel ? posix.basename(newFileRel) : null;
  const unattributed = [];
  let otherSide = 0;
  // line -> commit for one file. `null` = git cannot attribute it (not a repo, blame failed on a tracked
  // file); an untracked file is wholly uncommitted.
  const shaLookup = (rel) => {
    if (!isRepo(root)) return null;
    const bl = blameCommits(root, rel);
    if (bl) return (i) => bl[i] ?? null;
    return git(['ls-files', '--error-unmatch', '--', rel], { cwd: root }).status === 0 ? null : () => ZERO;
  };
  // Judge every citation line of the old number in `text` (outside `skipLines`, the moved entry's own lines).
  const classify = (rel, text, skipLines = new Set()) => {
    const lines = (nameRef ? text.replace(nameRef, newName) : text).split('\n');
    const sha = shaLookup(rel);
    for (let i = 0; i < lines.length; i++) {
      if (skipLines.has(i) || !citation(from).test(lines[i])) continue;
      const commit = sha ? sha(i) : null;
      if (isOwn(commit)) lines[i] = lines[i].replace(citation(from), newId);
      else if (commit && otherCommits.has(commit)) otherSide++;
      else unattributed.push({ file: rel, line: i + 1 });
    }
    const out = lines.join('\n');
    return { text: out, changed: out !== text };
  };

  // the moving file itself: its own heading and every self-reference
  if (file) {
    const own = texts.find((t) => t.rel === file.rel)?.text ?? readFileSync(join(root, file.rel), 'utf8');
    writes.set(file.rel, own.replace(citation(from), newId).replace(nameRef, newName));
  }
  for (const { rel, text } of texts) {
    if (file && rel === file.rel) continue;
    if (rel === DECISIONS_REL) {
      // The moved entry's own lines were already retagged; judge every OTHER citation line in the log.
      const base = writes.get(DECISIONS_REL) ?? text;
      const movedLines = new Set();
      const a = text.split('\n');
      const b = base.split('\n');
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) movedLines.add(i);
      const r = classify(rel, base, movedLines);
      if (r.changed) writes.set(rel, r.text);
      continue;
    }
    const r = classify(rel, text);
    if (r.changed) writes.set(rel, r.text);
  }

  const changed = [];
  for (const rel of writes.keys()) {
    if (file && rel === file.rel) changed.push(`${file.rel} → ${newFileRel}`);
    else changed.push(rel);
  }
  const report = { ok: true, from, to: number, fromId: oldId, toId: newId, changed, unattributed, otherSide, dryRun };
  if (dryRun) return report;

  // ── write, restoring the originals on any failure ──
  const done = []; // { abs, before|null }
  const apply = () => {
    for (const [rel, text] of writes) {
      const target = file && rel === file.rel ? newFileRel : rel;
      if (rel === DECISIONS_REL) continue;
      const abs = join(root, target);
      done.push({ abs, before: existsSync(abs) ? readFileSync(abs, 'utf8') : null });
      mkdirSync(dirname(abs), { recursive: true });
      atomicWriteText(abs, text);
    }
    if (file) {
      const oldAbs = join(root, file.rel);
      done.push({ abs: oldAbs, before: readFileSync(oldAbs, 'utf8') });
      rmSync(oldAbs);
    }
    if (writes.has(DECISIONS_REL)) {
      done.push({ abs: p.decisions, before: localText });
      writeDecisionLog(root, writes.get(DECISIONS_REL));
    }
    writeClaimsMirror(root, nextClaims, det);
  };
  const write = () => {
    try { apply(); } catch (e) {
      for (const d of done.reverse()) {
        try { if (d.before === null) rmSync(d.abs, { force: true }); else writeFileSync(d.abs, d.before); } catch { /* best effort */ }
      }
      if (existsSync(p.decisions)) { try { writeDecisionLog(root, readFileSync(p.decisions, 'utf8')); } catch { /* in-force view */ } }
      throw e;
    }
  };
  if (useRegistry) write(); else await withLock(p.lock, write);
  return report;
}
