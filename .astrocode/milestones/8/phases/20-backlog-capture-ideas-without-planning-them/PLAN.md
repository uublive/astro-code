# Plan — phase 20: Backlog, capture ideas without planning them

Obeys `.astrocode/CONVENTIONS.md` (zero deps, named exports only, `node:` builtins,
`die()`/`✓`/`•`/`⚠` glyphs, a test per engine change), `.astrocode/DECISIONS.md`
(ADR-056 peer object; ADR-029 per-verb flag allowlist; ADR-018 red-test imports;
ADR-020 wave-green), this phase's `CONTEXT.md` (D1–D5) and aims at every criterion in
`CRITERIA.md` (C1–C9).

Test strategy: **test-first** for every behavioural task. Each RED-test task is paired
with its implementation task **in the same wave** (identical `depends_on`), so the wave
boundary integrates red + green together and compiles. Every RED test that touches a
symbol which does not exist yet on the branch uses
`const { fn } = await import('../lib/backlog.mjs')` **inside an async test body**
(ADR-018) — never a static top-level import. Tests that only drive the CLI as a
subprocess (`spawnSync(process.execPath, [AC, …])`) or use already-shipped exports may
import statically.

---

## Decisions this plan pins (answers to CONTEXT.md's three open questions)

**Q1 — a linked item whose phase is REJECTED.** It reverts to `open`. One shape, two
call sites, mirroring `paid_by`/`closeDebtFor`: linking writes
`linked_by: { kind: 'phase', ref: <slug> }` and `status: 'linked'`;
`closeBacklogFor(root, {kind, workRef})` (called from `ac phase accept`) sets
`status: 'absorbed'`, keeps `linked_by` as the record of which phase closed it, and
stamps `absorbed_at`; `reopenBacklogFor(root, {kind, workRef})` (called from
`ac phase reject`) sets `status: 'open'`, stamps `reopened_at`, and moves `linked_by`
to `previously_linked_to` so the history of the failed attempt is not erased. Both
lookups key on the same `linked_by.kind`/`linked_by.ref` pair. (C2.)

**Q2 — the CONTEXT.md a promotion seeds.** Built by a pure function
`promotionContext(item, { number })` in `lib/backlog.mjs`, from fixed string literals
plus the item's own fields. Exact shape:

```
# Phase <number> — <title>

_Promoted from the backlog (`<id>`, captured <YYYY-MM-DD>). This is a captured note,
not a discussion — run `/astro-discuss <number>` before planning._

## The idea, as captured

<note verbatim, or the title again when there is no note>
```

It carries **no** `<!-- astro-discuss: captured -->` marker, so `phaseContextStatus`
reads `stub` and `/astro-plan` still demands a real discuss round (D2). The captured
note is passed through `String(body).replace(/<!--[\s\S]*?-->/g, '')` first, so the
file *structurally cannot* contain the marker even if a user typed it into their idea —
"don't add it" is not enough, because a paste or a future template edit defeats that.
(C3, and the seeded-placeholder trap `tests/planning.test.mjs` already documents.)

**Q3 — `ac backlog list` ordering.** Oldest-first, ascending by id, exactly like
`openDebt`: the id is date-prefixed, so oldest-first is chronological and stable.
Staleness is a **flag, not an order** — `⚠ N days old` at `BACKLOG_STALE_DAYS = 30`,
the value debt uses, declared locally in `backlog.mjs` (never imported from
`lib/debt.mjs`: coupling the two modules is the entanglement ADR-056 exists to avoid).

**One more decision the surface needs.** D1's drain has no inflow without a link verb,
and C2 requires linking to be drivable from the shipped surface, so the CLI gains
`ac backlog link <id> --phase <n>` alongside `add|list|show|promote|archive`. It is the
peer of `ac debt pay --as phase` minus the phase creation — and it is what
`/astro-discuss`'s fold-in actually runs.

**`ac status` at zero.** The `Backlog: N open` line is **suppressed when the count is
zero or the file is absent**, byte-for-byte the shape of the existing `Debt:` line and
the CONVENTIONS "say nothing when there is nothing to report" rule. C6's Observe is
satisfied by the count tracking 3 → 1; its legacy-project clause is covered by a test
that `ac status` in a project with **no** `backlog.json` exits 0 and prints no backlog
line and no error.

