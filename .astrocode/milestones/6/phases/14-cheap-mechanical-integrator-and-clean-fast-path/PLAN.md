# PLAN — 14-cheap-mechanical-integrator-and-clean-fast-path

> Goal: the per-wave integrator (parallel path ONLY) runs at a new `integrator` role that
> hard-defaults to **haiku** (`models.integrator || 'haiku'` — a floor, not an inherit),
> keeps its per-BRANCH bail into the existing executor-tier heal ladder, has its destructive
> git bounded by a `tornDown` schema field the script cross-checks as pure data (ADR-008),
> maps branch→task from the ADR-017 `(phase NN tK)` stamp instead of inference, is carried by
> all three profiles (max sonnet, balanced/fast haiku), and no longer leaves the repo
> asserting "haiku is excluded everywhere". ADR-027 already records the carve-out — the
> `ac decision add` scope item is DONE; no task re-adds it.
> Untouched (CONTEXT § Out): the sequential/lean batched path, `runTeardown`, the healed-wave
> test gate, heal re-runs, `resolveHealList`/`classifyOverflow` semantics, the `buildWaves`
> MIRROR region, the verify/remediate loop, `ac config set/unset` plumbing.

## Conventions binding on every task

- `workflows/*.mjs` is Workflow-tool style: **no semicolons**, no `import` (the sandbox
  cannot import — config values arrive as scalar args). High-density "why" comments that name
  the incident/ADR they prevent; cite `ADR-027` in every new integrator comment.
- `lib/`, `bin/`, `tests/` keep semicolons and the existing house style. Named function
  exports only. Tests are `node:test` + `node:assert/strict`, sentence-form names.
- **The script runs NO git** (ADR-005/008). The `tornDown` bound is a data comparison over
  arrays — never `child_process`, never a shell-out.
- Tier strings stay bare short names (`'opus' | 'sonnet' | 'haiku'`). Never a dated model id.
- Keep the integrator prompt small: inline only `{id,title,file}` per wave task and have the
  agent run its own `git log`/`git diff --name-only`. Haiku's context window is 200K vs 1M for
  opus/sonnet, so nothing large may be pasted INTO the prompt.
- **Test-first choice (explicit):** `workflows/execute-phase.mjs` exports no importable
  symbol, so its tests are extract-and-eval / harness-drive against source TEXT and cannot
  pass before the source exists. Following the phase-13 precedent, each workflow task carries
  its OWN tests in the SAME task (write the test first, then implement until green). Same for
  t1: `tests/models.test.mjs` currently asserts the very rule this phase reverses, so the
  profile change and the test rewrite are ONE atomic task or the wave boundary goes red
  (ADR-020). Doc-guard tests (t8) are **test-after**: they `depends_on` the doc tasks.
- No task statically imports a symbol that does not yet exist on its branch (ADR-018). No
  task in this plan needs a new export, so no `await import()` shim is required.

---

## Tasks

### t1 — `integrator` becomes a first-class profile role (+ reworded haiku rule, + tests)
- **id:** t1
- **title:** Add `integrator` to all three profiles (max `sonnet`, balanced `haiku`, fast
  `haiku`), reword `lib/models.mjs`'s "haiku excluded everywhere" header to name the
  carve-out, seed the template config, and rewrite the profile tests that encode the old rule.
