# CRITERIA — Phase 14: cheap mechanical integrator and clean fast-path

> Pre-registered before any plan exists. These grade the finished *system behavior*, not
> the shape of the code. A different-but-valid implementation of the same goal must still
> satisfy every one.

## Harness note (how to observe the workflow without git, agents, or a network)

`workflows/execute-phase.mjs` is a Workflow-tool script: a top-level-await body that reaches
the outside world ONLY through the injected hooks `phase`/`agent`/`parallel`/`log` and ends in
`return {…}`. It exports no importable symbol, so drive it directly: strip the leading `export `
off the `meta` line, wrap the source in an `AsyncFunction(phase, agent, parallel, log, args)`,
inject recording stubs, run it, and inspect the recorded `agent()` calls (label, `model`, prompt
text), the `log()` lines, and the returned object. No real git, no subprocess, no network.

Save this once as `$SCRATCH/h.mjs` (`$SCRATCH` = the session scratchpad dir); every criterion
below drives it with env vars:

```js
import { readFileSync } from 'node:fs'
const WF = process.env.WF || '/Users/buu/Development/astro-code/workflows/execute-phase.mjs'
const src = readFileSync(WF, 'utf8').replace(/^export const meta/m, 'const meta')
const AF = Object.getPrototypeOf(async function () {}).constructor
const fn = new AF('phase', 'agent', 'parallel', 'log', 'args', src)
const integ = JSON.parse(process.env.INTEG || '{"integrated":true,"branches":[]}')
const wfArgs = JSON.parse(process.env.ARGS || '{}')
const tasks = JSON.parse(process.env.TASKS ||
  '[{"id":"t1","title":"T1","file":"a.mjs","depends_on":[],"done":false},' +
  ' {"id":"t2","title":"T2","file":"b.mjs","depends_on":[],"done":false},' +
  ' {"id":"t3","title":"T3","file":"c.mjs","depends_on":[],"done":false}]')
const calls = [], logs = []
const agent = async (prompt, o = {}) => {
  calls.push({ label: o.label || null, model: o.model === undefined ? '<undefined>' : o.model, prompt })
  const props = (o.schema && o.schema.properties) || {}
  if ('tasks' in props) return { tasks }                      // Discover
  if ('integrated' in props) return integ                     // the wave integrator
  if ('criteriaFound' in props) return { passed: true, criteriaFound: true, summary: 'ok', criteria: [] }
  if ('removed' in props) return { removed: [] }              // teardown
  if ('committed' in props) return { committed: JSON.parse(process.env.COMMITTED || '[]'), summary: 's' }
  if ('passed' in props) return { passed: true }              // test gate
  return { summary: 'done' }                                  // per-task executor / heal
}
const parallel = async (thunks) => Promise.all(thunks.map((f) => f()))
const result = await fn(() => {}, agent, parallel, (m) => logs.push(String(m)), wfArgs)
console.log(JSON.stringify({ calls, logs, result }, null, 1))
```

Run as: `SCRATCH=<scratchpad>; ARGS='…' INTEG='…' node $SCRATCH/h.mjs`.
Three independent same-wave tasks are used so a wave is genuinely wide (parallel path) and a
per-branch outcome is distinguishable from a per-wave one.

---

### C1 — A wide (parallel) wave's integrator runs at the cheap integrator tier — haiku even when the project's config never mentions the role — while heal re-runs, the post-heal test gate and the teardown step still run at the executor tier.
- **Observe:** run the harness with
  `ARGS='{"root":"/tmp/p","phase":"14-cheap-mechanical-integrator-and-clean-fast-path","strategy":"parallel","models":{"executor":"sonnet","verifier":"opus","discover":"sonnet"}}'`
  (note: **no** `integrator` key) and
  `INTEG='{"integrated":false,"branches":["worktree-t1","worktree-t3"],"conflicts":[{"branch":"worktree-t2","taskId":"t2"}],"tornDown":["worktree-t1","worktree-t3"]}'`.
  In the recorded calls: the `integrate:w1` call's `model` is `haiku`; the `heal:t2`,
  `testgate` and `teardown:w1` calls' `model` is `sonnet` (the executor tier). Re-run with
  `…"models":{"executor":"sonnet","integrator":"sonnet",…}` — the `integrate:w1` call now
  carries `sonnet` (an explicit override wins over the floor). Re-run with `"models":{}` —
  `integrate:w1` still carries `haiku`.