**Not built (CONTEXT.md "Out", C7):** no priority/rank/score field on the item record,
no statusline segment, no change to `hooks/_astro-ctx.mjs`, no registry or
orphan-branch storage for items, no `--as fix` promotion path.

---

## Engine API contract (t1 and t2 must agree on this exactly)

`lib/backlog.mjs`, named exports only:

```
BACKLOG_STATUSES = ['open','linked','promoted','absorbed','declined','obsolete']
ARCHIVE_KINDS    = ['declined','obsolete']        // 'absorbed' is never human-typed
BACKLOG_STALE_DAYS = 30

backlogId(title, now)                    -> datedId(title, now, 40, 'idea')
loadBacklog(root)                        -> { version, backlog: [...] }   (strict reader)
openBacklog(root)                        -> items with status open|linked, oldest id first
findBacklog(root, ref)                   -> item | null  (id → -suffix → substring → title word)
backlogAgeDays(entry, now)               -> whole days since captured_at
addBacklog(root, {title, note, now})     -> { entry, similar: [{id,title,match}] }
linkBacklog(root, ref, {kind,workRef,now})   -> entry  (status 'linked')
closeBacklogFor(root, {kind,workRef,now})    -> closed[]   (status 'absorbed')
reopenBacklogFor(root, {kind,workRef,now})   -> reopened[] (status 'open')
markPromoted(root, ref, {number,slug,now})   -> entry  (status 'promoted', promoted_to)
archiveBacklog(root, ref, {kind,reason,now}) -> entry  (status = kind)
declinedMatches(root, name)              -> [{id,title,reason,match}] from declined items only
promotionContext(item, {number})         -> string (pure; no astro-discuss marker)
```

Item record (nothing else; **no** priority/rank/score — C7):
`{ id, title, note?, status, captured_at, linked_by?, linked_at?, absorbed_at?,
previously_linked_to?, reopened_at?, promoted_to?{number,slug}, promoted_at?,
archived_at?, archive_kind?, archive_reason? }`

---

## Tasks

### t1 — RED: engine tests for the backlog register
- **file:** `tests/backlog.test.mjs` (new)
- **depends_on:** —
- Mirror `tests/debt.test.mjs` one-for-one: `node:test`, `node:assert/strict`, real
  `mkdtempSync` projects seeded with `initPlanning`, a fixed `NOW`, no mocks.
- **Every** reference to `lib/backlog.mjs` goes through
  `const { … } = await import('../lib/backlog.mjs')` inside an async test body
  (ADR-018). Static imports are allowed only for `../lib/planning.mjs` and
  `../lib/paths.mjs`, which already exist.
- Cover, as sentence-form test names that read as the spec:
  - id is date-prefixed with the `idea` fallback (`backlogId('!!! ???', NOW)`).
  - absent `backlog.json` reads as empty; a file that exists but is damaged (invalid
    JSON, and valid JSON without a `backlog` array) **throws**, and a write path on a
    damaged file throws rather than overwriting it with an empty register — the
    2026-09-18 debt incident, transplanted.
  - capture keeps the full note, returns `similar` for a resembling **open** item, and
    still records the new item (never merges, never blocks) — C5's capture half.
  - `openBacklog` is oldest-first and counts `open` + `linked` only.
  - link → accept-drain → `absorbed`, keeping `linked_by`; drain on a phase slug with
    no links closes nothing; reject-revert → `open`, `previously_linked_to` kept — C2.
  - `archiveBacklog` requires a non-empty reason, refuses a kind outside
    `declined|obsolete` (explicitly including `absorbed`), and leaves the item
    **unchanged** on every refusal (re-read the register to prove it) — C4.
  - `declinedMatches` finds a resembling `declined` item with its reason and ignores an
    `obsolete` one — C5's plan-time half.
  - `promotionContext` output contains the note verbatim, and a note that itself
    contains `<!-- astro-discuss: captured -->` still yields a file that
    `phaseContextStatus` classifies as `stub` (write it to
    `.astrocode/phases/<slug>/CONTEXT.md` and assert) — C3/D2.
  - an item record carries no `priority`, `rank` or `score` key — C7.

### t2 — The backlog engine
- **files:** `lib/backlog.mjs` (new), `lib/paths.mjs`, `lib/registry.mjs`
- **depends_on:** —
- `lib/paths.mjs`: add `backlog: join(dir, 'backlog.json')` beside `debt`, with the
  same style of comment saying why it is a flat file with no per-item directory (an
  idea has no artifacts until it is promoted, and from then the phase owns them).
