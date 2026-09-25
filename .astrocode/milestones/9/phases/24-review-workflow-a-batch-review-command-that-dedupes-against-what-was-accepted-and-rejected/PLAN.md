# Plan — phase 24: Review workflow (batch review that dedupes against accepted and rejected)

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, named exports only, `die()` +
`✓`/`•`/`⚠`/`⊡` glyphs, a `node:test` test per engine change, real fs/git in tests, the
load-bearing comment voice, ADR-055 reporting slots), `.astrocode/DECISIONS.in-force.md`
(ADR-018 red-test imports, ADR-020 wave-green, ADR-029 per-verb flag allowlist, ADR-030 no
external service in lib/bin, ADR-053 strict-equality-never-similarity, ADR-055 voice, ADR-057
home store, ADR-058 machine only proposes / human data authoritative, ADR-059 fixed header
order + strict parse + conflict side files), this phase's `CONTEXT.md` (D1–D7), and aims at
every criterion in `CRITERIA.md` (C1–C14).

Builds on the store as merged on `develop` (phase 22: `lib/principles.mjs`,
`lib/principlemd.mjs`, `lib/principlesync.mjs`, the `case 'principles':` block of
`bin/ac.mjs`) and on phase 23's single capture spec `templates/principle-capture.md`, **as
merged**. Phase 23 was still executing when this plan was written: its t14 had staged
`tests/principle_capture.test.mjs`, `tests/commands.test.mjs` and `tests/install.test.mjs`,
and its t15 (`MANUAL.md`, DECISIONS) had not landed yet. **Do not start this phase until phase
23's commits are on `develop`.** Each task that touches one of those files edits the
version phase 23 leaves behind. Phase 23's command files (`astro-discuss/decision/accept/
complete-milestone.md`) only point at the spec and are not touched here.

**Contract change that breaks two existing tests (wave-green, ADR-020).** Propose-time dedupe
(t7) deliberately reverses the phase-22/23 "re-proposing mints a fresh entry" behaviour
(CONTEXT D2, ADR-058). Two tests encode the old contract:
- `tests/principles_cli.test.mjs` "C15: `add --propose` never touches an already-accepted
  entry, even with the identical statement";
- `tests/principle_capture.test.mjs` "C15/D6 known gap: …".

They are rewritten IN t7, the task that changes the behaviour, never in a separate task.

**Test strategy — test-first, serialized (chosen explicitly).** Every engine/CLI change has a
RED-test task with empty `depends_on`, so all of them land in wave 1. The implementation task
`depends_on` its RED task, so its executor runs that file to green. RED files reach any symbol
that does not exist yet only through `const { fn } = await import('../lib/x.mjs')` inside an
async test body (ADR-018). That includes NEW exports of EXISTING modules
(`recordSighting`/`reopenPrinciple`/`mergePrinciple` from `lib/principles.mjs`,
`unionSightings`/`reconcileRevisions` from `lib/principlemd.mjs`). Existing static imports of
symbols already on the branch (e.g. `renderPrinciple` in `tests/principlesync.test.mjs`) stay
as they are. The CLI RED file drives `bin/ac.mjs` as a subprocess, so a missing verb is a
non-zero exit, not a load crash. The one exception is the D7 fix (t5): a two-line change whose
test and fix share one task, with the test written first inside that task. The prose guard
for `/astro-review` (in t14) is written in the same task as the command it guards, because it
asserts on anchors that only exist once that text does.

**Guards to respect everywhere.**
- `tests/forge_standalone.test.mjs` fails any `lib/`/`bin/`/`workflows/` file matching
  `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`, and CLI output
  matching `…|knowledge graph|the brain`. New comments cite "ADR-058"/"D3", never that service.
- `tests/forge.test.mjs` forbids `AntiPattern|EvidencedBySignal|ToolSearch(` in `commands/`:
  write kinds lowercase (`antipattern`).
- `tests/commands.test.mjs` SLOTS anchor on literal step text. Only t14 edits that file.
- Every test that runs `ac` sets `HOME` to a `mkdtempSync` dir and deletes (or explicitly
  sets to a temp dir) `ASTRO_PRINCIPLES_DIR`. No test may touch the real
  `~/.astro/principles`.
- No readline, no stdin read, no prompt in any new `ac` verb (D4, C11). `AskUserQuestion`
  appears only in `commands/astro-review.md`.

---

## Decisions this plan pins (CONTEXT "Open for the planner" + what the criteria need)

**P1 — Matching lives in a new pure module `lib/principlematch.mjs`** (no fs, no git, no
redaction; callers pass already-redacted text). `lib/registry.mjs`'s `classifyMatch` is NOT
reused. Its Jaccard ≥ 0.5 over raw words misses C4's case: "Commit the pnpm lockfile on every
dependency change" vs "Use pnpm for every lockfile in JS repos" shares only 2 of 8 content
words. It also cannot say *which* words matched, and D1 requires an explainable match.
- `normaliseStatement(s)` =
  `String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()`.
  Every non-letter/digit run (punctuation, `-`/`–`/`—`/`−` dash variants, whitespace runs)
  collapses to one space. This subsumes `lib/decisions.mjs`'s `DASH_CLASS`, so that module is
  not touched.
- `sameStatement(a, b)` — the ONLY exact test: `na === nb && na !== ''` on
  `normaliseStatement`. Plain string equality: no score, no threshold, no edit distance
  (ADR-053 precedent, CONTEXT D1). The overlap function below is never called on the
  suppress path (risk: a normalisation or scoring bug silently swallowing a distinct
  proposal).
- `STOPWORDS` (exported, frozen): `a an the and or but nor for of to in on at by with from as
  is are was be been it its this that these those every each all any some use uses using
  used prefer always never not no do does don t s over than then when where which who into
  onto your you we our us i my me so only just should must can will would via per` —
  generic glue and the words almost every principle starts with, so they never count as
  evidence.
- `statementTokens(s)` → normalise, split on spaces, drop `STOPWORDS` and tokens shorter than
  2 characters, then fold a plural: a token longer than 3 characters that ends in `s` but not
  `ss` loses the final `s` (`lockfiles`→`lockfile`, `repos`→`repo`, `js` untouched).
  Returns the unique tokens, sorted.
- `MIN_SHARED = 2` (exported). Two statements are an **overlap candidate** iff they are not
  `sameStatement` and share ≥ `MIN_SHARED` tokens. There is no float score. The shared
  tokens themselves are the explanation.
- `findCandidates(entries, statement)` →
  `{ exact: [{ id, status, reason?, mergedInto? }], overlap: [{ id, status, reason?, shared: [...] }] }`.
  `exact` is sorted by id. `overlap` is sorted by `shared.length` descending, then by id.
  Every status is considered. The output is fully deterministic and has no timestamps (C4:
  two runs are byte-identical).
- `pickExactTarget(exactEntries)` → the one entry a sighting lands on. Priority by status:
  `accepted` > `proposed` > `rejected` > `retired` > `superseded` > `merged`. Ties go to the
  smaller id.
- `groupDuplicates(proposedEntries)` → connected components (size ≥ 2) under
  `sameStatement || overlap ≥ MIN_SHARED`. Each group's ids are sorted, and groups are
  ordered by their first id.
- `buildReviewQueue(entries)` → the proposed entries, sorted by id, each as
  `{ ...entry, sightings: entry.sightings ?? [], sightingCount, matches, groupWith }`.
  `matches` lists `{ id, status, reason?, match: 'exact'|'overlap', shared }` against every
  NON-proposed, non-merged entry (accepted/rejected/retired/superseded), with the rejection
  reason included. `groupWith` lists the ids of the other proposed entries in the same
  duplicate group (`[]` when none). This is the per-item data C11 requires.

**P2 — Sightings in the entry format (ADR-059-conformant).** `lib/principlemd.mjs` changes:
- `HEADER_KEYS` = `id, kind, strength, status, created, stack, work, files, reason,
  superseded-by, merged-into, source, promotion, history, sighting`.
  `REPEATABLE_KEYS` = `files, promotion, history, sighting`. No new key is required, so
  pre-phase entries parse unchanged (C9).
- `sighting: <one-line JSON object>`, one line per record, rendered after `history`. Each
  record has the `source` shape (`session?, project?, at, ref?, excerpt?`) plus
  `mergedFrom?: <id>` when it was folded in by a merge. Parsed into `entry.sightings` **only
  when ≥ 1 line exists** (mirrors how `source` is optional), so `parse(render(e))` still
  deep-equals every existing fixture and the round-trip tests stay green.
- **Header order is now enforced by the parser**. ADR-059 says "fixed header key order" but
  `parsePrinciple` never checked it, and C9 requires a hand-mangled order to read as damage.
  Each header line's `HEADER_KEYS` index must be ≥ the previous line's index. Otherwise it
  throws `damaged(label, 'header key "<k>" out of order (fixed order: id, kind, …)')`.
  Canonically rendered files are unaffected. The hand-built test fixtures that exist today
  are either canonical or already damaged for another reason (checked:
  `tests/principles.test.mjs:262`).
- **Sighting count semantics (C1/C3, pinned).** `sightingCount = sightings.length` = the
  number of REPEAT captures observed after the capture that created the entry. The creating
  capture lives in `source` and is not a sighting. Three variants proposed after the
  original therefore give `sightingCount: 3`, and "seen again N times" (D5) is exactly N. A
  guard test in t6 asserts this number, so a later refactor cannot silently shift it.
- **Evidence is uncapped and append-only.** Every sighting is kept. Each excerpt is capped at
  500 chars exactly like `source` (redact first, then cap, via `buildSource`). Evidence is
  not capped per entry because capping would mean rewriting or dropping OLD sighting lines,
  which breaks the append-only property that makes two machines' sightings merge (D3/P4). At
  the expected scale (tens to low hundreds of entries), the linear scan in `findCandidates`
  needs no index. A module-header comment says so.
- A sighting never adds a `history` line. `history` is the lifecycle and revision-marker
  list. Keeping sightings out of it means an accepted or rejected entry's history is
  byte-identical after a sighting (C2), and sightings do not make revisions diverge.

**P3 — `merged` terminal state (D6).** Add `merged` to `PRINCIPLE_STATUSES`, with header key
`merged-into: <survivor id>` and entry field `mergedInto`. Parse and render copy the
`superseded`/`superseded-by` branch verbatim: `merged-into` is present iff status is
`merged`, and `reason` is forbidden, as it is for every status except rejected/retired.
`superseded-by` is not overloaded, because `compareRevisions` and sync would otherwise be
unable to tell the two apart.

**P4 — Sync merges sightings append-only (D3, C8).** New pure exports in
`lib/principlemd.mjs`:
- `unionSightings(a, b)` → the union deduplicated by `JSON.stringify` equality, sorted by
  (`at` ascending, then the JSON string). The order is deterministic, so both machines
  produce byte-identical files.
- `reconcileRevisions(a, b)` → strip `sightings` from copies of both entries and run the
  UNCHANGED `compareRevisions`. On `'conflict'` it returns `{ outcome: 'conflict' }`.
  Otherwise the base is `b` when `a` is `'older'` and `a` for `'same'`/`'newer'`, and it
  returns `{ outcome, entry: { ...base, sightings: union } }`. `sightings` is omitted when
  the union is empty.
`lib/principlesync.mjs`'s `resolveMergeConflicts` calls `reconcileRevisions` instead of
`compareRevisions`. For every non-conflict outcome it writes `renderPrinciple(result.entry)`,
not a raw side. The genuine-conflict branch is unchanged. Result: two machines that each
append a sighting to the same entry offline converge with both sightings and produce no
`conflicts/` file. One side accepting while the other sights also keeps the sighting, because
the newer side wins its lifecycle fields and the sightings are unioned.

**P5 — Store verbs (`lib/principles.mjs`).**
- `proposePrinciple(dir, {…})` **without `id`** now dedupes (D2). Under the ONE existing
  `.lock` (`withLock` is not reentrant, so there are no nested helper calls that take the
  lock), it runs `loadPrinciples(dir).entries`, then
  `findCandidates(entries, redactSecrets(fields.statement)).exact`. Stored statements are
  already redacted, so the comparison is redacted against redacted.
  - Exact hit: `pickExactTarget`, then follow `mergedInto` to the survivor (a visited set
    guards against cycles, and a missing target stops at the merged entry itself). Append
    `buildSource(source, now) ?? { at: now.toISOString() }` to its `sightings` (a capture
    with no evidence is still recorded, never dropped — D3) and write. Nothing else on the
    entry changes: text, status, scopes, kind, why, history. Return
    `{ ok: true, entry, created: false, sighted: true, refreshed: false, matched: { id, status } }`.
    This applies to accepted, rejected, retired, proposed (edited or not) and superseded
    entries alike. An exact match never refreshes text. The first wording stands, and the
    variant differs only in formatting anyway.
  - No exact hit: create the proposal exactly as today, returning
    `{ ok: true, entry, created: true, sighted: false, refreshed: false }`. Overlap-only
    candidates are NEVER acted on here (D1, C4).
  - `proposePrinciple` **with `id`** keeps its phase-22 refresh contract unchanged.
    `addPrinciple(…, { propose: true })` still returns `result.entry` (existing API).
- `recordSighting(dir, ref, { source, now })` → an explicit sighting on a named entry. It
  exists so an agent that judged an overlap-only candidate to be "the same" (D1, C13) can
  record it. Resolve by `resolvePrinciple`, then take the lock, re-read strictly, follow
  `mergedInto`, and append. Any status is allowed, and it only appends evidence. Returns
  `{ entry, redirectedFrom? }`.
- `matchPrinciple(dir, statement)` → `findCandidates(loadPrinciples(dir).entries,
  redactSecrets(statement))`. Read-only.
- `reopenPrinciple(dir, ref, { reason, now })` (D5, C6) requires a reason (`'reopening a
  principle needs a reason'`). The move is `rejected → proposed` only; anything else throws
  `illegalMove(entry, 'reopen', 'rejected → proposed')`. It deletes `reason` (the status
  invariant), appends `{ action: 'reopened', at, reason }` to history and keeps the earlier
  `rejected` history line and all sightings. It keeps the same id.
- `mergePrinciple(dir, ref, { into, now })` (D6, C7) requires `into`
  (`'merge needs --into <id>'`). It rejects a self-merge (`a principle cannot be merged into
  itself`). The duplicate must be `proposed`, otherwise
  `illegalMove(entry, 'merge', 'proposed → merged')`. The survivor must be `proposed` or
  `accepted`, otherwise
  `cannot merge into "<id>" — it is <status> (a survivor must be proposed or accepted)`.
  Under one lock it re-reads both and checks both statuses again, then:
  1. Write the survivor first, with `sightings += [{ ...(dup.source ?? { at: dup.created }), mergedFrom: dup.id }, ...(dup.sightings ?? []).map(s => ({ ...s, mergedFrom: dup.id }))]`. Its text, status and history are untouched.
  2. Then write the duplicate: `status: 'merged'`, `mergedInto: survivor.id`, history
     `{ action: 'merged', at, into: survivor.id }`.

  The survivor is written first so a crash in between can only duplicate evidence, never
  lose it. Nothing is deleted, and both ids stay citable. Returns `{ survivor, merged }`. A
  later exact re-proposal of the duplicate's wording lands on the survivor (C7) through the
  `mergedInto` redirect above. It is not treated as a rejection.
- `writeEntry` also masks `sightings[].excerpt` with `redactSecrets` (defence in depth). It
  is the one place an entry reaches disk. `buildSource` already redacts and caps, so C5 holds
  either way.
- **D7** — `acceptPrinciple` with a reworded statement or why appends TWO history lines:
  `{ action: 'edited', at, statement: prior, why: prior }`, then `{ action: 'accepted', at }`.
  A plain accept is unchanged.

**P6 — CLI surface (`bin/ac.mjs`; every verb calls `principlesSync` first and
`reportPrinciplesConflicts` after, like its siblings).**
- `ac principles add … --propose` calls `proposePrinciple` directly (not `addPrinciple`) so it
  can report what happened:
  - created → `✓ principle <id> (proposed)` (unchanged);
  - sighted → `• seen again: <id> (<status>[: <reason>]) — sighting recorded (<n> total), not re-queued`.
  Exit 0 either way.
- `ac principles match "<statement>" [--json]` — JSON prints `findCandidates`'s object.
  Text prints one line per candidate:
  - `exact    <id>  <status>[ — <reason>]`
  - `overlap  <id>  <status>[ — <reason>]  matched on: pnpm, lockfile`

  With no candidates it prints `• no candidates`.
- `ac principles sight <id> [--from-session …] [--from-project …] [--from-ref …] [--excerpt …]`
  → `✓ sighting recorded on <id> (<status>) — <n> total`.
- `ac principles reopen <id> --reason "…"` → `✓ principle <id> → proposed (reopened)`.
- `ac principles merge <dup> --into <id>` →
  `✓ merged <dup> into <id> — kept <id>, folded <dup>'s evidence in as sightings`. The
  explicit wording of which entry was kept guards against swapped arguments.
- `list --json`: every entry is emitted with `sightings` (default `[]`) and `sightingCount`.
  With `--proposed --json`, the items are `buildReviewQueue` output (adds `matches` and
  `groupWith`). With text `--proposed`, each `indexLine` is followed by one indented `↳` line
  ONLY when the entry has sightings, matches or a group. That line reads
  `↳ seen again N · rejected match <id> ("<reason>") · overlaps <id> on a, b · group: <ids>`,
  with only the parts that apply.
- `show`: JSON adds `sightings` (default `[]`) and `sightingCount`. Text adds
  `merged — into <id>` to the status line and a `sightings (N):` block with one pointer line
  per record (session/project/ref/at/`from <mergedFrom>`), plus the excerpt when present.
- ADR-029 allowlist rows:
  - `'principles match': ['json']`
  - `'principles sight': ['from-session','from-project','from-ref','excerpt']`
  - `'principles reopen': ['reason']`
  - `'principles merge': ['into']`
- Usage block (one line each, in the house style), plus the unknown-verb `die` list gaining
  `match | sight | reopen | merge`.

**P7 — `/astro-review` (`commands/astro-review.md`, D4, C12).** Frontmatter:
`allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion`,
`argument-hint: ""`, and a description. The steps are pinned because the guard anchors on
them:
1. `1. **Read the queue.**` — `ac principles list --proposed --json`. If the queue is empty,
   say so in one line and stop.
2. `2. **Group and batch.**` — near-duplicate groups come from `groupWith`, and a group is
   always presented together. Batches hold about 4 items per round, with a group counting as
   one item.
3. `3. **Present each batch**` — per item: statement, why, kind/strength/scopes, the source
   excerpt, "seen again N" when N > 0, and each match (for example `rejected (<reason>), seen
   again N times` or `overlaps accepted <id> on pnpm, lockfile`). Each item gets at most four
   lines, and detail lives in `ac principles show <id>`.
4. `4. **Ask, one round per batch.**` — one `AskUserQuestion` call per batch, one question
   per item, with the options accept / edit-then-accept / reject / skip. A group gets one
   question with the options "merge into <id>" (one per member), "review separately" and
   skip. Then one follow-up round collects the new wording for every edit-then-accept and a
   **required** reason for every reject. A reject with no reason is re-asked, never
   defaulted.
5. `5. **Act through \`ac\` only.**` — the verbs are `ac principles accept <id>`,
   `accept <id> --statement "…" [--why "…"]`, `reject <id> --reason "…"` and
   `merge <dup> --into <id>`. The command never writes under `~/.astro/principles/` and never
   runs amend/retire/supersede. A verb that fails (typically `cannot … — it is accepted`
   because the queue changed under the snapshot) does not stop the batch. It is reported in
   one line per failure, `⚠ <id>: <first error line>`, and counted as skipped.
6. `6. **Rejected entries seen again.**` — from `ac principles list --rejected --json`, the
   entries with a sighting whose `at` is later than their last `rejected` history line. Each
   is shown in one line as `rejected (<reason>), seen again N times`. One question offers
   "leave rejected" (listed first) or "reopen <id>". Reopen only runs on that explicit choice,
   through `ac principles reopen <id> --reason "<the user's words>"`. When there are none,
   say nothing. Nothing is ever reopened or accepted automatically.
7. `7. **Report.**` — exactly one line:
   `reviewed N — A accepted, R rejected, S skipped` plus `, M merged` and `, O reopened` only
   when they are non-zero. The line always leads, and any `⚠` failure lines from step 5 follow
   it.

Closing `## Never` section: no direct store writes, no readline or `ac` interactive mode, no
reopen or accept of a rejected match without the user choosing it, no reject without a
reason, no merge on similarity without the user choosing it.

**P8 — Capture spec update (`templates/principle-capture.md`, C13).** The file remains the
single source, and the four caller commands are not touched.
- §5 gains a step BEFORE the invocation:
  `ac principles match "<lifted statement>" --json`.
  - `exact` non-empty → run the invocation anyway. The engine records the repeat as a
    sighting mechanically.
  - `overlap` candidates → the agent decides whether the capture is the same principle or a
    different one.
    - **same** → `ac principles sight <id> --from-project "<project>" --from-ref "<ref>" --excerpt "<the user's own words>"`
      instead of proposing.
    - **different** → propose.
  - Never rephrase to dodge a rejected match.
  - Never merge, reject, reopen or accept from a capture. `sight` joins the propose path as
    the only allowed verbs.
- **Keep phase 23's guard green (`tests/principle_capture.test.mjs`).**
  - Its `extractInvocation` reads the FIRST ```sh fence in the file. The existing invocation
    fence therefore stays the first `sh` fence, byte-identical, and the `match`/`sight`
    lines go in fences AFTER it. The prose says "before running the invocation above …".
  - Its report-line guards need the exact substring
    `proposed N principle(s) — ac principles list --proposed`, the regex
    `/zero proposals.{0,40}say nothing/is` and `no inline accept prompt`. §7's existing
    sentences therefore stay byte-identical.
  - §7 only gains one added sentence: when repeats were recorded, the same single line gains
    `, M seen again` before the ` — `. With zero proposals but M > 0 it is
    `M principle(s) seen again — ac principles list --proposed`. With nothing at all, say
    nothing, as before.
  - §7's review pointer may add "or `/astro-review`" in a separate sentence.
- §9 "Known gap" is replaced by "Dedupe": exact repeats are handled by the engine, overlaps
  by the capturing agent, and nothing merges on similarity alone.

**P9 — Canon.** `ac decision add` records the specifics this plan pinned (P1–P6), never by
hand-editing DECISIONS.md, in the ADR-059 style.

---

## Tasks

### t1 — RED: matcher tests
- **file:** `tests/principlematch.test.mjs` (new)
- **depends_on:** —
- `const { normaliseStatement, sameStatement, statementTokens, findCandidates, pickExactTarget,
  groupDuplicates, buildReviewQueue, MIN_SHARED, STOPWORDS } = await import('../lib/principlematch.mjs')`
  inside each async test. Entries are plain objects shaped like `parsePrinciple` output.
- Cover P1:
  - C1's four variants ("Always use pnpm, never npm, for lockfiles" /
    "always use PNPM — never npm for lockfiles." / "Always  use pnpm - never npm, for
    lockfiles" / an en-dash variant) are all `sameStatement`.
  - **Risk-1 regression**: "use pnpm for lockfiles" vs "use npm for lockfiles" are NOT
    `sameStatement`. They do share tokens, so they show up only as an overlap candidate if at
    all, never in `exact`.
  - `statementTokens` drops stopwords and folds plurals (`lockfiles`→`lockfile`,
    `js` kept).
  - C4 case: "Commit the pnpm lockfile on every dependency change" against the accepted "Use
    pnpm for every lockfile in JS repos" is an `overlap` candidate with
    `shared: ['lockfile','pnpm']`. "Name tests as full sentences" returns no candidates.
    `JSON.stringify` of two runs is identical.
  - `pickExactTarget` priority and the tie on id.
  - `groupDuplicates` builds connected components (A~B, B~C → one group of three) and skips
    singletons.
  - `buildReviewQueue` returns only proposed entries. Their `matches` carry a rejected
    entry's `reason`, merged entries are excluded from `matches`, and `groupWith` and
    `sightingCount` are correct.

### t2 — Matcher module
- **file:** `lib/principlematch.mjs` (new)
- **depends_on:** t1
- Implement P1 (pure; imports nothing but maybe `node:` builtins). Named exports only. The
  module header says:
  - why exact is plain `===` and lives on its own code path (ADR-053 precedent; CONTEXT D1:
    similarity-driven merges destroyed data);
  - why overlap is a shared-token list and not a score (explainable, deterministic, no
    embeddings, zero deps);
  - why `classifyMatch` was not reused (C4's 2-of-8 overlap, no shared-token explanation);
  - why callers pass redacted text.
- Run `node --test tests/principlematch.test.mjs` → green.

### t3 — RED: entry-format tests (sightings, merged, header order, sync reconcile)
- **file:** `tests/principlemd.test.mjs`
- **depends_on:** —
- Add tests with dynamic imports (the file already uses them). Existing tests are untouched.
- Cover P2/P3/P4:
  - An entry with two `sightings` round-trips deep-equal and byte-exact, with the
    `sighting:` lines rendered after `history`.
  - An entry without sightings parses with NO `sightings` key.
  - `merged` + `merged-into` round-trips.
  - `merged` without `merged-into` is damaged, and so is `merged-into` on an accepted entry.
    Both name the file.
  - A `sighting:` line with unparseable JSON is damaged.
  - A header with `status:` placed after `created:`, or `history:` before `source:`, throws
    naming the file and "out of order".
  - The byte-exact canonical text of a phase-22-shaped entry (no new keys) still parses
    (C9).
  - `unionSightings` deduplicates and sorts deterministically regardless of argument order.
  - `reconcileRevisions`:
    - equal history, sightings differing on both sides → `same` with the union;
    - one side has an extra `accepted` history line, the other an extra sighting → `newer`
      or `older` with the lifecycle of the newer side AND both sightings;
    - divergent history → `conflict`.

### t4 — Entry format: sightings, `merged`, order enforcement, reconcile
- **file:** `lib/principlemd.mjs`
- **depends_on:** t3
- Implement P2–P4 in the parser, renderer and the two new pure exports. `compareRevisions`
  is unchanged.
- Extend the module header:
  - why sightings are a repeatable header key and not a body section (fixed-order strict
    parse, one JSON record per line, same as `promotion`/`history`);
  - why they are append-only and outside `history` (sync-mergeable, C2's byte-identical
    history);
  - why `merged-into` mirrors `superseded-by` rather than reusing it;
  - why the parser now enforces the order ADR-059 always claimed.
- Run `node --test tests/principlemd.test.mjs tests/principles.test.mjs tests/principlesync.test.mjs tests/principles_cli.test.mjs`
  → every pre-existing test is still green.

### t5 — D7: an edited acceptance records both the edit and the acceptance; close the debt item
- **files:** `tests/principles.test.mjs`, `lib/principles.mjs`, `.astrocode/debt.json`
- **depends_on:** —
- Test first, in this task: `proposePrinciple` "use tabs", then `acceptPrinciple(dir, id, {
  statement: 'Use two-space indentation' })`. The history must end with the `edited` line
  (carrying `statement: 'use tabs'`) followed by the `accepted` line. A why-only reword gives
  the same two lines, and a plain accept is still exactly one `accepted` line. Confirm RED,
  then change `acceptPrinciple` per P5/D7 and update its JSDoc.
- The pre-existing `proposePrinciple({ id })` refusal on an edited entry still holds, because
  the `edited` line is still present.
- Close the debt item:
  `node bin/ac.mjs debt drop 2026-09-24-accept-statement-edit-records-only-an --reason "fixed in phase 24 (t5): an edited accept records edited + accepted"`.
  Commit the resulting `.astrocode/debt.json` in the same commit.

### t6 — RED: store dedupe, sightings, reopen, merge tests
- **file:** `tests/principles_review.test.mjs` (new)
- **depends_on:** —
- `const { proposePrinciple, addPrinciple, acceptPrinciple, rejectPrinciple, recordSighting,
  matchPrinciple, reopenPrinciple, mergePrinciple, loadPrinciples, resolvePrinciple } = await
  import('../lib/principles.mjs')` inside each async test. Stores use `mkdtempSync`
  (explicit `dir`).
- **C1**: 1 proposal + 3 formatting variants give exactly 1 proposed entry with
  `sightings.length === 3` — the **pinned count guard**, named as such. Each variant's
  project and excerpt is present, and the entry text equals the first wording.
- **C2**: an accepted entry (via `addPrinciple`) and one accepted with `--statement`, each
  snapshotted, then a variant proposed against each. There is no new proposed entry. Each
  file differs from its snapshot only by added `sighting:` lines: remove those lines and
  compare the rest byte for byte.
- **C3**: rejected "not my style" + 3 variants. The entry stays `rejected` with its reason and
  gets 3 sightings. The proposed queue is empty.
- **C4**: an overlap-only proposal against an accepted entry creates a NEW proposed entry.
  `matchPrinciple` names that entry with the shared tokens.
- **C5**: the excerpt `token AKIAIOSFODNN7EXAMPLE ghp_0123456789abcdefghijklmnopqrstuvwxyzAB leaked`
  lands as a sighting. Reading every file in the store turns up neither raw string.
- A capture with no source evidence still appends a sighting `{ at }`.
- `recordSighting` on a merged id lands on its survivor (`redirectedFrom`).
- **C6**:
  - reopen without a reason → throws;
  - reopen with a reason → same id, `proposed`, no `reason` field, history holds the
    `rejected` line and then `reopened` with the reason;
  - reopen on an accepted or a proposed entry → throws `cannot reopen`, and the file is
    byte-identical.
- **C7**: A and B proposed. After `mergePrinciple(B, { into: A })`:
  - B is `merged` with `mergedInto === A.id` and B's file still exists;
  - A carries B's source as a sighting with `mergedFrom: B.id`;
  - A's statement and status are unchanged, and A's history is unchanged;
  - the queue holds only A, and the file count is unchanged.
  Re-proposing B's exact wording then adds a sighting on A. Also: a self-merge throws,
  merging an accepted duplicate throws, and merging into a rejected survivor throws.
- **Risk-8**: two sequential `mergePrinciple` calls on the same duplicate — the second
  throws `illegalMove` and changes nothing.

### t7 — Store: propose-time dedupe, `recordSighting`, `matchPrinciple` (+ the two tests it obsoletes)
- **files:** `lib/principles.mjs`, `tests/principles_cli.test.mjs`, `tests/principle_capture.test.mjs`
- **depends_on:** t2, t4, t5, t6
- Implement P5's `proposePrinciple` dedupe, `recordSighting`, `matchPrinciple` and the
  `writeEntry` sighting mask. It imports `findCandidates`/`pickExactTarget` from
  `./principlematch.mjs`.
- One internal helper appends a sighting to an already-read entry and follows `mergedInto`;
  it is called only while the lock is held.
- Update the module header, whose "dedupe itself is phase 24's job" sentence becomes the real
  rule: exact repeat → sighting on any status; overlap → never acted on here; ADR-058 still
  holds because a sighting never changes text, status, scopes or history. Also update the
  `proposePrinciple` and `principleId` JSDoc that say "dedupe is phase 24's job".
- **Rewrite the two old-contract tests in this same task** (see the header; the CLI output
  wording changes later in t12, so assert on DATA, never on stdout wording):
  - `tests/principles_cli.test.mjs` C15 → "`add --propose` of an accepted entry's exact
    statement records a sighting and never re-queues it". Assert:
    - the store's file count is unchanged, and no entry is `proposed`;
    - the accepted entry's file, with its `sighting:` lines removed, equals the before
      snapshot;
    - `show --json` gives `status: 'accepted'` and `sightings.length === 1`.
  - `tests/principle_capture.test.mjs` "C15/D6 known gap" → "C15/D6 dedupe: re-running the
    invocation over accepted, rejected and amended entries changes none of their text, status
    or history and mints no new entry". In that scenario the accepted and rejected entries
    share the exact statement and the amended one does not (`, always`), so by
    `pickExactTarget` priority the sighting lands on the ACCEPTED entry. Assert:
    - the rejected and amended files are byte-identical;
    - the accepted file equals its snapshot once `sighting:` lines are removed;
    - the `.md` file count is unchanged.

    Keep every other test in that file untouched.
- `node --test tests/principles_review.test.mjs` → the C1–C5 and sighting tests are green,
  and the reopen/merge tests stay RED until t8.
- `node --test tests/principles.test.mjs tests/principles_cli.test.mjs tests/principle_capture.test.mjs tests/principles_promote.test.mjs tests/principles_sync_cli.test.mjs`
  → green.

### t8 — Store: `reopenPrinciple`, `mergePrinciple`
- **file:** `lib/principles.mjs`
- **depends_on:** t7
- Implement P5's two verbs in the house shape: reason/arg validation before the lock,
  `resolvePrinciple` outside it, re-read strictly under ONE `withLock`, `illegalMove`
  messages, and a `history` line. Merge writes the survivor first (with a comment on why).
  JSDoc states the legal moves.
- `node --test tests/principles_review.test.mjs tests/principles.test.mjs` → all green.

### t9 — RED: sightings from two machines merge cleanly through sync
- **file:** `tests/principlesync.test.mjs`
- **depends_on:** —
- A new test in the file's existing two-machine bare-remote style, following the `withIdentity`
  helper pattern. `const { recordSighting, proposePrinciple } = await import('../lib/principles.mjs')`
  inside the body.
- **C8**: machine A creates an entry, syncs, and machine B syncs so it holds it. Offline from
  each other, A proposes an exact variant (sighting from project `px`) and B does the same
  (project `py`). Then sync A, B, A.
  - Both stores hold both sightings, the entries are byte-identical across stores, and
    `openConflicts` is empty.
  - There is no `conflicts/` file, no conflict markers, and status and text are unchanged.
- A second case: A accepts a proposed entry while B records a sighting on it. After syncing
  it is accepted on both machines, with B's sighting and no conflict.

### t10 — Sync: reconcile sightings in the merge-conflict path
- **file:** `lib/principlesync.mjs`
- **depends_on:** t4, t7, t9
- Implement P4's `resolveMergeConflicts` change: call `reconcileRevisions`, write
  `renderPrinciple(result.entry)` for same/older/newer, and leave the genuine-conflict
  branch unchanged.
- Add a module-header paragraph: why sightings union instead of conflicting (D3: append-only
  evidence has no "winner"; the deterministic sort makes both machines converge
  byte-identically).
- `node --test tests/principlesync.test.mjs tests/principles_sync_cli.test.mjs` → green.

### t11 — RED: CLI tests for the review surface
- **file:** `tests/principles_review_cli.test.mjs` (new)
- **depends_on:** —
- Subprocess only: `spawnSync(process.execPath, [AC, …], { input: '', env })`, with `HOME` and
  `ASTRO_PRINCIPLES_DIR` set to `mkdtempSync` dirs. Stdin is closed or empty for every call
  (C11). Helpers copied locally in the style of `tests/principles_cli.test.mjs`, not imported
  from it.
- Cover P6:
  - **C1**: `add --propose` of a variant prints `seen again` and exits 0, and
    `list --proposed --json` has 1 item with `sightingCount: 3`.
  - **C3**: `show --json` of a rejected entry has `sightingCount: 3`, `status: 'rejected'`
    and its reason.
  - **C4**: `match --json` names the id with `shared` containing `pnpm` and `lockfile`; the
    unrelated statement gets empty candidates; two runs' stdout is identical; text `match`
    prints `matched on:`.
  - `sight <id> --from-project p --excerpt e` → `sightingCount` + 1.
  - **C6**: `reopen` without `--reason` exits non-zero; with it, the entry is proposed.
    `reopen` of an accepted entry exits non-zero.
  - **C7**: `merge B --into A` → `show B --json` has `status: 'merged'` and
    `mergedInto: A`, `list --proposed --json` has no B, and the output names what was kept.
  - **C10**: `accept --statement` → history has `edited` then `accepted`.
  - **C11**: after one proposal has sightings and overlaps a rejected entry, its
    `list --proposed --json` item carries statement, why, kind, strength, scopes,
    `source.excerpt`, `sightingCount`, and `matches[]` with that id, `status: 'rejected'` and
    the reason. `reject` without `--reason` exits non-zero.
  - An unknown flag on each new verb dies (ADR-029).
  - **C9**: write a phase-22-canonical literal entry file (no sighting or merged keys) into
    the store. `list --all --json` shows it with no damage on stderr, a sighting can be added
    to it, and `show --json` re-reads it. A hand-mangled key order is reported as damaged by
    `list` (stderr `⚠ damaged entry`).

### t12 — CLI: `match`, `sight`, `reopen`, `merge`, review data on `list`/`show`
- **file:** `bin/ac.mjs`
- **depends_on:** t2, t8, t10, t11
- Implement P6 inside the `case 'principles':` block:
  - imports: `proposePrinciple`, `recordSighting`, `matchPrinciple`, `reopenPrinciple` and
    `mergePrinciple` from `../lib/principles.mjs`; `buildReviewQueue` from
    `../lib/principlematch.mjs`;
  - the four allowlist rows, usage lines and the unknown-verb list;
  - `add --propose` reporting;
  - the `list`/`show` JSON enrichment and the text `↳` / `sightings (N):` lines;
  - `show`'s merged status line.

  No new verb reads stdin.
- `node --test tests/principles_review_cli.test.mjs tests/principles_cli.test.mjs tests/principles_sync_cli.test.mjs tests/principles_promote.test.mjs tests/forge_standalone.test.mjs`
  → green.

### t13 — Capture spec: consult candidates before proposing
- **file:** `templates/principle-capture.md`
- **depends_on:** —
- Apply P8.
  - §5's invocation fence stays the FIRST ```sh fence in the file, byte-identical: phase
    23's `extractInvocation` reads the first fence and runs it.
  - The `match` pre-step and the `sight` alternative go in their own `sh` fences AFTER it.
  - §7's existing sentences stay byte-identical, plus the one added sighting sentence.
  - §9 "Known gap" is replaced by "Dedupe".
  - The "only way in" sentence gains `sight`.

  No caller command is edited: the file stays the single source (C13).
- Run `node --test tests/principle_capture.test.mjs tests/commands.test.mjs` → green. No
  test file is edited by this task. If a guard fails, the prose is wrong: fix the prose.

### t14 — `/astro-review` command + help line + reporting-slot guard
- **files:** `commands/astro-review.md` (new), `commands/astro-help.md`, `tests/commands.test.mjs`
- **depends_on:** —
- Write the command per P7, in the structure of `commands/astro-debt.md` (steps, then
  `## Never`), with the pinned step headings. Every reporting slot states its bound inline:
  step 1 "in one line", step 3 "at most four lines" per item, step 5 "one line per failure",
  step 6 "say nothing when there are none" plus "in one line" per entry, step 7 "exactly one
  line".
- `commands/astro-help.md` gets one line near the backlog/debt lines: ``- `/astro-review` —
  walk the proposed personal principles in batches (accept / edit / reject / skip, merge
  duplicates)``.
- `tests/commands.test.mjs`:
  - add `astro-review.md` to `LOOP_COMMAND_SRC`;
  - add SLOTS rows: `1 empty queue` (`1. **Read the queue.` → `2. **Group and batch`),
    `3 item presentation` (`3. **Present each batch` → `4. **Ask`), `5 failed verb`
    (`5. **Act through` → `6. **Rejected entries seen again`), `6 rejected resurfacing`
    (`6. **Rejected entries seen again` → `7. **Report`) and `7 summary` (`7. **Report` →
    `## Never`);
  - add one test asserting that the command names all four choices, requires a reason for
    reject, offers `merge … --into`, reads `list --proposed --json`, uses `reopen` only
    behind an explicit choice, and never mentions writing under `~/.astro/principles`
    except to forbid it.
- `node --test tests/commands.test.mjs tests/forge.test.mjs tests/install.test.mjs` → green
  (install registers every `commands/*.md`, so the new file must be a real command).

### t15 — Docs, canon, final gate
- **files:** `MANUAL.md`, `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** t12, t13, t14
- `MANUAL.md` Principles section: a "Review and dedupe" paragraph covering:
  - exact repeats become sightings on any status;
  - overlap candidates are only surfaced (`ac principles match`), and the capturing agent
    or you decide;
  - `/astro-review` batches;
  - `merge … --into` for duplicates vs `reject` for "no";
  - `reopen` as the only way back from rejected;
  - sightings merge across machines.

  Add cheat-sheet lines for `match`, `sight`, `reopen` and `merge`.
- `node bin/ac.mjs decision add "Principle review specifics this plan pinned: …" --why "…"
  --rejected "…"` covering P1–P6. Record the command's output as-is and never hand-edit
  DECISIONS. The decision states:
  - exact = normalised string equality only;
  - overlap = at least 2 shared non-stopword tokens, surfaced and never acted on;
  - `sighting:` is a repeatable header key, append-only, outside history, count =
    repeats;
  - header order is enforced;
  - `merged`/`merged-into` is a terminal state and merge writes the survivor first;
  - sync unions sightings;
  - `reopen` needs a reason.

  Rejected alternatives: reusing `classifyMatch`/Jaccard, a float score, auto-merge on
  overlap, a sighting counter field (not mergeable), a history line per sighting,
  per-entry evidence caps, reusing `reject` or `superseded-by` for duplicates.
- **Final gate** (C14):
  1. Record a listing of the real `~/.astro/principles` (or its absence).
  2. Run `HOME=$(mktemp -d) node --test tests/` → 0 failures.
  3. Run `node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).length)"`
     → `0`.
  4. Confirm the listing is unchanged.

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t3, t5, t6, t9, t11, t13, t14 |
| 2 | t2, t4 |
| 3 | t7 |
| 4 | t8, t10 |
| 5 | t12 |
| 6 | t15 |