- **Fails if:** the integrate call's model is `sonnet`/`opus`/`<undefined>` when no
  `integrator` key is configured (unset silently inheriting the session tier is the exact
  regression this phase exists to prevent), or the explicit override is ignored, or any of
  heal / test gate / teardown got dragged down to the cheap tier.

### C2 — One bad branch does not cost the wave: in a wide wave where some branches integrate cleanly and one does not, only the bad branch's task is re-run, the clean peers are left alone, and the wave is settled by exactly ONE integrator call (no triage pre-pass, no stronger-tier retry of the same integration).
- **Observe:** the C1 run above (branches `worktree-t1`,`worktree-t3` clean; `worktree-t2`
  conflicted, mapped to `t2`). In the output: exactly **one** call whose label starts with
  `integrate:` for wave 1; exactly **one** `heal:` call and its label is `heal:t2`; no
  `heal:t1` / `heal:t3`; `result.healed` is `["t2"]`; `result.verdict.passed` is true (the
  run reaches Verify). Repeat with the conflict on `t1` instead — the single heal call
  follows the conflicting branch, proving the mapping is data-driven, not positional.
- **Fails if:** more than one integrator call is dispatched for the same wave, or a second
  integration attempt is made at a higher model tier, or the clean peers (`t1`,`t3`) are
  re-run through the heal ladder / executor as well, or the run aborts the whole wave (no
  heal at all, `integrationFailed` set) merely because one branch was preserved.

### C3 — A teardown claim that names a branch the integrator did not report as cleanly integrated is caught and surfaced as an integration failure — as pure data, with no git executed by the script.
- **Observe:** run the harness with the same parallel `ARGS` and
  `INTEG='{"integrated":true,"branches":["worktree-t1"],"tornDown":["worktree-t1","worktree-t2"]}'`.
  Expected: `result.integrationFailed` is non-null, its note (or a `logs` line) names the
  offending branch `worktree-t2`, no `agent()` call carries the verifier schema (Verify is
  never reached), and the process exits 0 having run no git (the harness supplies no git and
  no `exec`; any shell-out would throw). Control runs that must **not** fail:
  (a) `INTEG='{"integrated":true,"branches":["worktree-t1","worktree-t2","worktree-t3"],"tornDown":["worktree-t1"]}'`
  (a subset — a partial teardown), and (b) `INTEG='{"integrated":true,"branches":["worktree-t1"]}'`
  (no `tornDown` key at all — nothing was torn down); both reach Verify with
  `result.integrationFailed` null.
- **Fails if:** the out-of-set teardown is silently accepted (run proceeds to Verify as if
  clean), or the mismatch is only logged without counting as an integration failure, or an
  omitted/empty `tornDown` is treated as a failure (that would break every clean wave), or
  the check is performed by invoking git/`child_process` from the workflow script (ADR-008/005).

### C4 — ADR-016 overflow semantics survive the cheaper integrator: unclaimed extra files still integrate with a ⚠ advisory and still force the post-wave test gate, while a peer-claimed collision still routes to heal.
- **Observe:** run the harness with the parallel `ARGS` and
  `INTEG='{"integrated":true,"branches":["worktree-t1","worktree-t2","worktree-t3"],"advisories":[{"branch":"worktree-t1","taskId":"t1","extraFiles":["z.mjs"]}],"tornDown":["worktree-t1","worktree-t2","worktree-t3"]}'`.
  Expected: no `heal:` call for `t1` (the advisory branch is integrated, not rejected), a
  `logs` line containing `⚠` that names `worktree-t1` and `z.mjs`, and a `testgate` call is
  dispatched (at the executor tier) even though no heal fired. Then re-run the C1 collision
  case and confirm the collided task heals. Finally, read the prompt of the `integrate:w1`
  call: it must still direct a comparison of each branch's changed files against the
  declared-file list inlined for that wave, with the two distinct outcomes (peer-claimed →
  preserve + report; unclaimed → integrate with a ⚠).
- **Fails if:** overflow classification disappeared from the integrator's contract (a
  "simplified" cheap prompt that just cherry-picks), or an unclaimed overflow is rejected /
  routed to heal, or an advisory-only wave skips the test gate.