- `lib/registry.mjs`: add `export` to `classifyMatch` (one word) and a short comment
  saying why it is now public — the backlog's duplicate check is **local-only** (no
  registry claims, ADR-056), so it needs the Jaccard primitive without
  `findNameMatches`'s remote snapshot. Do not change its behaviour, do not add a
  backlog claim type, do not touch `findNameMatches`/`computeMatches`.
  *(Folded into this task, not split: `backlog.mjs` importing a symbol that is not yet
  exported is a module-load failure, so the export and its consumer must land
  together — ADR-020.)*
- `lib/backlog.mjs`: implement the contract above. Module header in the voice of
  `lib/debt.mjs`'s: why a backlog is a peer object and not a debt status (lift
  ADR-056's reasoning — score corruption, `drop`/`dismiss` not mapping to an idea,
  verifier-filed integrity), and why the outflow is automatic.
  - Strict reader copied from `debt.mjs`'s `readRegister` (`readJSONStrict(path, null,
    'the backlog')` + an array-shape check that throws and names the repair command),
    **not** `fixes.mjs`'s permissive `|| {…}` fallback. Every writer reads through it.
  - `backlogId` = `datedId(title, now, 40, 'idea')` imported from `lib/fixes.mjs`;
    same-id collision gets the `-2`, `-3` suffix `addDebt` uses.
  - One `withLock` per exported mutator, taken once, never nested inside another locked
    callback; re-read → mutate → `atomicWriteJSON`, exactly as `debt.mjs` does.
  - `archiveBacklog` validates kind and reason **before** taking the lock and refuses
    an item that is already `absorbed`/`promoted`/archived.
  - No import of `lib/debt.mjs` and no import of `hooks/_astro-ctx.mjs` — the two
    registers stay unentangled (C7).

### t3 — RED: the `· planned` marker survives `phase add` and `phase note`
- **file:** `tests/cli.test.mjs`
- **depends_on:** —
- Static imports are fine here: `addPhase`, `setPhaseNote`, `renderRoadmap`,
  `isPhasePlanned` all already exist.
- Add tests next to the existing roadmap-render ones: in a temp project with two
  phases, give phase 1 a `PLAN.md`, `renderRoadmap(root)`, then (a) `addPhase` a third
  phase and (b) `setPhaseNote` on phase 2 — after each, `ROADMAP.md`'s phase-1 line
  still ends in `· planned` **and** the newly added phase / note is present (the fix
  must not be "stop re-rendering"). Add the same assertion for `setPhaseStatus` and
  `setPhaseMilestone` so the next writer cannot regress. C8.

### t4 — Fix the planned-flag strip in every roadmap writer (folded-in debt)
- **file:** `lib/roadmap.mjs`
- **depends_on:** —
- Introduce one internal writer — `writeRoadmapMd(root, rm)` — that enriches
  `rm.phases` with `planned: isPhasePlanned(root, p.slug)` in memory and then
  `atomicWriteText(p.roadmapMd, renderRoadmapMd(enriched))`, and route **all five**
  current call sites through it: `setPhaseStatus`, `setPhaseEffort`, `setPhaseNote`,
  `setPhaseMilestone`, `addPhase`. Fixing it in the shared writer, not per call site,
  is deliberate: `ac backlog promote` becomes a new caller of `addPhase` in t7 and gets
  the fix for free instead of needing a sixth patch. Keep `setMilestone`'s existing
  `renderRoadmap(root)` route and its comment.
- Comment why (disk-derived flag, never persisted; rendering from the raw in-memory
  object strips `· planned` off every line the command never touched).
- After the code change, link the folded-in debt item so it drains at acceptance like
  phase 18's did: run a throwaway script (not committed) that calls
  `payDebt(root, '2026-09-17-ac-phase-add-and-ac-phase-note-strip', { kind: 'phase',
  workRef: '20-backlog-capture-ideas-without-planning-them' })`, and commit the
  resulting `.astrocode/debt.json`. Never hand-edit that file.

### t5 — CLI: the `ac backlog` verb group
- **file:** `bin/ac.mjs`
- **depends_on:** t2
- New `case 'backlog':` following the `case 'debt':` shape exactly (`const r = root();
  const sub = pos[0];`, `if (!sub || sub === 'list')`, resolve-then-verb via
  `findBacklog`, `die()` on an unknown sub naming every verb).
  - `ac backlog add "<idea>" [--note "<short paragraph>"]` → `✓ backlog <id>`; on
    `similar` hits print `⚠ similar open idea(s):` and one line per hit, then still
    exit 0 (D5/D6 posture: warn and proceed). Warn in one line when the note exceeds a
    short paragraph (~600 chars) — "if you are writing a plan, it is a phase" — and
    still capture.
  - `ac backlog list [--all] [--json]` → oldest first, two lines per item (id + status
    + age, then the title), `⚠ N days old` past `BACKLOG_STALE_DAYS`, `--all` includes
    closed items with their kind/reason, closing count line; `• no open ideas` when
    empty.
  - `ac backlog show <id>` → `json(item)`.
  - `ac backlog link <id> --phase <n>` → resolve the phase with `findPhase`,
    `linkBacklog(..., { kind: 'phase', workRef: ph.slug })`, one line saying it closes
    when that phase is accepted.
  - `ac backlog promote <id>` → the `ac debt pay --as phase` block verbatim in
    sequence: `loadState`/`loadRoadmap` → milestone → `claim()` → `addPhase()` (wrapped
    in the same try/catch that says the number was spent and will not be reissued) →
    write `promotionContext(item, { number })` to
    `.astrocode/phases/<slug>/CONTEXT.md` → `markPromoted()` → `warnNameMatches`. The
    two local writes go **last** so a crash never leaves an item marked promoted with
    no phase. **Idempotent:** if the item already has `promoted_to`, `die()` naming the
    existing phase **before** calling `claim()`, so a retry never spends a second
    number. Closing line points at `/astro-discuss <n>` — the seed is a note, not a
    discussion.
  - `ac backlog archive <id> --kind declined|obsolete --reason "…"` → `die()` with the
    usage line when either is missing or the kind is unrecognised (including
    `absorbed`), otherwise `✓ archived <id> (<kind>): <reason>`.
- `ALLOWED_FLAGS` (ADR-029): `'backlog add': ['note']`, `'backlog link': ['phase']`,
  `'backlog archive': ['kind', 'reason']`, `'backlog promote': []`. Call
  `checkFlags(...)` before any side-effecting work. `list`/`show` stay unguarded
  (read-only).
- Add the import of the engine and the `ac backlog …` lines to `HELP`.

### t6 — RED: CLI tests for capture, archive and promotion
- **file:** `tests/backlog_cli.test.mjs` (new)
- **depends_on:** t2
- Subprocess-driven, in the shape of `tests/flags.test.mjs` (`mkBareRemote` +
  `mkWorkdir` + `spawnSync(process.execPath, [AC, …])`). Static imports are safe —
  only already-shipped modules are imported; the not-yet-built surface is exercised as
  a child process, so a missing verb is a non-zero exit, not a module-load crash.
- Cover:
  - **C1:** capture two ideas in a project with **no remote and no registry**; both
    come back from a second `ac backlog list` process with their text intact and
    distinct ids; `roadmap.json` and `ROADMAP.md` are byte-identical to copies taken
    before the captures.
  - **C5 (capture half):** a new idea resembling an open one prints a `⚠` naming it and
    exits 0 with the new item recorded.
  - **C4:** archive with kind+reason is retrievable verbatim from `list --all`/`show`;
    missing reason, missing kind, and `--kind absorbed` each exit non-zero and leave
    the item open and unchanged.
  - **C3:** capture an item whose note holds a sentinel sentence, `ac backlog promote`
    it in a project with a registry — `ac registry show` lists the claim, the roadmap
    gains the phase, `CONTEXT.md` contains the sentinel, `ac phase context <n>` prints
    `stub`, the item leaves the open list; a second `promote` of the same id exits
    non-zero and claims no second number (compare `ac registry show` before/after).
  - **C7:** `ac debt score --json`, `ac debt list --json` and the statusline segment
    output are byte-identical before and after capturing 5 items and archiving 1.

### t7 — CLI wiring: status line, declined warning, accept drain, reject revert
- **file:** `bin/ac.mjs`
- **depends_on:** t5
- `ac status`: after the `Debt:` block, `const back = openBacklog(r); if (back.length)
  console.log(...)` — `Backlog:   N open  — \`ac backlog list\`` — suppressed at zero,
  never throwing when `backlog.json` is absent.
