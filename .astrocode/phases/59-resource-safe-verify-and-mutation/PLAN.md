# Phase 59 — Plan: resource-safe verify and mutation

Goal: when astro-code starts a heavy job (a test suite or a mutation run), the job slows down instead of exhausting the machine. It tests only the mutants the phase needs and leaves nothing behind. The pieces:
- An adaptive, conservative worker budget, on by default. It is computed from CPUs and free memory, and a project setting overrides it. Each tool receives it in its own way.
- One machine-wide lock. A second heavy job waits its turn and says what it is waiting for.
- Gremlins mutates only the phase's changed lines in a Go module below the repo root, or ac states a sound fallback.
- Mutation gets a private, size-capped Go build cache and a per-run temp folder. Both are removed when the run ends, and a dead run's leftovers are removed at the next run.
- Mutation always finishes.
- The folded-in debt is paid: the healed-wave test gate stops running the full suite in fast mode.

What a PASS means does not change.

Bar: CRITERIA.md C1–C18. Canon:
- ADR-096 is already recorded (60d8994), so no decision task.
- ADR-066/028: the test gate fails closed.
- ADR-094: fast mode.
- ADR-093: receipts.
- ADR-018/020.
- CONVENTIONS: `node:` built-ins only, named exports, no classes, one responsibility per `lib/` module, sentence-form tests on a real filesystem and real git.

Test strategy (ADR-018): **test-first inside each task.** Every behaviour task writes its spec test first, in its own test file, and lands it in the same commit as the implementation. No RED test is split into an earlier wave. A test that reaches a NEW export of an EXISTING module (for example `runSuite`'s new fields or `caprun`'s `killLiveGroups`) loads it with `const { x } = await import('../lib/<m>.mjs')` inside the async test body, never with a static import.

## Settled design (every task builds to this contract)

**Home of all machine state (ADR-057-style, outside any project).**
- `heavyHome(env = process.env)` lives in `lib/machinelock.mjs` and returns `env.ASTRO_HEAVY_DIR || join(env.HOME || homedir(), '.astro', 'heavy')`. This copies the `ASTRO_PRINCIPLES_DIR` override pattern from `lib/principles.mjs:76`.
- Under it are three entries:
  - `lock/`: the machine lock directory.
  - `runs/ac-run-<pid>-<rand6>/`: per-run folders, each with an `owner.json`.
  - `gocache/`: the private, persistent `GOCACHE`.
- Paths stay short (about 45 characters under `/Users/<u>`), which keeps Unix-socket paths of tests that run under the run TMPDIR inside the 104-byte limit.
- Tests ALWAYS set `ASTRO_HEAVY_DIR` to a temp folder of their own. `scripts/test.mjs` pins it inside its scratch TMPDIR. `restrictedEnv()` in `tests/fixtures/mutate/project.mjs` gives each call a fresh one unless `extra` overrides it. A test run therefore never touches the owner's real lock.

**Worker budget (`lib/budget.mjs`, C1/C2/C5). Pure core plus a thin reader.**
- `workerBudget({ cpus, freeBytes, setting })` returns `{ n, source: 'adaptive'|'setting', reason, cpus, free_bytes }`.
- Adaptive rule:
  - `cap = ceil(cpus / 4)`.
  - With `freeBytes` readable: `byMem = floor((freeBytes - RESERVE_BYTES) / PER_WORKER_BYTES)`, with `RESERVE_BYTES = PER_WORKER_BYTES = 2 GiB`.
  - `n = max(1, min(cap, byMem))`.
  - With `freeBytes` null or NaN: `n = max(1, cap)`, and the reason says `free memory unreadable — CPU-only rule`.
  - Never 0 and never above `cap`. Fixed inputs give: 11 CPUs with ample memory → 3; 11 CPUs with 1 GB → 1; 1 CPU → 1; 64 CPUs with memory unreadable → 16.
- Reason text example: `adaptive: 11 CPUs, 18.4 GB free → 3`.
- A setting example: `{ n: 2, source: 'setting', reason: 'project setting heavy.workers = 2' }`. The setting wins even above the cap, because it is the owner's explicit choice.
- `readAvailableMemory({ platform, run, readFile })` is injectable:
  - macOS: parse `vm_stat` and compute (free + inactive + speculative) × the page size from its header.
  - Linux: read `MemAvailable` from `/proc/meminfo`.
  - When `0 < process.constrainedMemory() < os.totalmem()`, take the minimum of the two.
  - Any failure returns `null`. Never throws.
- `os.availableParallelism()` supplies the CPU count.
- `budgetSetting(root, warnings)` reads `heavy.workers` from `.astrocode/config.json`:
  - It must be an integer ≥ 1.
  - Anything else becomes the warning `heavy.workers "<raw>" is not an integer >= 1 — ignored` and falls back to adaptive, in the same shape as `mutationSettings`.
