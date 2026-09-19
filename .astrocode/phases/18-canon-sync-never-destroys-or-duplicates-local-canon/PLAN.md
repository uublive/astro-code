# Plan — Phase 18: Canon sync never destroys or duplicates local canon

Design is settled (CONTEXT.md D1–D7, ADR-053) and is **not** open here. This plan only
decides *how* and *in what order*, plus the names CONTEXT.md left to the planner.

## Names fixed by this plan (executors MUST use these, the verifier discovers them from `ac help`)

- Force flag on pull: **`ac canon pull --force`** (git's vocabulary; `canon push --dry-run` is the precedent for a flag on this verb).
- Duplicate-repair verb: **`ac canon dedupe [--dry-run]`** (lives under `canon`, next to `pull`/`push`).
- New module: **`lib/decisions.mjs`** — the single decision-identity/normalization/duplicate
  engine. `lib/canon.mjs`'s private `norm()` is deleted and replaced by it; there must never be
  two normalizers.

## Result shapes fixed by this plan (the CLI only formats what these return; libraries never throw for expected refusals)

```
canonPull(root, { force = false }) -> {
  ok, branch,
  files: { 'DECISIONS.md': { status }, 'CONVENTIONS.md': { status } },   // 'updated' | 'unchanged' | 'refused' | 'absent'
  pulled: [],        // files whose BYTES actually changed  (ADR-053 D7: must agree with the hash)
  unchanged: [],     // files the registry had and that were already current
  refused: [ { file, reason, fixes: [ '...', '...' ] } ],
  preserved: [ 'ADR-099' ],
  collisions: [ { id, kind: 'edited-published' | 'independent', localTitle, remoteTitle } ],
  duplicates: [ { ids: ['ADR-012','ADR-045'], title } ],
}
addDecision(...)  -> on refusal { ok: false, refused: 'decision-collision', collisions }  (NOTHING written, nothing published)
                     on success { ok: true, id, title, date, source, branch, preserved, duplicates, conventionsPublished }
canonDedupe(root, { dryRun = false }) -> { ok, removed: [ { id, keptId, title } ], duplicates, published, branch }
```

`ac canon pull` keeps **exit 0** in every case including a refusal — `commands/astro-execute.md`
and `commands/astro-plan.md` call it *best-effort* inside the agent loop (ADR-034 deliberately
refused to make divergence fatal). The two cases are distinguished by **output**, never by
aborting the run.

## Test posture (declared per ADR-018)

- **Test-after, serialized** for the new engine: each implementation task is followed by (or
  carries) its tests in a file it owns. Chosen deliberately so every wave boundary is green —
  `node --test tests/` must pass at every integration gate (ADR-020).
- **Exception, and it is the one CONTEXT.md demands:** `t1` lands the *reproduction* first, as
  tests that assert TODAY's broken behaviour with a `// PHASE-18 REPRODUCTION` marker. They pass
  on today's code (so the wave stays green) and are **flipped in place** by the task that fixes
  the behaviour, so "reproduced before fixed" is a fact in the commit history rather than a claim.
- Any test that needs a symbol which does not exist yet on the branch MUST reach it with
  `const { fn } = await import('../lib/decisions.mjs')` **inside the async test body** — never a
  static top-of-file import (ADR-018; a missing export must fail only the new test, not load the file).
- Real bare remote + two working copies, never stubs (CONVENTIONS.md "Testing"; copy the
  `mkBareRemote()` / `mkWorkdir()` helpers from `tests/registry.test.mjs`).

---

## Tasks

### t1 — Reproduce both incidents against a real bare remote, as tests that pass today
- **file:** `tests/canon.test.mjs` (new)
- **depends_on:** —
- Stand up the `mkBareRemote()` / `mkWorkdir()` harness (copied from `tests/registry.test.mjs`,
  real git, two workdirs, one bare origin). Then write reproductions that **assert the current,
  wrong behaviour**, each headed with a comment naming the incident and the line it comes from:
  1. **CONVENTIONS clobber:** alice edits + `canonPush`es `CONVENTIONS.md`; bob pulls, edits his
     copy differently, pulls again → assert bob's edit is **gone** and `res.pulled` claims success.
  2. **ADR-142 false positive, dash variant:** the same decision on both sides, one heading with
     `—` and one with `-`, same title/body → assert `canonPull` produces **two** entries.
  3. **ADR-142 false positive, date stamp only:** identical heading style and body, different
     `_YYYY-MM-DD_` line → assert **two** entries.
  4. **Silent renumbering:** same id, genuinely different content → assert today's `renumbered`
     report and the new `ADR-0NN` heading that carries the moved copy.
  Mark each `// PHASE-18 REPRODUCTION — asserts the BUG; flipped by t5/t6.` This is the task that
  turns CONTEXT.md's *inferred* cause into an *observed* one: record in the commit message which
  of (2) and (3) actually reproduces.

### t2 — `lib/decisions.mjs`: the one decision-identity engine (pure, no consumers yet)
- **file:** `lib/decisions.mjs` (new)
- **depends_on:** —
- Named function exports only, module header in the house voice (say *which bug* each rule
  prevents). No consumer imports it yet, so the build stays green on its own.
  - `parseDecisions(text)` → `Map<id, entryText>`; lift the `EOI` entry-splitting regex out of
    `canon.mjs`'s `unionLocalOnly` verbatim (ADR-037 fixed the EOF case there — do not re-derive it).
  - `normalizeDecision(entry)` → identity string. In this order: strip the heading id **and any
    dash variant separator** using an explicit class `[-‐‑‒–—―]`
    (today's `—?` is em-dash-only — suspect #1); strip the `_date_` stamp line with its own
    anchored rule `/^_\d{4}-\d{2}-\d{2}_\s*$/m` — **its own step, not folded into the heading
    strip** (suspect #2); then collapse whitespace and trim.
  - `sameDecision(a, b)` → `normalizeDecision(a) === normalizeDecision(b)`. **Strict equality
    only.** No edit distance, no similarity score, no model judgement — ADR-053 and the prior
    art it cites (an automatic similarity merge removed elsewhere because wrong merges are
    destructive). A comment must say so, so no future reader "improves" it.
  - `findDuplicates(text)` → `[{ ids, title }]` for entries that are exact normalized matches of
    each other (detection only; never mutates).
  - `collapseDuplicates(text)` → `{ text, removed: [{ id, keptId, title }] }`; keeps the
    **lowest-numbered** entry of each exact-match group, removes the rest, touches nothing else.

### t3 — Close the flag hole on `ac canon pull` before it gains a flag
- **file:** `bin/ac.mjs`, `tests/flags.test.mjs`
- **depends_on:** —
- `ALLOWED_FLAGS` has no `'canon pull'` entry and the `pull` branch never calls `checkFlags` —
  so a typo'd flag silently degrades to the default, which is the exact ADR-029 hazard, on the
  one verb this phase exists to harden. Add `'canon pull': []` and `checkFlags('canon pull', flags)`
  as the first statement of the `pull` branch (before any side effect), plus a test in
  `tests/flags.test.mjs` that `ac canon pull --nope` dies with the unknown-flag message. `t9`
  extends the allowlist to `['force']` when the flag actually does something.

### t4 — Spec the identity engine
- **file:** `tests/decisions.test.mjs` (new)
- **depends_on:** t2
- Pure unit tests (no git), sentence-form names, reaching the module with
  `await import('../lib/decisions.mjs')` inside each async test body. Must cover: em dash, en
  dash, plain hyphen and no separator all normalize to the same identity; **a hyphen inside the
  title itself is preserved** (`## ADR-142 — Multi-word Title`) so the fix does not over-strip;
  two bodies differing by a single word are **not** the same decision (both directions: title
  differs, body differs); a `**Why:**` value containing an underscored date-lookalike line is
  **not** eaten by the date-stamp rule; `findDuplicates` reports an exact pair and stays silent
  on a near pair; `collapseDuplicates` keeps the lowest id and leaves near-duplicates alone.

### t5 — Decisions merge on content identity, and a genuine collision REFUSES instead of renumbering
- **file:** `lib/canon.mjs`, `tests/canon.test.mjs`, `tests/flags.test.mjs`
- **depends_on:** t1, t2, t3
- Delete `canon.mjs`'s private `norm()` and route `unionLocalOnly` through `lib/decisions.mjs`
  (`parseDecisions` / `sameDecision`). Rename it to `mergeDecisions(remoteText, localText)`
  returning `{ ok, text, preserved, collisions, duplicates }`:
  - same id + same normalized content → one entry (the convergence case, D2);
  - local-only id → carried verbatim and `preserved` (ADR-034/039 behaviour, unchanged);
  - same id + different content → **`collisions` entry, nothing renumbered, nothing moved**, and
    `ok: false` so the caller leaves `DECISIONS.md` byte-identical (D5). Classify
    `kind: 'edited-published'` when the titles match (the D4 case) and `'independent'` otherwise —
    both refuse, the message differs.
  - `duplicates` carries `findDuplicates` over the merged text (detection is always on, D6).
- `canonPull` stops writing `DECISIONS.md` when `collisions` is non-empty, and writes via
  `atomicWriteText` (from `lib/util.mjs`) when it does write — a bare `writeFileSync` can leave a
  truncated canon behind, which is this phase's failure mode by a different mechanism.
- **Atomic with the removal:** `tests/flags.test.mjs`'s `ADR-039: a local ADR sharing an id with a
  DIFFERENT shared one is kept, renumbered, and reported` asserts the behaviour D5 reverses —
  rewrite it in this task (keep both entries *in place*, assert `collisions`, assert **no** new
  heading appeared and no id changed) or the suite goes red at the wave boundary.
- Flip t1's reproductions (2), (3) and (4) in `tests/canon.test.mjs` to the fixed expectations:
  exactly one entry for the dash variant and for the date-only variant, and for (4) an unchanged
  heading set on both sides plus a reported collision naming both decisions.

### t6 — Pull refuses to overwrite a diverged `CONVENTIONS.md`, and reports per file
- **file:** `lib/canon.mjs`, `tests/canon.test.mjs`, `tests/registry.test.mjs`
- **depends_on:** t5
- `canonPull(root, { force = false })`. The unconditional `writeFileSync(p.conventions, …)`
  becomes, **inside the existing `files[CONVENTIONS_FILE] != null` guard** (so the registry-has-no-copy
  case keeps skipping as it does today):
  - local file missing → write, `status: 'updated'`;
  - local bytes === registry bytes → `status: 'unchanged'`, **no write at all**;
  - local is the **untouched scaffold** (`templates/CONVENTIONS.md` rendered with the project's
    name, placeholder-tolerant) → adopt the registry copy, `status: 'updated'`. This is required,
    not a nicety: without it the first pull on every fresh clone refuses, which is worse than the
    bug being fixed;
  - otherwise → `status: 'refused'` with `fixes: ['ac canon push', 'ac canon pull --force']`,
    **file left byte-identical**, no merge, no `.orig` copy, and never a conflict marker;
  - `force: true` → write and report `status: 'updated'` (forced).
- Same treatment for the report on `DECISIONS.md`: compare the merged text against the bytes on
  disk and only write (via `atomicWriteText`) when they differ. `pulled` now means *bytes actually
  changed*; `unchanged` carries the already-current files. Refusal keeps `ok: true` and does not
  throw — `CONVENTIONS.md` being refused must not stop `DECISIONS.md` from refreshing (per-file, D7).
- **Atomic with the semantic change:** `tests/registry.test.mjs` asserts
  `pull.pulled.includes('DECISIONS.md')` in the "registry claims preserve shared canon" test where
  the local copy is already current — update that assertion (assert `unchanged`/file status) in
  this task, or the wave boundary goes red.
- Flip t1's reproduction (1) in `tests/canon.test.mjs`: bob's edit survives byte-for-byte, the
  result reports `refused` with both routes, and `force: true` replaces it.

### t7 — `ac decision add` publishes `CONVENTIONS.md`, and refuses on a collision or an edited published decision
- **file:** `lib/canon.mjs`, `tests/canon.test.mjs`
- **depends_on:** t6
- Inside the existing `transact` callback (so the CAS still protects it):
  - run `mergeDecisions` as today; if it returns `collisions`, **write nothing, publish nothing**,
    return `{ updates: {}, result: { refused: true, collisions } }` and surface
    `{ ok: false, refused: 'decision-collision', collisions }` to the caller. The add is refused as
    a whole — the heading sets on both sides must be identical before and after (D4/D5). Pre-check
    with `snapshot()` before the transact so the common refusal costs no push attempt.
  - on the success path, add `CONVENTIONS_FILE` to the same `updates` when the local copy differs
    from the branch copy (D3 — the quieter of the two forms CONTEXT.md allows). One transaction, so
    the decision and the conventions land together or not at all. Return `conventionsPublished`.
  - When the branch copy existed and differed, return enough for the CLI to warn that the registry
    copy was replaced — publishing a teammate's copy away silently is the symmetric incident this
    phase must not open.
- Tests in `tests/canon.test.mjs`: alice edits `CONVENTIONS.md` without pushing, `decision add`,
  bob pulls and sees the edit, alice pulls twice and her file is byte-identical both times; bob
  edits a published ADR's body → `decision add` refuses, bob's text is still on disk, alice's and
  the registry's copies still hold the original.

### t8 — Duplicates are reported on every sync and collapsed only when asked
- **file:** `lib/canon.mjs`, `tests/canon.test.mjs`
- **depends_on:** t7
- `canonPull` already carries `duplicates` from `mergeDecisions` (t5) — make sure it is populated
  on **every** call, including a no-op pull, and including when nothing else changed (detection is
  not one-shot). Add `canonDedupe(root, { dryRun = false })`: `collapseDuplicates` on the local
  file (exact normalized matches only), `atomicWriteText`, and — when a coordinated remote exists —
  republish the collapsed `DECISIONS.md` through `transact`, re-running `mergeDecisions` inside the
  CAS callback so a concurrent entry is never lost. This is the **only** sanctioned bulk write of
  `DECISIONS.md`; say why in a comment right next to `canonPush`'s "never bulk-pushed" note.
  `dryRun` reports what it would remove and writes nothing.
- Tests: a planted content-identical pair is reported by two successive pulls and still on disk
  after both; `canonDedupe` leaves exactly one, reports which id went, and leaves the
  near-duplicate pair from t4's spec untouched.

### t9 — CLI: `--force`, `ac canon dedupe`, and output that never says the same thing twice
- **file:** `bin/ac.mjs`
- **depends_on:** t3, t6, t7, t8
- `ALLOWED_FLAGS`: `'canon pull': ['force']`, `'canon dedupe': ['dry-run']`; `checkFlags` on both
  branches before any side effect. Help text (`ac canon [pull [--force] | push [--dry-run] | dedupe [--dry-run]]`).
- Replace the single `✓ pulled … from <branch>` line — the literal signature of both incidents —
  with a per-file report built from `res.files`, using the existing `✓`/`⚠`/`•`/`◆` vocabulary:
  - nothing changed → `✓ canon already current on <branch> — nothing changed (DECISIONS.md, CONVENTIONS.md)`;
  - partial → `✓ pulled CONVENTIONS.md from <branch> (DECISIONS.md already current)`;
  - refusal → `⚠ CONVENTIONS.md NOT overwritten — your copy differs from <branch>. Publish yours: \`ac canon push\`. Take the registry's and discard your edits: \`ac canon pull --force\`.`;
  - collision → `⚠` naming **both** decisions (id + title, local and registry side), stating that
    nothing was renumbered and nothing written, and naming supersession (`ac decision add` recording
    a decision that supersedes the old one) as the supported path for an edited published decision;
  - duplicates → `⚠` listing each pair's ids and title, pointing at `ac canon dedupe`;
  - keep the existing `preserved` warning; delete the `renumbered` warnings in both the `canon` and
    `decision` branches (nothing renumbers any more).
- `decision add`: handle `res.ok === false` (print the collision refusal, exit non-zero via `die`
  is acceptable here — it is a direct user action, not the best-effort pipeline call), and report
  `conventionsPublished` plus the "replaced the registry's differing copy" warning.
- `ac canon dedupe` branch: `✓ collapsed N duplicate decision(s): ADR-045 (kept ADR-012)`, or
  `✓ no exact duplicate decisions in DECISIONS.md`, and `◆ dry run: … NOTHING was changed.`
- **Exit 0 stays the rule for `canon pull`** in every branch including refusal — the agent loop
  calls it best-effort and an abort there is the failure mode ADR-034 refused.

### t10 — CLI-level proof that the two runs are distinguishable
- **file:** `tests/canon.test.mjs`
- **depends_on:** t9
- Spawn the real CLI (the `run([...], dir)` helper pattern in `tests/flags.test.mjs`) against the
  bare-remote harness and assert on stdout+stderr, not on the result object: a clean no-op pull and
  a refused pull produce **different** output; a pull that changed only `CONVENTIONS.md` names
  `DECISIONS.md` as already current; the refusal text contains both `ac canon push` and `--force`;
  the collision text contains both ids; exit status is 0 for every `canon pull` variant.

### t11 — Tell the agent loop what a refusal means
- **file:** `commands/astro-execute.md`, `commands/astro-plan.md`
- **depends_on:** t9
- Both already say "refresh the team canon best-effort (`ac canon pull`)". Add one sentence each:
  a refusal or collision warning is **not** a failure to retry or force — report it in the run
  summary and continue; never pass `--force` from an agent. Keep the existing wording and tier
  structure otherwise.

### t12 — Link the three `lib/canon.mjs` debt items to this phase
- **file:** `.astrocode/debt.json`
- **depends_on:** t10, t11
- The register's three open items are this phase's subject, not riders:
  `2026-09-17-a-canon-sync-that-finds-same-id` (D5), `2026-09-17-ac-canon-push-publishes-conventions-md`
  (D4), `2026-09-17-nothing-publishes-conventions-md-when-a` (D1/D3). Link each to this phase so
  `ac phase accept` drains them (`payDebt(root, id, { kind: 'phase', workRef: '18-canon-sync-never-destroys-or-duplicates-local-canon' })`
  — `ac debt pay --as phase` would claim a NEW phase, which is wrong here). Do not use `debt drop`:
  these were fixed, not abandoned. Finish by running `node --test tests/` and recording the result.

---

## Wave shape

| wave | tasks | files |
|---|---|---|
| 1 | t1, t2, t3 | `tests/canon.test.mjs` · `lib/decisions.mjs` · `bin/ac.mjs` + `tests/flags.test.mjs` |
| 2 | t4, t5 | `tests/decisions.test.mjs` · `lib/canon.mjs` + `tests/canon.test.mjs` + `tests/flags.test.mjs` |
| 3 | t6 | `lib/canon.mjs` + `tests/canon.test.mjs` + `tests/registry.test.mjs` |
| 4 | t7 | `lib/canon.mjs` + `tests/canon.test.mjs` |
| 5 | t8 | `lib/canon.mjs` + `tests/canon.test.mjs` |
| 6 | t9 | `bin/ac.mjs` |
| 7 | t10, t11 | `tests/canon.test.mjs` · `commands/*.md` |
| 8 | t12 | `.astrocode/debt.json` |

`lib/canon.mjs` is one file and every behavioural change lands in it, so t5→t6→t7→t8 is a
deliberate serial chain — splitting them across a wave would collide at integration. Each of them
leaves `node --test tests/` green on its own, because the test files whose expectations it reverses
are edited **in the same task**.

## Criteria coverage

| criterion | tasks |
|---|---|
| C1 diverged `CONVENTIONS.md` refusal | t6, t9, t10 |
| C2 both escapes work (`push`, `--force`) | t6, t9, t10 |
| C3 same decision converges to one entry | t1, t2, t4, t5 |
| C4 similar ≠ same, never merged | t2, t4, t8 |
| C5 same-id collision refuses, no renumbering | t5, t7, t9 |
| C6 edited published decision refused, supersession named | t5, t7, t9 |
| C7 `decision add` publishes `CONVENTIONS.md` | t7 |
| C8 duplicates always reported, collapsed only on request | t8, t9 |
| C9 per-file report, no-op says so | t6, t9, t10 |
| C10 suite green, real remote, debt closed | t4, t5, t6, t7, t8, t10, t12 |