- `ac phase add`: after the existing `warnNameMatches(res.matches, …)`, call
  `declinedMatches(r, name)` and, for each hit, print a `⚠` line carrying the item's
  title **and its archive reason**. Never blocks, never demands `--force`, exit stays
  0, and the phase is still created (D5/D6).
- `ac phase accept`: immediately after the `closeDebtFor` loop, the same top-level
  `await closeBacklogFor(r, { kind: 'phase', workRef: ph.slug })` loop, one `✓ backlog
  <id> absorbed` line each. Not nested inside any other lock scope.
- `ac phase reject`: `await reopenBacklogFor(r, { kind: 'phase', workRef: ph.slug })`,
  one `• backlog <id> back on the list` line each, silent when it reopened none.

### t8 — RED: tests for the drain, the revert, the status line and the declined warning
- **file:** `tests/backlog_drain.test.mjs` (new)
- **depends_on:** t5
- Same subprocess harness as t6 (real bare remote + `ac registry init` for the phase
  claims). Cover:
  - **C2:** capture → claim a phase → `ac backlog link` → `ac phase accept <n> --by v
    --force`: the item is gone from the open list, `show` reports `absorbed` and still
    names the phase that closed it. A second item linked to a second phase that is
    **rejected** is `open` again and can then be promoted. An unlinked item is
    untouched by either.
  - **C6:** `ac status` prints no backlog line on an empty backlog, then tracks
    3 → 1 across a capture ×3, an archive and a promotion; and in a project whose
    `.astrocode/` has **no `backlog.json` at all**, `ac status` exits 0, prints no
    backlog line, and prints no error.
  - **C5 (plan half):** with one `declined` and one `obsolete` item archived,
    `ac phase add "<name like the declined one>"` exits 0, prints the item **and its
    reason**, and the phase is created with a claimed number (assert against
    `ac registry show` and the roadmap); `ac phase add "<name like the obsolete one>"`
    raises no such warning and still creates the phase.