- `resolveBudget(root, { warnings, cpus, freeBytes })` composes the above.
- `budgetEnv(env, n)` returns new env with:
  - `GOMAXPROCS=n`;
  - `ASTRO_WORKERS=n`;
  - `GOFLAGS` from `mergeGoFlags(env.GOFLAGS, n)`. That keeps all existing content, keeps an existing `-p=K` only when K < n, and otherwise replaces or appends `-p=n`.
- `shapeSuiteCommand(command, n)` returns `{ command, shaped: 'node --test'|'go test'|null }`:
  - It inserts `--test-concurrency=n` right after a leading `node --test`.
  - It inserts `-p n` right after a leading `go test`.
  - It leaves the command untouched when the flag is already present or when the command is anything else (opaque). Opaque commands get the env vars only.
- `capToBudget(projectValue, n)` returns `{ n, project, capped, note }`. A lower project value is kept. A higher one is capped with the note `project value K capped to the budget n`. An unknown value gives n with the note `project value unknown`.

**Machine lock (`lib/machinelock.mjs`, C6/C7/C16). It is NOT `withLock`.**
- `withLock` reclaims a lock after 10 s by mtime, so it would steal a live holder's lock.
- `acquireMachineLock({ project, command, env, onWait, sleep, now })` is SYNCHRONOUS, because `runSuite` is sync.
- Acquiring:
  - `mkdirSync(<home>/lock)` is the atomic acquire. Then it writes `holder.json` with `{ pid, started_ms (process start: Date.now() - process.uptime()*1000), project, command, token }`.
  - The first attempt is immediate, with no pre-sleep (C16).
  - It is reentrant when this process already holds the lock (depth counter), or when `env.ASTRO_HEAVY_LOCK` equals the current holder's token. That covers a nested `ac` launched by the holder's own child: ac's own suite spawns `ac suite run` and `ac mutate`, and without this the job would deadlock on itself.
  - Reentrant acquires are no-ops that return `reentrant: true`.
- Dead-holder takeover:
  - A holder counts as dead when `process.kill(pid, 0)` throws `ESRCH`. `EPERM` means alive.
  - A holder also counts as dead when its pid is alive but `ps -o lstart= -p <pid>` differs from `started_ms` by more than 2 s (pid reuse). `ps` failure means alive, which is safe: a live holder is never stolen.
  - It also counts as dead when `holder.json` is missing and the lock directory is older than 30 s (a holder killed between mkdir and write).
  - Takeover is `renameSync(lock, lock + '.dead-<pid>-<rand>')` followed by `rmSync`. The rename is atomic, so exactly one racer wins. The result carries `took_over: { project, command, pid }`.
- Waiting:
  - It sleeps with `Atomics.wait` (sync), polling every 100 ms and growing to 1 s.
  - It calls `onWait(line)` once and then every 30 s. The default writes the line with `fs.writeSync(2, …)` to stderr, never stdout, so `--json` output stays pure.
  - The line is `⊡ waiting for the machine lock: <project> \`<command>\` (held <age>, pid <pid>) — starts when it ends`.
  - There is no timeout, because a live holder is waited for (C7).
- `release()` is idempotent. It removes the lock only when `holder.json` still carries our token.
- The returned object is `{ release, token, waited_ms, took_over, reentrant }`.

**Per-run folders (`lib/rundir.mjs`, C13/C14/C15).**
- `makeRunDir(home)` returns `{ dir, tmp }`. It creates `runs/ac-run-<pid>-<rand6>/` with `owner.json` (`{ pid, started_ms }`) and a `tmp/` subfolder.
- `removeRunDir(dir)` uses `rmSync` with `recursive` and `force`, retrying once on `ENOTEMPTY`. It asserts that `dir` starts with `<home>/runs/ac-run-`, refusing anything else.
- `sweepDeadRuns(home, { isAlive })` deletes only entries that:
  - sit directly under `runs/`;
  - match `^ac-run-\d+-[a-z0-9]+$`;
  - are real directories (`lstat`, never following a symlink);
  - have an owner that is dead (the same liveness rule as the lock), or have no `owner.json` and are older than 60 s.
- The sweep returns `{ removed: [names], bytes }`. It never touches anything outside `runs/`.

**Private Go build cache (`lib/gocache.mjs`, C12).**
- `goCacheDir(home)` returns `<home>/gocache`. It is stable across runs, so warm builds survive.
- `goCacheMaxMb(root, warnings)` reads `heavy.go_cache_max_mb`, a number > 0 with a default of 5120. A bad value produces a warning and the default.
- `trimGoCache(dir, maxBytes)`:
  - It walks the files (`lstat`, never following a symlink), sorts them by `mtimeMs` ascending, and deletes oldest-first until the total is ≤ the cap.
  - It never wipes a cache that is already under the cap.
  - It returns `{ before_bytes, after_bytes, evicted: n, evicted_bytes }`.
  - Go refreshes the mtime of entries it uses, so mtime serves as the LRU signal.
- `GOMODCACHE` and `GOPATH` stay the user's own, so dependencies are never re-downloaded.

