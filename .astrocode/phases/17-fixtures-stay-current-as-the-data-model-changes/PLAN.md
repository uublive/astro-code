# PLAN — Phase 17: Fixtures stay current as the data model changes

Three layers, already settled in ADR-050/ADR-052 and CONTEXT.md D1–D11 and **not reopened
here**: the rule in the generated project's canon, the behavioural `CRITERIA.md` entry the
verifier runs, and an advisory `ac` verb in `ac preflight`'s posture. This plan only pins the
specifics those decisions deliberately left open (verb name, declaration format, output
shape) and schedules the work.

**Testing strategy (declared, per ADR-018): test-after serialization, NOT RED-first.**
The wave model integrates and runs the suite at every boundary (ADR-020) — a task that lands
a deliberately-red `tests/fixtures.test.mjs` in an earlier wave than its implementation bails
the integration gate for the whole wave, which is a worse failure than a one-wave-late test.
So `t3` (the real behavioural cover) `depends_on` `t2` (the engine), and the same for every
prose-guard pair (`t6`←`t4`/`t5`, `t8`←`t7`, `t10`←`t9`). No task statically imports a symbol
that does not exist on its branch; `t3` exercises the verb the way the criteria do — by
spawning `node bin/ac.mjs fixtures check` in a real scratch git repo — plus
`await import('../lib/fixtures.mjs')` inside async test bodies for the unit-level helpers.

**Wave-green:** every task is purely additive (a new module, a new `case` arm, new prose,
new tests). Nothing is deleted or renamed, so no task can leave a wave boundary
non-compiling. The two tasks that *could* break a boundary on their own are `t4`/`t5`
(command prose naming `ac fixtures check`): `tests/contracts.test.mjs` derives the valid `ac`
subcommand set from the `case '…':` arms in `bin/ac.mjs`, so prose naming a verb that does
not exist yet turns the suite red. They therefore `depends_on: t2` rather than riding the
same wave.

**Environment fact, checked at planning time (it is what blocked phase 16):** the `host`
bridge is reachable from this container and Docker answers through it —
`host "docker compose version"` → `Docker Compose version v5.3.1`. The quoting matters: a
bare `host docker compose version` is rejected by the shell allowlist before it runs, because
the allowlist reads the first token. `t15` uses the quoted form. (A forge-knowledge lookup
returned only a low-confidence, unrelated entity-resolution note — nothing to reuse; the
standing *prove-before-automating* principle CONTEXT.md D11 cites is what `t14`/`t15` serve.)

---

## Pinned values — every task below uses these verbatim

The declaration format is the one thing the doc task, the engine task, the two scaffolding
commands and both rehearsals must agree on letter-for-letter; C6 fails outright if the real
format is one only the implementation knows.