### t9 — Slash commands: `/astro-backlog` and `/astro-backlog-promote`
- **files:** `commands/astro-backlog.md` (new), `commands/astro-backlog-promote.md` (new)
- **depends_on:** t5
  *(Depends on the CLI because `tests/contracts.test.mjs` fails any command doc that
  names an `ac` subcommand the CLI does not implement.)*
- `astro-backlog.md` — frontmatter `description` / `argument-hint: "[<idea>]"` /
  `allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion`, modelled on
  `astro-debt.md`. Two modes: with `$ARGUMENTS`, capture (`ac backlog add`) and relay a
  similarity warning **in one line**; with no arguments, review — `ac backlog list`,
  present it as one line per item with `⚠` on stale ones, then **one**
  `AskUserQuestion` offering the exits (promote → `/astro-backlog-promote <id>`, fold
  into a phase → `ac backlog link <id> --phase <n>`, archive declined, archive
  obsolete, leave it). Required literal step anchors (t13 keys the shape guard off
  them): `1. **Read the backlog.`, `2. **Present it`, `3. **Offer the exits`. Say
  nothing beyond one line when the backlog is empty. Never archive without a reason
  typed by the human; never mark an item absorbed by hand — that is the acceptance
  gate's job.
- `astro-backlog-promote.md` — frontmatter as above, structured like `astro-fix.md`.
  Required literal step anchors: `1. **Confirm the idea is still worth a phase`,
  `2. **Promote it`, `3. **Say what happened`. Step 1 asks (one `AskUserQuestion`)
  whether the idea is still worth a phase before anything is claimed — a spent phase
  number is not reissued. Step 2 runs `ac backlog promote <id>`. Step 3 reports the new
  number **in one line** and points at `/astro-discuss <n>`, stating explicitly that
  the seeded `CONTEXT.md` is the captured note and does **not** satisfy the discuss
  gate. A "Notes" section records that promotion targets a phase only, never a fix
  (D3), and that something which turns out to be broken behaviour goes to `/astro-fix`.

### t10 — `/astro-discuss`: offer the fold-in, after the debt prompt
- **file:** `commands/astro-discuss.md`
- **depends_on:** t9
- New step `1c.` immediately after `1b.` (the debt prompt) and before `2. **Map the
  gray areas.**`, starting with the literal anchor
  `1c. **Check the backlog for ideas this phase would absorb.**`.