**Live child groups (`lib/caprun.mjs`, C13).**
- `runCapped` keeps the pid of every live detached child in a module-level `Set`, added at spawn and removed on close.
- New export `killLiveGroups(sig)` signals `-pid` for each of them. New export `liveGroups()` returns the pids, for tests.
- Behaviour is otherwise unchanged.

**Composition (`lib/heavy.mjs`, the one entry every heavy job uses).**
- `enterHeavy(root, { kind: 'suite'|'mutation', command, env = process.env, onWait })` is SYNCHRONOUS and runs these steps in order:
  1. Acquire the machine lock.
  2. Resolve the budget. This happens after the lock, so the free memory read is current.
  3. Sweep dead runs.
  4. Make the run dir.
  5. For `mutation` only, trim the private GOCACHE.
  6. Build the child env: `budgetEnv`, plus `TMPDIR`, `TMP`, `TEMP` and `GOTMPDIR` set to `<run>/tmp`, plus `ASTRO_HEAVY_LOCK=<token>`, plus `GOCACHE=<home>/gocache` for `mutation` only.
- It returns `{ workers, env, run_dir, tmp, lock: { waited_ms, took_over, reentrant }, cleaned, go_cache, leave() }`. `cleaned` is `null` when nothing was swept.
- `leave()` is idempotent. It removes the run dir, trims GOCACHE again (mutation only) and releases the lock.
- While entered, it installs handlers for `SIGINT`, `SIGTERM` and `SIGHUP`. A handler:
  1. calls `killLiveGroups('SIGTERM')`;
  2. waits up to 2 s for the groups to exit (polling `process.kill(-pid, 0)`), then sends `SIGKILL`;
  3. calls `leave()`;
  4. exits with 128 + the signal number.
- It also installs a `process.on('exit')` hook that calls `leave()` synchronously, which covers `die()` paths.
- The handlers are removed on `leave()`.

**Suites (`runSuite`, C1/C5/C6/C15).**
- `runSuite` calls `enterHeavy(kind 'suite')` BEFORE `treeState` and `started`, so the receipt's `started_at` and `seconds` never include a lock wait.
- It spawns `shapeSuiteCommand(command, n).command` with `env: heavy.env`.
- The receipt's `command` and `key` stay the ORIGINAL command. Hashing the shaped one would make every `reusableReceipt` lookup miss.
- The receipt adds:
  - `workers` (the budget object);
  - `shaped` (`'node --test'`, `'go test'` or `null`);
  - `tmpdir: 'private'`.
- `leave()` runs in a `finally`.
- `runTargeted`, `runCheapPass` and `runFullCheck` inherit all of this through `runSuite`.
- The cheap pass result gains `workers`: the budget of the last suite run it made, or `null` when it ran none.

**Mutation (`runMutate`, C2/C3/C4/C8/C11–C14).**
- Placement:
  - `enterHeavy(kind 'mutation', command: 'ac mutate <n>')` is called AFTER the P8 dirty check and log setup (around line 1190), and BEFORE `chooseTests`, `planCtx` and the `deadline`.
  - That means cheap no-tool, no-scope and refusal exits never wait for the lock, and the cap deadline starts after the lock is held (C8).
  - Every later return runs inside ONE `try { … } finally { heavy.leave() }`.
  - `heavy.env` replaces `env` for `narrowTests`, the flaky pre-check, the tool run and the collect steps.
- Budget precedence:
  - mutmut 3: `mutation.max_children` wins when set (`source: 'mutation.max_children'`). Otherwise it gets the budget n through the existing `maxChildrenArgs`. The mutmut 2 warning is unchanged.
  - Gremlins: `--workers W` with `W = capToBudget(projectWorkers, n)`. `projectWorkers` is read by regex `^\s*workers:\s*(\d+)\s*$` (multiline) from `.gremlins.yaml` in the Gremlins working directory, which is the module dir, else the root.
  - Gremlins never receives `--test-cpu` in any form, and `buildSurvivors` inherits `--workers`.
  - Stryker: `--concurrency C` with `C = capToBudget(projectConcurrency, n)`. `projectConcurrency` comes from `JSON.parse` for `.json` configs, and from the `concurrency:\s*(\d+)` regex for `.mjs`, `.js` and `.cjs` configs.
  - An unreadable Stryker config passes n, with the note `project value unknown`.
- Result fields:
  - `res.workers` (the budget);
  - `res.tool_workers` = `{ flag, value, project, capped, note }`;
  - `res.cleaned`, `res.go_cache` and `res.lock`;
  - `res.tmpdir` (the path, already removed).
- Mutation always finishes (C11). There is no stop-on-survivor option, and a regression test pins that.

**Subfolder Go module: changed lines through a scratch repo (`lib/scratchmod.mjs`, C9). The CONTEXT D4 candidate, with a stated fallback.**
- `scratchModule(root, { modDir, base, into })` returns `{ ok: true, dir, base: <scratch sha> }` or `{ ok: false, reason }`. It uses the git CLI and `tar` only.
- Soundness gate. Any of these returns `ok: false` with the reason:
  - a `go.work` file at the repo root or in `modDir`;
  - a `replace` line in `go.mod` whose target path starts with `../`;
  - a `//go:embed` pattern containing `..`;
  - a failure of `git archive`.