- **file:** `lib/models.mjs`, `tests/models.test.mjs`, `templates/config.json`
- **depends_on:** _(none)_
- **details:**
  - ATOMIC BY NECESSITY: `tests/models.test.mjs`'s `no profile uses haiku anywhere (sonnet is
    the floor)` fails the instant `integrator: 'haiku'` lands. Landing the profile change
    without the test rewrite is a red wave boundary (ADR-020) — one task, one commit.
  - `lib/models.mjs`: add `integrator` to `MODEL_PROFILES.max` (`'sonnet'`), `.balanced`
    (`'haiku'`), `.fast` (`'haiku'`). Update the module header: the ladder line must no longer
    claim haiku is excluded **everywhere** — state that haiku is excluded from every
    *judgement* role and that `integrator` is the single documented exception (ADR-027:
    mechanical git, schema-pinned return, stamp-based mapping, cross-checked teardown, heal
    ladder backstop). Add `integrator (mechanical wave-fold — the sole haiku-tier role,
    ADR-027)` to the Roles list, fix the "Speed comes from moving roles opus→sonnet" sentence,
    the `balanced` block's `// … No haiku.` comment, and `profileModels`'s `@returns` typedef
    (it currently names five roles). Note `max` is `sonnet`, deliberately NOT opus: opus on a
    cherry-pick is waste, and sonnet already escapes haiku.
  - `tests/models.test.mjs`: (a) rewrite the header comment (it says "no haiku anywhere — a
    hard project preference"); (b) keep the shared `ROLES` array at the five judgement roles
    and scope the "no haiku" assertion to THOSE roles only — **do not add `integrator` to
    `ROLES`**, or `max is every role on opus` would wrongly demand `integrator === 'opus'`;
    (c) add dedicated tests: every profile defines `integrator`; `max.integrator === 'sonnet'`,
    `balanced.integrator === 'haiku'`, `fast.integrator === 'haiku'`; every profile has the
    IDENTICAL key set (so a profile switch can never leave a role unset — the `ac models`
    wholesale-replace bug at `bin/ac.mjs:537`); the mutation-safety test still holds.
  - `templates/config.json`: add `"integrator": "haiku"` to `models` and update its
    `_comment` ("Per-role model tier: opus | sonnet") to state haiku is for `integrator` only.
    Keep the file valid JSON; do not reorder existing keys.
- **verifies:** C6(a), part of C7.

### t2 — Integrator tier floor + `tornDown` bound (script side) + behavioral tests
- **id:** t2
- **title:** Spawn the wave integrator at `models.integrator || 'haiku'`, add optional
  `tornDown: string[]` to `INTEGRATE_SCHEMA`, and fail the wave loudly when a teardown claim
  names a branch that was not cleanly integrated in this same run — as pure data.
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`
- **depends_on:** _(none)_
- **details:**
  - **Tier (inline at the call site, NOT in the `models` initializer):** in `integrateWave`'s
    `agent()` options (~line 705) change `model: models.executor` →
    `model: models.integrator || 'haiku'`. Comment why the floor exists, mirroring
    `leanExecutionEnabled`'s default-on reasoning: for every other role "unset = inherit the
    session model", which for the integrator would mean opus — the exact opposite of the goal
    — in every project predating the key. An explicit `ac config set models.integrator sonnet`
    still wins. Do NOT bake the default into `const models = effort === 'deep' ? …` (two
    ternary arms = an easy one-arm-only bug); instead extend that block's comment to note that
    `integrator`, like `discover`, is deliberately NOT escalated by `deep` and carries its own
    floor at the call site. `agentType` stays `'astro-executor'` — there is no new agent file.
  - **Do not touch** the `models.executor` on `runHealOnBranch`, `runTestSuite`, `runTeardown`,
    `runOnBranch`, the parallel `exec:` calls or remediation (CONTEXT decision 4).
  - **Schema:** add `tornDown: { type: 'array', items: { type: 'string' } }` to
    `INTEGRATE_SCHEMA.properties`, keep `required: ['integrated']` unchanged and
    `additionalProperties: false` at every level. Comment: optional on purpose — a wave that
    tore nothing down must not read as a failure.
  - **Cross-check** immediately after `const integ = await integrateWave(w, wave)` (~line 948),
    BEFORE the advisory logging, as pure array work:
    `conflictSet` = branches of `integ.conflicts` + `integ.staleBranches`;
    `cleanBranches` = `(integ.branches || [])` minus `conflictSet` — the check must be against
    the CLEANLY-integrated set, not raw `branches[]`, so a self-contradictory return that lists
    a branch in both `branches[]` and `conflicts[]` and then tears it down is still caught (the
    same defensiveness as the existing "keyed on the LISTS, not the flag" comment);
    `badTeardown` = `((integ && integ.tornDown) || [])` minus `cleanBranches` — null-guarded
    like the existing `missingFromWave`/`removed` consumers.
    If non-empty: `log('✖ wave N teardown out of bounds: …')` naming every offending branch,
    then set `integrationFailed = { wave: w + 1, taskId: null, branch: badTeardown[0], note: … }`
    using the SAME shape as the two existing assignments (so the FAIL formatter at ~1216 keeps
    working) and `continue` — skip heal/gate for this wave. The note must name the branch(es)
    and say the delete already happened agent-side (the script runs no git), so the ref may
    still be recoverable via `git reflog` / dangling commits before GC.
  - **Tests** (`tests/workflows.test.mjs`, appended in the existing phase-13 harness section):
    extend `runWorkflow` additively — a new `{ integ }` option (default the current
    `{ integrated: true, branches: [] }`, so every existing caller is unaffected) and record
    `log()` lines, returning `{ calls, logs, result }`. Then assert:
    - **C1:** parallel args with `models` carrying NO `integrator` key → the `integrate:w1`
      call's `model` is `'haiku'` while `heal:t2`, `testgate` and `teardown:w1` are `'sonnet'`;
      with `models.integrator: 'sonnet'` the integrate call is `'sonnet'`; with `models: {}`
      the integrate call is still `'haiku'`.
    - **C2:** with `branches:[worktree-t1,worktree-t3]`, `conflicts:[{branch:worktree-t2,
      taskId:t2}]` → exactly ONE `integrate:` call for the wave, exactly ONE `heal:` call and
      it is `heal:t2`, `result.healed` is `['t2']`, `result.verdict.passed` true; move the
      conflict to `t1` and the single heal follows it (data-driven, not positional).
    - **C3:** `branches:[worktree-t1]`, `tornDown:[worktree-t1,worktree-t2]` →
      `result.integrationFailed` non-null, the note or a logged line names `worktree-t2`, no
      call carries the verifier schema. Controls that must NOT fail: a strict subset
      (partial teardown), and no `tornDown` key at all. Plus the extra hazard case: a branch
      present in BOTH `branches[]` and `conflicts[]` and listed in `tornDown` → must fail.
    - **C4:** advisories case → no `heal:t1`, a `⚠` log line naming `worktree-t1` and `z.mjs`,
      and a `testgate` call at the executor tier.
    - **C8(a):** default sequential args (3 tasks, no `strategy`) → ZERO labels starting
      `integrate:`, and the single `exec:batch` call's model is the executor tier, never `haiku`.
    - one static source guard that the integrate `agent()` options line reads
      `models.integrator || 'haiku'` while heal/testgate/teardown still read `models.executor`.
- **verifies:** C1, C2, C3, C4 (behavioral half), C8.

### t3 — `/astro-config` gains the 6th role and stops saying "do not offer haiku"
- **id:** t3
- **title:** Add `integrator` to the profile summaries, the custom-role questions and the role
  reference in the `/astro-config` command, and scope the haiku prohibition to the other roles.
- **file:** `commands/astro-config.md`
- **depends_on:** _(none)_
- **details:**
  - Frontmatter `description`: extend the role list with `integrator` (tier list already
    reads opus/sonnet/haiku — leave it).
  - Step 2: reword "The tier ladder is **opus → sonnet only** (no haiku — its quality is too
    low…)" so the prohibition is scoped to the judgement roles and names `integrator` as the
    single exception (ADR-027). Add the integrator tier to each profile summary line:
    balanced `haiku`, fast `haiku`, max `sonnet` (max is "every role opus **except**
    `integrator`, which is sonnet — opus on a cherry-pick is waste").
  - Step 3 (Custom): there are now **6** roles and `AskUserQuestion` allows ≤4 per call — keep
    two calls, rebalanced to `[planner, researcher, executor, verifier]` then
    `[discover, integrator]`. Replace the blanket "Do **not** offer haiku" with: offer
    `opus | sonnet | inherit` for the five judgement roles, and for `integrator` offer
    `opus | sonnet | haiku (default — same as leaving it unset)` with **no** `inherit` option,
    because unset means haiku here, not session-inherit (the opposite of every other role).
  - "Roles, for reference": add `**integrator** — folds each parallel wave's worktree branches
    back onto the branch (mechanical git; the one haiku-tier role, ADR-027; anything it cannot
    pick cleanly is preserved and re-run at the executor tier)`.
- **verifies:** C6(c), part of C7.

### t4 — Document the integrator's tier and bail-to-heal behavior in `/astro-execute`
- **id:** t4
- **title:** State, where the Workflow tier already describes the integrator, that it runs at
  `models.integrator` (haiku by default) and that any branch it cannot pick cleanly is
  preserved and re-run through the heal ladder at the executor tier.
- **file:** `commands/astro-execute.md`
- **depends_on:** _(none)_
- **details:**
  - Extend the existing "an **integrator agent** folds the wave back onto the branch" sentence
    in the Workflow-tool bullet (step 4) — same prose voice, no new numbered step.
  - Must say: (a) the integrator runs at the cheap `models.integrator` tier, **haiku by
    default even when the project config never mentions the role**; (b) override with
    `ac config set models.integrator sonnet` (or a profile — `max` gives sonnet); (c) the bail
    a user actually sees: stale / peer-colliding / conflicted branches are PRESERVED and
    reported per-branch while the clean peers still land in the same pass, then only the bad
    branch's task is re-run through the heal ladder at `models.executor` (heal, the post-heal
    test gate and teardown are never cheapened); (d) an out-of-bounds teardown claim is caught
    by the script and surfaced as `integrationFailed`.
  - Keep the existing fallback-tier markers/wording intact — `tests/commands.test.mjs` slices
    that region by marker text.
- **verifies:** part of C7.

### t5 — Reword the remaining "haiku is excluded everywhere" claims
- **id:** t5
- **title:** Scope the opus→sonnet-ladder claims in the README, `/astro-help` and the
  `ac models` comment so none of them still asserts the exclusion holds for every role.
- **file:** `README.md`, `commands/astro-help.md`, `bin/ac.mjs`
- **depends_on:** _(none)_
- **details:**
  - `README.md` ~line 137-140: "sets a tier per role (`opus`/`sonnet`)" → include `haiku` for
    `integrator`; "(the ladder is opus→sonnet, no haiku)" → scope it (haiku only for the
    mechanical `integrator`, ADR-027). Optionally name the integrator tier in the
    balanced/fast/max bullets — one clause each, no new section.
  - `commands/astro-help.md` line 45: "**Go faster** (the speed switch — opus→sonnet ladder,
    no haiku)" → same scoping, one line.
  - `bin/ac.mjs` lines 514-515: "The ladder is opus→sonnet only (no haiku)." → reword to name
    the `integrator` carve-out (ADR-027); also update "instead of five `ac config set` calls"
    → six. **Comment only** — no behavior change; `models: preset` stays a wholesale replace
    (t1 makes the preset complete, which is what fixes the wipe).
  - Leave alone (not exclusion claims): `commands/astro-alex.md` and `README.md:113`
    (`--model sonnet|haiku` per-run override), `lib/config.mjs:19` (a neutral type comment),
    `hooks/_astro-ctx.mjs` (context-window regex), `tests/statusline.test.mjs`.
- **verifies:** part of C7.

### t6 — ARCHITECTURE model table: add `integrator`, drop the stale `discover: haiku` row
- **id:** t6
- **title:** Add an `integrator` row to the per-role tier table and correct the `discover`
  default to match `lib/models.mjs`.
- **file:** `ARCHITECTURE.md`
- **depends_on:** _(none)_
- **details:**
  - Table at ~line 200-205 (Role | Default | Model id | Why): add
    `| integrator | haiku | claude-haiku-4-5 | mechanical wave-fold: stamp-mapped cherry-picks; anything unclean is preserved and healed at executor tier (ADR-027) |`.
  - Fix the pre-existing drift: `discover` is `sonnet` in every profile in `lib/models.mjs`,
    not `haiku` — correct the Default cell and its model id.
  - Use un-suffixed short ids (`claude-haiku-4-5`), never a date suffix — the existing
    `claude-haiku-4-5-20251001` cell is stale drift; do not copy that pattern.
  - Prose below the table stays accurate; add at most one clause noting `integrator` defaults
    to haiku even when unset (every other role inherits the session model when omitted).
- **verifies:** part of C7 (repo no longer contradicts itself).

### t7 — Rewrite the integrator prompt: stamp mapping, per-branch bail, bounded teardown
- **id:** t7
- **title:** Replace branch→task inference with an ADR-017 `(phase NN tK)` stamp read, state
  the per-branch continue rule explicitly, restrict destructive git to this-run clean picks and
  require them reported in `tornDown` — with the ADR-016 outcomes preserved verbatim.
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`
- **depends_on:** t2
- **details:**
  - Same file as t2 → strictly serialized after it; t7 writes the prompt against the
    `tornDown` field t2 added.
  - **Mapping (step 2 of the prompt, and the doc comment above `integrateWave` that still says
    "by commit message + changed files"):** lead with the mechanical stamp read, interpolating
    the ALREADY-COMPUTED `phaseNum` (zero-padded string — never re-derive, never hardcode):
    read the branch's commit subjects (`git log --format=%s HEAD..<branch>`) and take the
    `(phase ${phaseNum} t<id>)` stamp. Spell the exact pattern including the closing paren
    (the t1/t14 trap) and mirror the Discover prompt's idiom
    (`git log --oneline --fixed-strings --grep "(phase ${phaseNum} <taskId>)"`) where a grep
    form is used. Rules: exactly one distinct stamp matching a wave task id → that `taskId`;
    zero or more than one distinct stamp → `taskId: null` (never guess — `resolveHealList`
    already falls back safely). Changed-file/message inference survives ONLY as the explicitly
    labelled fallback for a stamp-less commit, never as the primary rule.
  - **Per-branch bail (make explicit, it is already the aggregate shape):** each candidate is
    reported under exactly ONE outcome and processing CONTINUES to the remaining candidates —
    never abort the wave on the first bad branch; a preserved branch's peers must still land in
    this same call. State why: `resolveHealList` re-runs every wave task not confirmed
    integrated, so halting early pushes correctly-landed work into executor-tier re-runs. No
    self-retry, no asking for a stronger model (ADR-014/015 forbid the textual rescue).
  - **Bounded teardown (step 3):** `git worktree remove --force` / `git branch -D` /
    `git worktree prune` may be run ONLY on a branch cherry-picked cleanly in THIS run
    (non-stale, non-collision, conflict-free). Never on a preserved/stale/conflicted branch,
    never on a pre-existing branch it did not pick. Every branch torn down MUST be listed in
    `tornDown[]`, and `tornDown[]` must contain nothing else — the script cross-checks it
    against the cleanly-integrated set and a mismatch fails the wave.
  - **Unchanged (ADR-016/015, C4/C5):** staleness-first check order, the declared-file set
    difference with its two distinct outcomes (peer-claimed → preserve + `conflicts[]`;
    unclaimed → cherry-pick + `advisories[]` with `extraFiles`), `git cherry-pick --abort` +
    clean-`git status` verification on conflict, `staleBranches[]`, the final
    `git log --oneline -n 20` confirmation, the trimmed `{id,title,file}` inlined wave list,
    and `OBEY`. Do NOT "simplify" the prompt into a bare cherry-pick loop.
  - Keep the prompt compact (haiku is 200K, not 1M): no pasted diffs or logs; the agent runs
    its own git commands.
  - **Tests** (`tests/workflows.test.mjs`, extending the existing `extractIntegrateWaveBody` /
    `extractIntegratorPromptWindow` guards, not replacing them):
    - **C5:** drive the harness with phase `07-some-phase` and then
      `14-cheap-mechanical-integrator-and-clean-fast-path`, capture the `integrate:w1` prompt
      each time, and assert the stamp pattern tracks the slug (`(phase 07 t` vs `(phase 14 t`,
      zero padding preserved) — proving it is interpolated, not hardcoded — that the prompt
      still carries the wave task ids, and that the stamp rule appears BEFORE any
      changed-file/message inference, which must be labelled a fallback.
    - static guards: teardown restricted to cleanly-picked branches + must be reported in
      `tornDown[]`; conflicting/stale branches still never torn down; per-branch "continue"
      wording present; the existing `cherry-pick --abort`, clean-status, staleness and
      overflow guards still pass unmodified.
    - **C4 (prompt half):** the prompt still directs the declared-file comparison with both
      distinct outcomes.
- **verifies:** C5, C4 (prompt half), decisions 1-3.

### t8 — Doc guards for the new tier documentation
- **id:** t8
- **title:** Lock the `/astro-execute` integrator-tier + bail-to-heal documentation and the
  `/astro-config` 6-role reference with source-text guards.
- **file:** `tests/commands.test.mjs`
- **depends_on:** t3, t4
- **details:**
  - Test-after by design: these assert on doc text, so they land after t3/t4 (different files,
    but a guard committed before its doc would be a red wave boundary).
  - Follow the existing `readFileSync(join(COMMANDS, …))` + assert.match style already used for
    `astro-execute.md`; add `astro-config.md` alongside it.
  - Assert: `astro-execute.md` names `models.integrator` AND `haiku` AND the preserve/heal
    outcome; `astro-config.md` names all six roles (`planner`, `researcher`, `executor`,
    `verifier`, `discover`, `integrator`) in its role reference, and no longer carries an
    unscoped "do not offer haiku" instruction.
  - Keep the assertions text-shape tolerant (case-insensitive regex on the load-bearing
    tokens), not brittle full-sentence matches.
- **verifies:** C6(c), C7 (guards them against future drift).

---

## Waves

- **Wave 1 (6 parallel, no deps):** t1, t2, t3, t4, t5, t6 — disjoint files, each green alone.
- **Wave 2 (2 parallel):** t7 (after t2 — same two files, serialized), t8 (after t3, t4).

## File ownership check

| file | owner |
|---|---|
| `lib/models.mjs`, `tests/models.test.mjs`, `templates/config.json` | t1 |
| `workflows/execute-phase.mjs`, `tests/workflows.test.mjs` | t2, then t7 (serialized via `depends_on`) |
| `commands/astro-config.md` | t3 |
| `commands/astro-execute.md` | t4 |
| `README.md`, `commands/astro-help.md`, `bin/ac.mjs` | t5 |
| `ARCHITECTURE.md` | t6 |
| `tests/commands.test.mjs` | t8 |

No two tasks in the same wave touch the same file; no deletions/renames occur, so no
consumer-fixup folding beyond t1 (whose profile change invalidates an existing test) and t2/t7
(same file, ordered).

## Criteria coverage

C1 → t2 · C2 → t2 · C3 → t2 · C4 → t2 (behavior) + t7 (prompt) · C5 → t7 ·
C6 → t1 (a, b) + t3 (c) · C7 → t1, t3, t4, t5, t6 (+ ADR-027 already in DECISIONS.md), guarded
by t8 · C8 → t2 (harness) + the untouched-scope rule binding on every task.