| Thing | Pinned value |
|---|---|
| The verb | `ac fixtures check [--phase <N>]` — `check` is the only subcommand; `--phase` is the only flag, defaulting to `state.json`'s `active_phase` (its leading number) |
| Flag guard | `ALLOWED_FLAGS['fixtures check'] = ['phase']` (ADR-029) — a typo'd `--phase` must not silently degrade into "checked the wrong phase" |
| Engine module | `lib/fixtures.mjs`, named exports only: `readFixtureDeclaration(root)`, `phaseStampedPaths(root, phase)`, `checkFixtures(root, { phase })` (pure, no writes), `runFixturesCheck(root, { phase })` (async: decides, files debt, returns the result) |
| Declaration home | the project-root **`RUN-CONTRACT.md`** copy (never `.astrocode/`, never the project's CONVENTIONS.md — D4) |
| Declaration section | `## 10. Data model & fixtures declaration` in `templates/RUN-CONTRACT.md` |
| Declaration block | the marker line `<!-- astro-code: fixtures-declaration -->` at line start, followed by the two keys, one per line: `data-model: <comma-separated repo-relative paths>` and `seed: <comma-separated repo-relative paths>` |
| Shipped default | the template ships the block **live but empty** (`data-model:` / `seed:` with no values) — so an un-opted-in project is "not checked" by construction and there is no placeholder example that could read as a real declaration |
| Path semantics | repo-relative; a trailing `/` means "this directory and everything under it", anything else matches that exact path or that path as a directory prefix. No globs, no inference (D5 rejected heuristics) |
| "Not checked" | no `RUN-CONTRACT.md`, no marker, or **either** key empty → one `⊡` line naming which of the two is missing |
| Commit scope | the phase's own ADR-017 stamps only: `git log --format=%H --fixed-strings --grep "(phase <N> t"` run for **both** the padded (`07`) and unpadded (`7`) forms, then `git show --pretty=format: --name-only <sha>` per hit, unioned. Never branch-vs-base, never working-tree-vs-HEAD (D8) |
| Fired condition | at least one stamped commit of that phase touches a declared `data-model` path **and** no stamped commit of that phase touches any declared `seed` path |
| Output stream | **stdout only**, always exit `0`. Clean = zero bytes on stdout *and* stderr. Nothing is ever written to stderr, including on an unreadable repo or a malformed declaration (a stack trace fails C1) |
| Fired line | `⚠ stale fixtures — phase <N> changed <path> and no declared seed source changed …` (names the phase **and** the changed declared path; one line per changed declared path) |
| Not-checked line | `⊡ fixtures not checked — <reason>` (visibly different text and glyph from clean's silence and from the fired line) |
| Debt title (phase-invariant — dedupe depends on it) | `stale fixtures: <declared data-model path> changed without the declared seed source`, filed with `--file <that path>`, `--phase <N>`, `--cost small`. **Never** put the phase number, a date or a SHA in the title: `dedupeKey` is `slugify(title)::slugify(file)`, so a phase-flavoured title silently breaks the repeat-sighting behaviour C3 requires |
| Who files the debt | the verb itself, via `addDebt()` from `lib/debt.mjs`. Command prose only invokes it and relays stdout — it never files findings of its own (unlike `/astro-execute` step 4d, which relays a structured workflow return) |

Two notes on scope, so nobody "helpfully" extends it:

- **Layer 1 lands in the generated project's canon, not astro-code's own `.astrocode/CONVENTIONS.md`.**
  astro-code is library-shaped and has no data model; a fixture rule in its own canon would be
  false canon in a file whose header mandates brevity. The rule reaches agents the way ADR-048
  already established: stated in `RUN-CONTRACT.md` and **distilled into the project's
  `CONVENTIONS.md`** by `/astro-new-project` and `/astro-adopt` (t11/t12). C6 is written
  against exactly those two project files.
- **Not a build gate.** No task may make `ac fixtures check` exit non-zero, block a wave, or
  fail a run. It is advisory by construction (D1, ADR-052).

---

## t1 — `RUN-CONTRACT.md`: the fixture-currency rule, stated as an outcome, and the declaration slot

- **file:** `templates/RUN-CONTRACT.md`
- **depends_on:** —

Append one new section at the end of the file as **`## 10. Data model & fixtures
declaration`** — exactly the pinned heading. Appending rather than inserting keeps §1–§9
untouched, so nothing renumbers and phase 16's shipped copies stay readable next to it.

Two things this section must carry, because C6 answers both from this file alone:

1. **The rule, phrased as state the booted app must hold** — when a phase adds a table, a
   column or any new persisted shape, the one-command cold start must come up holding the
   state that phase's acceptance items assume. Never "edit the seed file": phrased as a
   file-edit obligation it degrades into the structural check
   `agents/astro-criteria-author.md` is forbidden to write (D1), and a touched file proves
   nothing about what the app actually serves. Name the §8 fixture seam as the stable place
   that state gets added, and say plainly that fixtures that no longer cover the current data
   model make the preview empty again even though the machinery works — the failure this
   whole contract exists to prevent.
2. **The declaration**: the live-but-empty block, the marker, both keys, the comma-separated
   repo-relative path semantics including the trailing-`/` rule, one worked example of a
   filled-in block, and one sentence saying what happens when it is left empty — the advisory
   check reports *not checked*, never clean, so a project that never opted in can never be
   mistaken for one that passed (D5). Mention `ac fixtures check` by name once, as the thing
   that reads it, while making clear the contract stands on its own if astro-code is removed.

Voice: CONVENTIONS.md "Voice" — say which failure each rule prevents.

## t2 — The engine and the verb: `lib/fixtures.mjs` + `ac fixtures check`

- **file:** `lib/fixtures.mjs` (new), `bin/ac.mjs`
- **depends_on:** —

`lib/fixtures.mjs` holds all the logic (D2 wants it testable in `lib/`); `bin/ac.mjs` stays a
thin dispatcher. Use the pinned exports, the pinned git idiom, the pinned output strings.

- Reuse `git()` / `isRepo()` from `lib/git.mjs` (zero deps, `spawnSync`) — no diff-parsing
  library, no new subprocess wrapper. Reuse `addDebt()` from `lib/debt.mjs` as-is: its
  `dedupeKey` + `also_found_in` behaviour **is** the repeat-sighting semantics D6 asks for, so
  no new dedupe logic is written here.
- Posture, copied from `case 'preflight'` (`bin/ac.mjs:450`) but as its **own case arm**, not
  folded into preflight's: exit 0 always, print nothing when clean, never block a run the
  operator meant to make. Every failure path (not a git repo, no `RUN-CONTRACT.md`, unreadable
  file, malformed block, `git` missing) returns the `⊡` not-checked line — never a throw,
  never a stack trace, never a non-zero exit.
- Resolve the phase: `--phase <N>` wins; otherwise the leading number of `state.json`'s
  `active_phase`. Accept a slug or a number in either. Search both stamp spellings
  (`(phase 7 t`, `(phase 07 t`) so phases under 10 are not invisible
  (`workflows/execute-phase.mjs:61-64` explains the padding).
- `bin/ac.mjs`: add `case 'fixtures'` (rejecting any subcommand other than `check` via
  `die()`), `checkFlags('fixtures check', flags)`, the `ALLOWED_FLAGS` entry, and one HELP
  line next to `ac preflight`'s — C1 tells the verifier to *discover the verb from
  `ac help`*, so an unlisted verb fails the criterion before its behaviour is even reached.
- Module header comment in house voice: why the scope is stamped commits (branch-vs-base
  blames the last phase to run for an earlier phase's schema change), why it is advisory and
  not a gate, and why the debt title must stay phase-invariant.

## t3 — Behavioural cover for the check: three outcomes, correct attribution, one debt item

- **file:** `tests/fixtures.test.mjs` (new)
- **depends_on:** t2

Test-after by the declared strategy. Real filesystem (`mkdtempSync` under `tmpdir()`) and
**real git with real stamped commits** — C7 fails the phase if the cover exercises the check
through a stub. Every repo is created under the OS temp dir and cleaned up, so `npm test`
leaves `git status --porcelain` unchanged (C7) and passes twice in a row with no network.

Write the attribution test **first** (it is the one most likely to catch a wrong
implementation shape — a date-range or "since last check" heuristic passes the happy path and
fails this):

1. **Attribution (C2).** Repo (i): declared data-model path changed in a `(phase 15 t3)`
   commit **plus** an unstamped commit touching it, then a `(phase 17 t1)` commit touching
   only unrelated files → checking phase 17 prints nothing. Repo (ii): the declared-path
   change inside a `(phase 17 t2)` commit, working tree **clean** → checking phase 17 fires.
2. **Three outcomes (C1).** A = declared path changed under a phase-17 stamp, seed untouched →
   one line naming the phase and the path; B = the same stamped commit also touches the
   declared seed path → **stdout and stderr both byte-empty**; C = no declaration → the `⊡`
   line, textually different from A's. All three exit 0, no stack traces. Assert the
   distinctness the way `tests/commands.test.mjs:371` does for the cold-start stems.
3. **Debt (C3).** After scenario A, `ac debt list --json` has exactly one open item carrying
   the phase and the declared path; re-running for a later phase with the same violation still
   leaves exactly one item, now carrying the extra `also_found_in` sighting, with the open
   count unchanged.
4. **The silent-drop mutation (C7-1).** At least one assertion that goes red if the check is
   made unconditionally silent/clean — i.e. scenario A asserts on the *presence and content*
   of the finding, not merely on the exit code.

Drive the CLI as a subprocess (`node <repo>/bin/ac.mjs fixtures check --phase 17` with `cwd`
set to the scratch repo) for the posture assertions, and `await import('../lib/fixtures.mjs')`
inside async bodies for the helper-level ones.

## t4 — `/astro-execute` runs the check after the waves and folds it into the verdict

- **file:** `commands/astro-execute.md`
- **depends_on:** t2

Add step **4e**, immediately after 4d (the verifier-findings filing) and before step 5's
verdict report — the same post-workflow slot ADR-041's stamp audit occupies and the same slot
`ac preflight` already uses at 2b, i.e. **top-level agent prose running Bash after the
workflow returns**, never inside `workflows/execute-phase.mjs` (ADR-008: workflow scripts run
no git).

- Unconditional: no flag, no "if the user asks", no "when the phase looks data-related". A
  command nobody invokes fails exactly the way a convention nobody checks does (D7).
- One short block: run `ac fixtures check`, and **fold its output verbatim into the final
  summary reported in step 5** — a warning that lands in scrollback nobody opens is the same
  as no warning (D6). Say that silence means clean and that a `⊡ fixtures not checked` line
  means the project has no declaration, which is information, not a failure.
- Say explicitly: it exits 0 by design, never blocks the verdict, and **files its own debt** —
  do not re-file it with `ac debt add` (that would duplicate 4d's filing path and fragment the
  register).

## t5 — `/astro-fast` runs the same check, in both execution tiers

- **file:** `commands/astro-fast.md`
- **depends_on:** t2

The fast lane is the reason this layer exists at all: no criteria-author, no `CRITERIA.md`,
so the behavioural criterion never fires here (D9, ADR-050). Add step **8b**, after the
execution block in step 8 and before step 9's report, with wording that covers **both** tiers
in one sentence — the Workflow-tool call *and* the "No Workflow tool available?" Agent-tool
fallback ("whichever tier ran, after the last task commit"). One wording covering both is
deliberate: a tier-specific step is exactly how the fallback silently skips the check.

Same content as t4's block: unconditional, `ac fixtures check`, output folded into step 9's
report, exits 0, files its own debt, silence means clean.

## t6 — Regression cover for the wiring: deleting either invocation turns the suite red

- **file:** `tests/commands.test.mjs`
- **depends_on:** t4, t5

C4's deletion test is the bar: remove the step from `/astro-execute` → `npm test` fails naming
the missing check; same for `/astro-fast`. Guards in the existing house style (`cmd('<name>')`
+ `assert.ok(src.includes(…))`, failure messages that say which invariant was lost and why it
mattered):

- both command files name `ac fixtures check`;
- in `astro-execute.md` the invocation appears **after** the `Workflow({` call and before the
  step-5 verdict section (index comparison, like `tests/criteria.test.mjs`'s ordering asserts)
  — the check needs a stamped diff that does not exist before the waves;
- in `astro-fast.md` the invocation appears after the step-8 execution block, and the
  surrounding text covers the no-Workflow fallback tier as well as the Workflow tier;
- both state that the output goes into the run's final summary, so a future rewrite cannot
  quietly reduce it to a silent side effect.

## t7 — The criteria-author's standing rule: goals implying persisted state get the fixture criterion

- **file:** `agents/astro-criteria-author.md`
- **depends_on:** —

Add one bullet under "Rules for good criteria" (not a new input — the agent must infer it from
the goal and CONTEXT.md it already reads; it is plan-blind and pre-implementation, so it can
never read a diff, D3).

Phrasing constraint, non-negotiable: **outcome-shaped**. When the goal or `CONTEXT.md` implies
new or changed persisted state, register a criterion that the one-command cold start comes up
holding the state the phase's acceptance items assume — e.g. "after `docker compose up`, a
query for X returns it present". Never "the seed file was edited", never "a fixture file
changed alongside the migration": phrased structurally it becomes precisely the existence/grep
check the file already bans three lines above, and it would pass for a touched file and fail
for correct work built differently.

Keep it to the file's terse register, and make it explicit that this applies only to
app-shaped projects that persist data.

## t8 — Guard the criteria-author rule against a silent prompt rewrite

- **file:** `tests/criteria.test.mjs`
- **depends_on:** t7

Extend the existing static-guard file (it already reads `agents/astro-criteria-author.md` into
`author`). Assert the standing rule's load-bearing language survives: the persisted-state
trigger, the cold-start-state outcome phrasing, and that it is stated as an outcome rather
than a file-edit obligation. This is C7's mutation 2 — removing the rule must turn the suite
red. Failure message names the ADR (ADR-050/052) and what was lost.

## t9 — The planner rule: `ACCEPTANCE.md` items name the precondition state they assume

- **file:** `agents/astro-planner.md`
- **depends_on:** —

ADR-050 requires it and this very plan's `ACCEPTANCE.md` obeys it. Extend the ACCEPTANCE.md
paragraph (lines 18–21) with one sentence: each acceptance item must name the precondition
state it assumes — the data the app must already hold for the item to be checkable — so that a
phase changing the data model cannot pass UAT against fixtures that no longer cover it. Keep
the file's voice; one sentence, not a section.

## t10 — Guard the planner rule

- **file:** `tests/workflows.test.mjs`
- **depends_on:** t9

The planner-prompt guards for phase 08 (`t1`/`t5`, around line 1697+) already live here and
read `agents/astro-planner.md` — add the ACCEPTANCE-precondition guard beside them, same
idiom, referencing ADR-050. C7's mutation 3: deleting the sentence must turn the suite red.

## t11 — `/astro-new-project` distils the rule and fills the declaration

- **file:** `commands/astro-new-project.md`
- **depends_on:** t2

Two additions to the existing scaffold/canon step (t3 of phase 16 wrote the "Run contract"
section; this extends it — do not restate `RUN-CONTRACT.md`, point at it):

- When copying `RUN-CONTRACT.md` verbatim to the project root, **fill in the declaration
  block** with the project's real paths: the data-model paths for the stack it just scaffolded
  (migrations dir, schema file, model/entity dir) and the seed source (the script plus any
  fixture data files). At birth there may be no data model yet — then leave `data-model:`
  empty and say so in one line, so the first data-model phase knows to fill it.
- In the "Run contract" section it distils into `.astrocode/CONVENTIONS.md`, carry the
  fixture-currency rule **as the state outcome** (the cold start comes up holding the state
  this phase's acceptance items assume, fixtures extended at the named seam) plus one pointer
  to where the declaration lives. This is layer 1: canon is what every planning and execution
  agent reads, which is what makes extending fixtures the default rather than an afterthought.
- Library/CLI-shaped projects skip all of it, as they skip the rest of the contract.

## t12 — `/astro-adopt` does the same for an existing project

- **file:** `commands/astro-adopt.md`
- **depends_on:** t2

Same two additions as t11, adapted to adoption: the declaration is filled from what the
**mapper actually found** (the project's existing migrations/schema/model paths and its
pre-existing seed entry point — the one adopt wraps rather than rewrites, ADR-051), and the
distilled canon rule names that project's real seam. If the data-model paths are genuinely
ambiguous, leave the keys empty and say in the report that the check will read *not checked*
until someone declares them — never guess paths (D5 rejected inference precisely because a
wrong answer is worse than an honest "not checked").

## t13 — Record the specifics this plan pinned, as one ADR

- **file:** `.astrocode/DECISIONS.md`
- **depends_on:** —

`ac decision add "<title>" --why "…" --rejected "…"` (shared orphan branch; sole owner of this
file in this plan). One entry covering only what ADR-050/052 left open — **do not relitigate
anything they settled**: the verb name and its single `--phase` flag; the marker +
`data-model:`/`seed:` declaration format shipped live-but-empty; stdout-only output with the
`⚠`/`⊡` glyphs and silence as the clean signal; and the phase-invariant debt title.

**Rejected** (record them): a placeholder example declaration in the template (an un-filled
copy would read as declared, i.e. clean, which is this phase's own failure mode); glob or
heuristic inference of data-model paths (D5); the phase number or a SHA in the debt title
(breaks `dedupeKey`, so C3's repeat sighting becomes a second item); and filing the finding
from the command prose instead of the verb (duplicates the logic across two lanes that
already differ in structure).

## t14 — Rehearsal part 1: a canon-only project is self-sufficient and the check reads its declaration

- **file:** `.astrocode/phases/17-fixtures-stay-current-as-the-data-model-changes/FIXTURE-REHEARSAL.md`
  (new), `templates/RUN-CONTRACT.md`, `lib/fixtures.mjs`, `commands/astro-new-project.md`
- **depends_on:** t1, t3, t11

C6, driven by hand — the prove-before-automating pass. In a scratch project under
`/Users/buu/Development/astro-scratch-p17/` (outside this repo, so no worktree is dirtied),
assemble a project from the **shipped canon alone**: the `RUN-CONTRACT.md` copy plus a
generated project `CONVENTIONS.md`, with no astro-code checkout reachable from it.

Reading only those two files, answer both questions concretely and record the answers: (a)
what must happen to fixtures when a phase adds a table or column, stated as the state the
booted app must hold; (b) exactly where and in what format to declare the data-model paths and
the seed source. Then write a declaration following **only** those instructions and run
`ac fixtures check` against the project — it must parse it and report clean or fired, never
"not checked".

If reality disagrees with the docs, **the docs or the parser are the defect** — fix
`templates/RUN-CONTRACT.md`, `lib/fixtures.mjs` or `commands/astro-new-project.md` here (that
is why they are declared), and keep t3's/t6's guards green in the same commit. Record
everything in `FIXTURE-REHEARSAL.md`: commands run verbatim, outputs observed, what was fixed.

## t15 — Rehearsal part 2: the criterion actually discriminates stale fixtures from current ones

- **file:** `.astrocode/phases/17-fixtures-stay-current-as-the-data-model-changes/FIXTURE-REHEARSAL.md`,
  `templates/RUN-CONTRACT.md`, `agents/astro-criteria-author.md`
- **depends_on:** t8, t14

Same files as t14 (and t7's agent file), therefore serialized. This is C5, the phase's real
proof: unit tests show the advisory layer works, this shows the **enforcement** layer does.

- **Probe first, before anything else:** `host "docker compose version"` — the quoted form;
  a bare `host docker compose …` is rejected by the shell allowlist on the first token. At
  planning time this returned `Docker Compose version v5.3.1`, so the live path is expected to
  work; phase 16's `COLD-START-REHEARSAL.md` records the session where it did not.
- Take the t14 scratch app (or extend it) into an app-shaped project that persists data and
  boots with one command. Land a schema change (a new table or column) **without** extending
  the fixtures, run the real cold start (`host "docker compose up -d"`, `host "docker compose ps"`,
  a query/HTTP read for the state the acceptance items assume). Required observation: the app
  comes up **healthy** and the query returns the state **absent/empty** — the criterion FAILS.
  A boot failure or a non-zero seed exit is NOT the expected failure and does not satisfy this.
- Then extend the seed's fixtures at the declared seam and **change nothing else**; the same
  cold start must return that state present — the criterion PASSES. Also run
  `ac fixtures check` in both states to show the advisory layer agreeing with the criterion.
- Write it up in `FIXTURE-REHEARSAL.md` as a **re-runnable command list** (every command
  verbatim, in order, with the observed output) — C5 fails a narrative nobody else can replay.
  Tear down (`host "docker compose down -v"`) and delete the scratch tree.
- **If the bridge or Docker is unreachable despite the probe:** report exactly that, in the
  phase-16 honesty register, and still record the discriminating evidence by driving the
  stack-native seed and query directly (stale → absent, extended → present) with the same
  verbatim command list. Never invent a boot result, and never change command prose on the
  basis of a boot that did not happen.

---

## Waves

| Wave | Tasks |
|---|---|
| 1 | t1, t2, t7, t9, t13 |
| 2 | t3, t4, t5, t8, t10, t11, t12 |
| 3 | t6 |
| 4 | t14 |
| 5 | t15 |

Same-file pairs are serialized, never co-scheduled: `templates/RUN-CONTRACT.md` (t1 → t14 →
t15), `lib/fixtures.mjs` (t2 → t14), `commands/astro-new-project.md` (t11 → t14),
`agents/astro-criteria-author.md` (t7 → t8 → t15), `FIXTURE-REHEARSAL.md` (t14 → t15). No
other file is claimed by two tasks.

## Criteria coverage

| Criterion | Tasks |
|---|---|
| C1 three distinguishable outcomes, never fails a run | t1, t2, t3 |
| C2 attribution to the phase that actually changed the model | t2, t3 |
| C3 filed as debt, repeat sighting not a second item | t2, t3 |
| C4 both lanes run it after the waves, into the summary, regression-covered | t4, t5, t6 |
| C5 the criterion discriminates stale from current fixtures | t7, t15 |
| C6 a generated project keeps rule + declaration with astro-code deleted | t1, t11, t12, t14 |
| C7 suite green, deterministic, all three mutations bite | t3, t6, t8, t10 |