- Shape it on 1b: run `ac backlog list`; if anything open is relevant, raise **one**
  `AskUserQuestion` naming the items **one line each** — never a table — offering
  "Fold them in" / "Leave them". On fold-in, run `ac backlog link <id> --phase <n>` for
  each **and** record them in CONTEXT.md as explicit in-scope items. Ask **once**.
  **Say nothing at all** when there is no relevant open item, and never let this
  displace the phase's own questions — the phase goal is the subject, folded-in ideas
  are at most a rider. State that a linked item closes by itself when `/astro-accept`
  closes this phase, so nobody ticks it off by hand.

### t11 — `/astro-accept`: say what the acceptance drained
- **file:** `commands/astro-accept.md`
- **depends_on:** t7
- In step 4, immediately after the "All criteria hold" bullet and before the
  "**Who is signing (ADR-033)**" block, add a paragraph starting with the literal
  anchor `**Backlog items linked to this phase close here.**`: `ac phase accept` closes
  every linked backlog item as `absorbed` and prints one line each — relay them **in at
  most two lines**, and **say nothing** when it closed none. State that a rejection puts
  a linked item back on the list, so nothing is silently lost either way.

### t12 — `/astro-phase`: surface what you already decided against
- **file:** `commands/astro-phase.md`
- **depends_on:** t7, t9
- New step between the current 1 and 2, starting with the literal anchor
  `1b. **Check what you already decided against.**`: `ac phase add` warns when the name
  resembles an item archived as `declined`. When it does, relay the item and its reason
  **in one line** and raise one `AskUserQuestion` — proceed anyway / show me what I
  wrote / stop. Say nothing when there is no match. State that this never blocks and
  never needs `--force`, and that an `obsolete` archive deliberately raises nothing
  ("the world moved on" is not an argument against a fresh idea).

### t13 — Extend the reporting-slot shape guard to the new slots
- **file:** `tests/commands.test.mjs`
- **depends_on:** t9, t10, t11, t12
- Add `astro-phase.md`, `astro-backlog.md` and `astro-backlog-promote.md` to
  `LOOP_COMMAND_SRC` (the guard must reach the new surface — C9), and add `SLOTS`
  entries, using the literal anchors pinned in t9–t12:
  - `astro-discuss.md` — `1c backlog fold-in`: start `1c. **Check the backlog`,
    end `2. **Map the gray areas`.
  - `astro-accept.md` — `4 backlog drain`: start `**Backlog items linked to this phase`,
    end `**Who is signing`.
  - `astro-phase.md` — `1b declined match`: start `1b. **Check what you already decided
    against`, end ``2. Run `ac phase add``.
  - `astro-backlog.md` — `1 empty backlog`, `2 item presentation`, `3 exit taken`
    (anchored on the three step headings).
  - `astro-backlog-promote.md` — `1 still worth a phase`, `3 promotion reported`.
- Do not weaken `BOUND_RE` or `assertSlotBound`; if a slot fails, fix the prose in the
  command file, not the guard.

### t14 — Docs: the backlog on the command surface
- **files:** `MANUAL.md`, `commands/astro-help.md`
- **depends_on:** t9
- `MANUAL.md`: a short subsection beside the debt one explaining what the backlog is for
  and why it cannot rot (linked at discuss, closed at accept), plus entries in the
  slash-command list (`/astro-backlog`, `/astro-backlog-promote`) and in the `ac` cheat
  sheet (`add`, `list`, `link`, `promote`, `archive`). Only subcommands the CLI actually
  has — `tests/contracts.test.mjs` checks every `ac …` in a code span.
- `commands/astro-help.md`: one line for each of the two new commands in the relevant
  section.

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t2, t3, t4 |
| 2 | t5, t6 |
| 3 | t7, t8, t9 |
| 4 | t10, t11, t12, t14 |
| 5 | t13 |

Each boundary compiles and the suite is green: t1/t2 and t3/t4 pair red tests with
their implementation inside one wave; t6/t5 and t8/t7 do the same; no task deletes or
renames a module or symbol, so no consumer fixups are split across tasks; `bin/ac.mjs`
is owned by t5 then t7 (serialized), `tests/commands.test.mjs` only by t13, and every
command doc by exactly one task.

## Definition of done

`node --test tests/` green from the repo root, with no test skipped, and every
criterion in `CRITERIA.md` drivable from the shipped CLI exactly as its *Observe*
paragraph describes.