### C5 — The integrator maps a branch to its task from the ADR-017 commit stamp for *this* phase, mechanically derived from the phase slug — not from a judgement call about commit messages.
- **Observe:** run the harness twice with the same clean `INTEG` but
  `ARGS` phase `"07-some-phase"` then `"14-cheap-mechanical-integrator-and-clean-fast-path"`,
  and print the `integrate:w1` prompt each time. The prompt must instruct mapping via the
  commit-subject stamp and the stamp pattern it carries must track the slug: `(phase 07 t…`
  in the first run and `(phase 14 t…` in the second (zero padding preserved). The prompt must
  still carry the wave's task list (ids) so the mapping has a target set, and any
  changed-file/message inference that remains must be stated as the fallback for a
  stamp-less commit, not the primary method.
- **Fails if:** the stamp pattern is identical across both runs (hardcoded, so it would never
  match a real commit in another phase), or the phase number is not zero-padded (`(phase 7 t…`),
  or the prompt still leads with "map by commit message + changed files" as the primary rule.

### C6 — `integrator` is a first-class role everywhere a role map is produced or documented: every profile yields it, applying a profile can never leave it unset, and no role the execution workflow dispatches is missing from the documented role list.
- **Observe:** (a) `node -e "import('./lib/models.mjs').then(m=>console.log(JSON.stringify(['max','balanced','fast'].map(p=>m.profileModels(p)))))"` → each map contains `integrator`
  with `sonnet` for `max` and `haiku` for `balanced` and `fast`, and no profile is missing a
  role any other profile has. (b) In a throwaway project (`mkdir -p $SCRATCH/proj && cd $SCRATCH/proj && git init -q && node <repo>/bin/ac.mjs init` or the equivalent scaffold),
  run `ac models fast` then `ac config get models` → the persisted map contains
  `integrator`; then `ac config set models.integrator sonnet` && `ac config get models.integrator`
  → `sonnet`; then `ac models balanced` && `ac config get models.integrator` → a defined tier
  (never absent/null). (c) `node -e` scan every `models.<role>` consumed across
  `workflows/*.mjs`; the resulting role set is a subset of `Object.keys(profileModels('balanced'))`
  and every one of those roles is named in the `/astro-config` role reference.
- **Fails if:** any profile lacks `integrator` (a profile switch would then wipe a configured
  tier and hand the workflow an unset role), or `ac models <profile> --preview` emits a map
  without the role, or a role the workflow actually dispatches is absent from the documented
  role list a user picks from.

### C7 — The repo no longer contradicts itself about haiku: no surviving text claims the tier ladder excludes haiku from every role, and the carve-out is recorded as a project decision.
- **Observe:** `cd <repo> && grep -rniE "haiku|opus *(→|->|to) *sonnet only|no haiku" --include='*.mjs' --include='*.md' --include='*.json' . | grep -v '/\.git/' | grep -v '/\.astrocode/phases/'`
  and read every hit (expect hits in at least `lib/models.mjs`, `bin/ac.mjs`,
  `commands/astro-config.md`, `commands/astro-execute.md`, `lib/config.mjs`): not one of them
  asserts the exclusion holds for *every*/*all* roles or "everywhere" without naming the
  integrator as the exception; each surviving prohibition is scoped to the roles it still
  applies to. Also `grep -n "integrator" .astrocode/DECISIONS.md` → an ADR entry records the
  carve-out with its justification, and `commands/astro-execute.md` states the integrator's
  default tier and the bail-to-heal behavior a user would see.
- **Fails if:** any file still says haiku is excluded everywhere / that the ladder is
  opus→sonnet only, while the workflow ships a haiku default (the self-contradiction this
  phase must remove), or the exception exists in code with no entry in the decision log, or
  `/astro-config` still tells the user "do not offer haiku" for a role that now defaults to it.

### C8 — Nothing else regressed: the sequential/lean path never reaches an integrator, and the full suite is green.
- **Observe:** (a) run the harness with `ARGS='{"root":"/tmp/p","phase":"14-x"}'` (no
  `strategy` — 3 tasks stays sequential per ADR-026) and
  `COMMITTED='["t1","t2","t3"]'` → **zero** calls whose label starts with `integrate:`, exactly
  one task-implementation executor call (`exec:batch`) and its `model` is the executor tier
  (`<undefined>`/inherited here since `models` is empty — never `haiku`), and
  `result.strategy` is `sequential`. (b) `cd <repo> && node --test tests/` exits 0.
- **Fails if:** the sequential path acquires an integrator call, or the batch/per-task
  executor is silently downgraded to the integrator tier, or any existing test fails or was
  weakened/deleted to accommodate the change.