- Build:
  1. `git init -q` under `into/mod`.
  2. Extract `git archive <base>:<modDir>` into it. When the module did not exist at the base, the base tree is empty.
  3. Commit with `-c user.name=ac -c user.email=ac@local -c commit.gpgsign=false -c core.hooksPath=/dev/null` and `GIT_CONFIG_GLOBAL=/dev/null`.
  4. Replace the tree with `git archive HEAD:<modDir>`. The scope is clean at HEAD (P8).
  5. Commit again.
- Equality check: the `@@` hunk headers and the file list of `git -C scratch diff --unified=0 <b> HEAD` must equal those of `git -C root diff --unified=0 <base> HEAD -- <modDir>` with paths made module-relative. Any mismatch returns `ok: false, reason: 'scratch diff differs from the repo diff'`. A diff that is empty in the scratch copy also returns `ok: false`.
- In `runMutate`, for a subfolder module with a base and no `mutation.files` whole files:
  - On `ok`, Gremlins runs with `cwd = dir` (inside the run dir, so `leave()` removes it) and `--diff <scratch base>`. `diffMode` is true, and `detail.narrowed = 'diff'` with a why that names the scratch repo.
  - Otherwise the phase-56 file mode stays as it is today, and `detail.why` gains `— fell back to whole-file mode: <reason>`. `detail.fallback` holds that reason.
  - In both cases parsing, the `modDir` mapping and the survivor line filter are unchanged, so a mutant is reported only when it ran and lies on the phase's lines.

**Healed-wave test gate (debt `2026-11-13-healed-wave-test-gate-still-runs-the`, C17).**
- `testGatePlan(root, slug)` in `lib/targeted.mjs` is read-only and runs no process. It returns `{ mode, command, tests, reason }`:
  - `mode: 'targeted'` when `verifyFullSuite(root) === 'milestone'` and `targetedTests(root, slug).tests` is not empty. Then `command = targetedCommand(targetedCommandTemplate(root), tests)`.
  - Otherwise `mode: 'full'`, with `command = suiteCommandSetting(root)` (null when unset) and a reason: `verify.full_suite: phase` or `no linked tests — the full suite runs instead`. An empty targeted set never passes a gate, because of the ADR-014 trap.
- The CLI is `ac suite targeted <phase> [--json]` (t13).
- `workflows/execute-phase.mjs`:
  - Before `runTestSuite`, a small agent call (`label: 'testgate-plan'`, `models.executor`, strict `GATEPLAN_SCHEMA`) runs `ac suite targeted <phaseSlug> --json` in `root` and returns its fields.
  - `runTestSuite(plan)` then builds ONE of two prompts:
    - **targeted:** run exactly `ac suite run --command "<plan.command>" --json`, naming the targeted files. "Do NOT run the full suite." `ranSuite` is true.
    - **full:** used when `plan` is null (the agent failed), `mode: 'full'`, or there is no command. It is today's prompt, plus "run it through `ac suite run --command \"<cmd>\"` so it waits for the machine lock and takes the worker budget".
  - Unchanged in both modes:
    - `TESTGATE_SCHEMA`;
    - the `testsRun` counting text;
    - the `noSuite` and `ranNothing` fail-closed logic (ADR-066/028);
    - teardown ownership;
    - the `label: 'testgate'` source line.

## Tasks

### t1 — `lib/budget.mjs`: the adaptive worker budget, the `heavy.workers` setting, env and command shaping
- **id:** t1
- **files:** lib/budget.mjs, tests/budget.test.mjs
- **depends_on:** []
- Test first (`tests/budget.test.mjs`), covering:
  - the C1 fixed inputs (11 CPUs ample, 11 CPUs with 1 GB, 1 CPU, 64 CPUs unreadable), including the reasons;
  - that no input from 1–128 CPUs and 0–1 TB free yields 0 or a value above `ceil(cpus/4)`;
  - the `heavy.workers` setting winning, with its reason naming the setting;
  - bad settings warning and falling back;
  - `vm_stat` and `/proc/meminfo` parsing from captured text (injected `run` and `readFile`), and a failing reader giving `null`;
  - `mergeGoFlags` (empty, `-short` kept, `-p=1` kept, `-p=8` replaced);
  - `shapeSuiteCommand` for `node --test`, `node --test tests/a.test.mjs`, `go test ./...`, an already-flagged command, and an opaque `sh ./run.sh`;
  - `capToBudget` lower, higher and unknown.
- Then implement it to the design. Module header: why the budget is adaptive and why `os.freemem()` is not used.