Rule checks:
- **Test-first, serialized.** Every RED task (t1, t3, t6, t9, t11) has empty `depends_on`,
  and each implementation task depends on its RED task (t2←t1, t4←t3, t7/t8←t6, t10←t9,
  t12←t11). Every reference to a not-yet-existing symbol is a dynamic `await import`, and
  the CLI RED file is subprocess-only.
- **No destructive edit.** Nothing is deleted or renamed, so each task leaves the build
  loadable on its own.
  - The one intentional contract reversal, re-propose → sighting, carries both tests it
    breaks inside t7.
  - Adding `merged` and the order check (t4) is proven against the existing suites inside t4.
- **One owner per wave per file.**
  - `lib/principles.mjs`: t5 → t7 → t8, serialized.
  - `tests/principles_cli.test.mjs` and `tests/principle_capture.test.mjs`: t7 only, with
    the behaviour change that obsoletes their old C15 contract (ADR-020: the change and its
    broken consumers land in one task).
  - `tests/principles.test.mjs`: t5 only.
  - `tests/principlemd.test.mjs`: t3 only.
  - `lib/principlemd.mjs`: t4 only.
  - `tests/principlesync.test.mjs`: t9 only.
  - `lib/principlesync.mjs`: t10 only.
  - `bin/ac.mjs`: t12 only.
  - `tests/commands.test.mjs`: t14 only.
  - `templates/principle-capture.md`: t13 only.
  - `.astrocode/debt.json`: t5 only.
  - `.astrocode/DECISIONS*.md` and `MANUAL.md`: t15 only.

  No two tasks in one wave share a file.
- **Every task declares its files and lands a stamped commit.** The final gate is folded into
  t15, so no task is `commits: none`.