### t2 — `lib/machinelock.mjs`: one heavy job per machine, waited for, dead holders taken over
- **id:** t2
- **files:** lib/machinelock.mjs, tests/machinelock.test.mjs, scripts/test.mjs
- **depends_on:** []
- Test first. Use real child `node` processes, each with its own `ASTRO_HEAVY_DIR`. Cover:
  - A free lock is taken on the first attempt with `sleep` never called (C16).
  - A second process from another project root waits while the first holds the lock. It calls `onWait` with a line naming the holder's project, command and age, and gets the lock only after the holder releases (C6).
  - A `kill -9`'d holder is taken over within a few seconds, with `took_over` set (C7).
  - A live holder is never taken over, even after more than 10 s held (use an injected `now`).
  - Pid reuse (a holder.json whose pid is alive but whose `started_ms` is wrong) counts as dead.
  - Reentrancy works both in-process and through `ASTRO_HEAVY_LOCK`, and a foreign token is not reentrant.
  - `release` is idempotent and never removes another holder's lock.
  - Two racing takeovers yield exactly one holder.
- Then implement it. In `scripts/test.mjs`, set `ASTRO_HEAVY_DIR` to a folder inside its scratch dir, so `npm test` never touches the real lock.

### t3 — `lib/rundir.mjs`: per-run folders and the dead-run sweep
- **id:** t3
- **files:** lib/rundir.mjs, tests/rundir.test.mjs
- **depends_on:** []
- Test first. Cover:
  - Two `makeRunDir` calls give two distinct folders, each with `owner.json` and `tmp/`.
  - `removeRunDir` deletes a populated folder and refuses a path outside `<home>/runs/ac-run-`.
  - `sweepDeadRuns` removes the folder of a dead pid (a spawned `node -e` that has exited). It keeps one owned by a live pid (the test's own) and a fresh folder with no owner. It ignores non-matching names (`gremlins-x`, `mine`), a symlink to a folder outside, and files.
  - The sweep reports names and bytes.
- Liveness comes from an injectable `isAlive`. The default is the same rule as t2, duplicated as a small local helper: `process.kill(pid, 0)` plus the start-time guard. The tasks run in parallel, so a shared import would cross files. t9 may hoist it later if it wants to; that is not required.

### t4 — `lib/gocache.mjs`: private Go build cache with an oldest-first size cap
- **id:** t4
- **files:** lib/gocache.mjs, tests/gocache.test.mjs
- **depends_on:** []
- Test first. Cover:
  - A temp cache of files with staggered `utimesSync` mtimes, over the cap, ends ≤ the cap, and exactly the oldest are removed.
  - A cache under the cap is untouched, so there is no full wipe.
  - An empty or missing dir reports zeros.
  - Symlinks are not followed.
  - `heavy.go_cache_max_mb` is read, validated and defaulted (5120), with a bad value warning.
- Then implement it.

### t5 — `lib/caprun.mjs`: track live child groups so a signal handler can kill them
- **id:** t5
- **files:** lib/caprun.mjs, tests/caprun.test.mjs
- **depends_on:** []
- Test first, with new exports loaded by `await import`. Cover:
  - While a `runCapped` child sleeps, `liveGroups()` holds its pid.
  - `killLiveGroups('SIGTERM')` ends it and its grandchild.
  - After close the set is empty.
- Existing caprun tests stay green.

### t6 — `lib/scratchmod.mjs`: a scratch git repo of a subfolder Go module for `--diff`
- **id:** t6
- **files:** lib/scratchmod.mjs, tests/scratchmod.test.mjs
- **depends_on:** []
- Test first, with real git and no `go` needed. Cover:
  - In a repo with `svc/go.mod` and a phase commit changing one line, the scratch repo's `git diff --unified=0 <b> HEAD` has exactly the repo's `svc/` hunks with module-relative paths, and its files are byte-identical to `HEAD:svc`.
  - A module that is new at the base gives a whole-file diff.
  - Each gate returns `ok: false` with a reason naming it: a `go.work` file, `replace x => ../shared`, and `//go:embed ../x`.
  - Commits succeed with no global git identity (`GIT_CONFIG_GLOBAL=/dev/null`, `HOME` pinned).
  - Nothing is written outside `into`.
- Then implement it to the design.

### t7 — `lib/targeted.mjs`: `testGatePlan`, which tells the healed-wave gate which tests to run
- **id:** t7
- **files:** lib/targeted.mjs, tests/targeted_gate.test.mjs
- **depends_on:** []
- Test first (`await import` for `testGatePlan`), on a real git project with stamped phase commits. Cover:
  - Default (milestone) mode with linked tests gives `mode: 'targeted'`, the same `tests` as `targetedTests`, and the template-shaped `command`.
  - `verify.full_suite: phase` gives `mode: 'full'` with that reason.
  - Fast mode with no linked tests gives `mode: 'full'` with the `no linked tests` reason.
  - It never spawns a process.
- Then implement it.

### t8 — `workflows/execute-phase.mjs`: the healed-wave gate runs the targeted set in fast mode, the full suite otherwise, and still fails closed
- **id:** t8
- **files:** workflows/execute-phase.mjs, tests/execute_testgate_fast.test.mjs, tests/workflows.test.mjs
- **depends_on:** []
- Test first (`tests/execute_testgate_fast.test.mjs`). Load the workflow with stubbed hooks the way `tests/workflows.test.mjs` does (its loader near line 2570, and the heal or overflow fixtures behind the `testgate` assertions near line 2986). Drive a run where a wave is healed, then cover:
  - **(a)** The `testgate-plan` stub returns `{mode:'targeted', command:"node --test 'tests/a.test.mjs'", tests:['tests/a.test.mjs']}`. The `testgate` prompt names that command and file, contains `ac suite run`, and contains no "Run the full test suite" or "all tests".
  - **(b)** The stub returns `mode:'full'`. The prompt is the full-suite prompt.
  - **(c)** The stub returns null. The prompt falls back to the full suite.
  - **(d)** In targeted mode, a gate returning `testsRun: 0` and one returning `passed: false` both stop the phase. `ranSuite: false` in full mode keeps the unproven path (ADR-028).
- Then implement it to the design, with no semicolons, in Workflow style. Arguments stay small scalars; the agent reads the plan from `ac`.
- Adjust `tests/workflows.test.mjs` only where its stub agent must answer the new `testgate-plan` label. Its model-tier assertions extend to that label (executor tier).

### t9 — `lib/heavy.mjs`: `enterHeavy`, one entry for lock, budget, sweep, run dir, cache and signals
- **id:** t9
- **files:** lib/heavy.mjs, tests/heavy.test.mjs
- **depends_on:** [t1, t2, t3, t4, t5]
- Test first, with a temp `ASTRO_HEAVY_DIR`. Cover:
  - `enterHeavy` returns the budget, an env with `TMPDIR`, `TMP`, `TEMP`, `GOTMPDIR` set to a fresh `runs/ac-run-*/tmp`, and `GOMAXPROCS`, `ASTRO_WORKERS` and `GOFLAGS -p` set.
  - Mutation kind also sets `GOCACHE=<home>/gocache`, which is neither `go env GOCACHE` nor under it. Suite kind leaves `GOCACHE` alone.
  - `leave()` removes the run dir and releases the lock, and is idempotent.
  - A dead run's folder is swept and reported in `cleaned`.
  - A child script that enters, spawns a sleeping `runCapped` grandchild and is sent `SIGINT` exits 130, its run dir is gone and the grandchild is dead.
  - The `exit` hook cleans up after `process.exit(1)`.
  - Free-lock entry adds no sleep.
- Then implement it. Module header: why the order is lock → budget, and why suites do not get `GOCACHE`.

### t10 — `runSuite` takes the lock, the budget and a private temp folder; the cheap pass reports its budget
- **id:** t10
- **files:** lib/receipts.mjs, lib/cheappass.mjs, tests/suite_budget.test.mjs
- **depends_on:** [t9]
- Test first (`await import`, temp `ASTRO_HEAVY_DIR`, a real tmp git project), covering:
  - **Budget and shaping (C5).** `runSuite(root, 'node --test')` spawns `node --test --test-concurrency=N`, observed through an injected `spawn` that records argv and env. Also check a real run whose test logs `process.execArgv`. The receipt `command` and `key` equal those of the original command, and `reusableReceipt(root, 'node --test')` finds it. `go test ./...` gets `-p N`. An opaque `sh ./run.sh` that dumps `env` sees `ASTRO_WORKERS`, `GOMAXPROCS` and `GOFLAGS -p`.
  - **Exit code.** The exit code and pass/fail match an unbounded run.
  - **Private temp folder (C15).** A test that logs `os.tmpdir()` and writes a file there sees a run-specific folder that is gone afterwards, on a passing and on a failing suite.
  - **Receipt fields.** The receipt carries `workers`, `shaped` and `tmpdir: 'private'`.
  - **Lock wait (C6).** `started_at` is after the lock wait: hold the lock from a child for 1 s, and `seconds` stays below 1.
  - **Cheap pass (C1).** `runCheapPass` (fast mode) returns `workers`.
- Then implement it to the design.

### t11 — `runMutate` under the budget: tool flags, env, lock, private cache and temp folder, cleanup on every ending
- **id:** t11
- **files:** lib/mutate.mjs, tests/fixtures/mutate/stub.mjs, tests/fixtures/mutate/project.mjs, tests/mutate_budget.test.mjs
- **depends_on:** [t9]
- **Stub (additive).** Log env `GOMAXPROCS`, `GOCACHE`, `TMPDIR`, `GOTMPDIR` and `ASTRO_WORKERS`. A new knob `MUTATE_STUB_TMPWRITE=1` writes `stub-was-here` into `$TMPDIR` and logs `os.tmpdir()`.
- **`restrictedEnv()`.** Gives each call a fresh `ASTRO_HEAVY_DIR` under its temp HOME unless `extra` sets one.
- **Tests first** (`tests/mutate_budget.test.mjs`, `await import` for new exports). Each fixture is a real project, and `heavy.workers` is set to 2 through `.astrocode/config.json`:
  - **Gremlins (C3).** argv has `--workers 2`, and no argument contains `test-cpu`. Env has `GOMAXPROCS=2`. A preset `GOFLAGS=-short` ends as `-short -p=2`. `.gremlins.yaml` `workers: 1` gives `--workers 1`. `workers: 8` gives `--workers 2`, with `res.tool_workers.capped` true and a note.
  - **mutmut and Stryker (C4).** mutmut 3 gets `--max-children 2`. `mutation.max_children: 1` gives 1 with source `mutation.max_children` (C2). The Stryker stub gets `--concurrency 2`. A config with `concurrency: 1` gives 1. `concurrency: 16` gives 2, capped and stated.
  - **Budget reporting (C1/C2).** `res.workers` names the source and reason: adaptive when unset, the setting when set.
  - **Private cache (C12).** `GOCACHE` is `<ASTRO_HEAVY_DIR>/gocache`. A pre-filled over-cap cache (`heavy.go_cache_max_mb` small, staggered mtimes) is at or below the cap after the run, with the oldest evicted.
  - **Temp folder (C13).** `TMPDIR` is run-specific, differs between two runs, and is gone after each of four endings: stub exit 0, stub exit 1, stub sleeping past a short `mutation.cap_seconds`, and `kill -INT` of a background `node bin/ac.mjs mutate <n> --json` mid-run, after which the stub's group is dead too.
  - **Dead-run sweep (C14).** Kill a sleeping run with `kill -9` (ac and the stub group). The next `ac mutate` removes its folder and reports `res.cleaned`. A live run's folder (owned by a sleeping `node` process) survives.
  - **Cap excludes the lock wait (C8, in-process).** Hold the lock from a child for 1.5 × cap. `runMutate` with a fast stub completes uncapped.
  - **Mutation finishes (C11).** A stub Gremlins report with at least 5 mutants on the phase lines and at least 4 survivors, including the first two, gives every survivor and a tested count equal to the total.
- **Then implement it** to the design. One `try/finally` covers every return after `enterHeavy`. The deadline is set after `enterHeavy`. `MUTATION_TOOLS` rows read `ctx.workers` (Gremlins `--workers`, Stryker `--concurrency`), and mutmut's `maxChildren` defaults to the budget.
- Existing mutate tests stay green. Update an assertion only where it pinned the exact old argv, and say so in the commit.

### t12 — Subfolder Go modules: Gremlins `--diff` through the scratch repo, with a stated fallback
- **id:** t12
- **files:** lib/mutate.mjs, tests/mutate_subdir_diff.test.mjs, tests/fix_mutate_go_subdir.test.mjs, tests/mutate_real.test.mjs
- **depends_on:** [t6, t11]
- **Stub tests first** (`tests/mutate_subdir_diff.test.mjs`):
  - A repo with `svc/go.mod` and one changed line runs `gremlins` with `cwd` under `<ASTRO_HEAVY_DIR>/runs/ac-run-*/mod`. Its argv has `--diff <sha>` and NO `--exclude-files` list, and `scope_detail.narrowed === 'diff'`. The scratch folder is gone after the run.
  - With `go.work` present, the run uses file mode, and `scope_detail.why` and `scope_detail.fallback` state the reason.
- **Update `tests/fix_mutate_go_subdir.test.mjs`.** Its old expectation that a subfolder module always uses file mode now holds only in the fallback cases.
- **Real-tool tests** in `tests/mutate_real.test.mjs`. They skip unless `gremlins` and `go` are on PATH. A module at `svc/` has one file with many mutable lines and a phase commit that changes exactly one of them:
  - **C9.** The tested total equals the per-line count of the same module at the repo root, which is far below the whole-file count. Killed and survived outcomes are equal to the root case.
  - **C10.** In a variant where the phase changes one covered function and one function no test calls, the uncovered function's mutants are never KILLED. Outcomes are identical at `heavy.workers` 1, 3 and default, in both the root and the `svc/` layout.
  - **C12.** `du -sk "$(go env GOCACHE)"` is unchanged across the run.
- **Then implement it** in `runMutate` to the design, replacing the comment at lines 1199–1201.

### t13 — CLI: budget, lock and cleanup lines; `ac suite targeted`; cross-project lock tests
- **id:** t13
- **files:** bin/ac.mjs, tests/heavy_cli.test.mjs
- **depends_on:** [t7, t10, t11]
- **Tests first** (`tests/heavy_cli.test.mjs`). They spawn `bin/ac.mjs`. Two scratch projects A and B share one temp `ASTRO_HEAVY_DIR` and have no `ASTRO_HEAVY_LOCK` in their env. Cover:
  - **C6.** A runs `ac suite run --command "sh -c '…a.start; sleep 3; …a.end'"`. B, started a second later, prints the wait line to stderr naming A's project, command and age. `b.start ≥ a.end`, and B exits 0. A `mutate` holder against a `suite` waiter, and the reverse, are also serialized.
  - **C7.** After `kill -9` of A and its child, B's `ac suite run --command true` finishes within 5 s and exits 0.
  - **C8 via the CLI.** A holds the lock with a suite for 1.5 × the mutation cap while B's `ac mutate <n> --json` (fast stub) waits. B is not capped and lists all mutants.
  - **C1.** `ac suite run --command "node --test" --json` carries `workers.n` in 1..`ceil(cpus/4)` with a reason. The text mode prints one budget line.
  - **C2.** `ac config set heavy.workers 2`, then `--json` shows `source: 'setting'`.
  - **C1 for the cheap pass.** `ac verdict cheap <n> --json` carries `workers`.
  - **`ac suite targeted <n> --json`** prints the `testGatePlan` fields, and a stray flag is refused.
  - **C16.** `ac suite run --command true` on a free lock reports `lock.waited_ms === 0`.
- **Then wire it:**
  - `ac suite run` prints `• workers: <n> (<reason>)` and, when present, `• cleaned <k> dead run folder(s), <MB> MB` (at most one line each).
  - `ac suite <run|receipt|targeted>` gains usage and the `checkFlags` allowlist `'suite targeted': ['json']`.
  - `ac mutate` prints, beside the cap line, one budget line that names a tool cap note when there is one, and one cleaned line only when something was swept.
  - `ac verdict cheap` prints one budget line.
  - The help text (near line 632) documents `heavy.workers`, `heavy.go_cache_max_mb`, `ASTRO_WORKERS`, `GOMAXPROCS`, `GOFLAGS -p` and `ASTRO_HEAVY_DIR`.

### t14 — Docs for the budget, the lock and the env vars; full-suite gate
- **id:** t14
- **files:** commands/astro-mutate.md, commands/astro-verify.md, commands/astro-config.md, commands/astro-help.md, MANUAL.md, tests/mutate_docs.test.mjs, tests/heavy_docs.test.mjs
- **depends_on:** [t12, t13]
- **Tests first.** `tests/heavy_docs.test.mjs` asserts:
  - the `ac suite run` docs (`commands/astro-verify.md` and `MANUAL.md`) name `ASTRO_WORKERS`, `GOMAXPROCS` and `GOFLAGS -p`, `--test-concurrency` and `go test -p` shaping, and the private TMPDIR;
  - `commands/astro-config.md` documents `heavy.workers` and `heavy.go_cache_max_mb`, with defaults;
  - `commands/astro-mutate.md` documents the budget per tool, the "lower project value respected, higher capped" rule, the machine lock wait, the private Go cache and temp folder, the subfolder `--diff` path and its fallback, and "no early stop".
  
  Extend `tests/mutate_docs.test.mjs` only where it pins the subfolder file-mode text.
- **Then write the docs** in the house voice. Any new reporting slot states its bound ("in one line", "say nothing when nothing was cleaned"), which `tests/commands.test.mjs` already enforces.
- **Final gate (C18), folded in.** Run `node bin/ac.mjs suite run --command "node --test"` at the repo root. It must exit 0 with a non-zero test count. Fix nothing outside this task's files. A failure elsewhere is reported back, not patched here.

## Wave shape

- **W1** (8 in parallel, disjoint files): t1, t2, t3, t4, t5, t6, t7, t8
- **W2:** t9 (needs t1–t5)
- **W3** (2 in parallel): t10 (`receipts`/`cheappass`) and t11 (`mutate.mjs`, stub, fixtures)
- **W4** (2 in parallel): t12 (`mutate.mjs`, after t6 and t11) and t13 (`bin/ac.mjs`, after t7, t10 and t11)
- **W5:** t14 (docs plus the full-suite gate)

Same-file check: `lib/mutate.mjs` is t11 then t12, serialized. `bin/ac.mjs` is t13 only. `tests/workflows.test.mjs` is t8 only. `tests/fixtures/mutate/*` is t11 only.

Every task adds new symbols or additive behaviour, and nothing is deleted or renamed, so every wave boundary compiles (ADR-020).

## Deferred (not tasks)

- A periodic GOCACHE trim during a long run. A cap is checked at start and end only, so one run can still overshoot until it ends.
- `ac calibrate` (planted-mutant runs) under the lock and the budget.
- Bounding the inner workers of Stryker's test runner (Jest `--maxWorkers`, Vitest threads). Stryker `--concurrency` × runner workers can still oversubscribe; this is a known residual risk.
- An opt-out setting for the private TMPDIR of `ac suite run`.
- `nice` or `setPriority` for heavy children, and `GOMEMLIMIT`.
- Sweeping foreign leftovers (`gremlins-*` in `~/.astroforge/tmp`, astrobot's `astrobot-job*` and `hostd-bin-*`). Those are out of scope per CONTEXT; this phase sweeps only `ac-run-*` folders it created.
- Paying the debt item. That happens on accept (CONTEXT D6), not as a task.
