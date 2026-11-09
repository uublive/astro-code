# Phase 56 — pre-registered success criteria

Derived from the phase goal, `CONTEXT.md` (owner decisions 1-7, constraints) and ADR-093 (amends
ADR-091; ADR-079/089/090 hold). Written plan-blind, before any PLAN.md.

Shared scratch fixture (used by C1-C9): a throwaway git repo under the temp dir, initialised with
this checkout's `node bin/ac.mjs init`, holding one phase whose CRITERIA.md has (a) a suite criterion
tagged suite whose suite command is a shell one-liner that appends a line to a marker file OUTSIDE the
repo and exits 0 (so a run is countable and never dirties the tree), (b) a non-suite criterion whose
declared cheap command exits 1, (c) a non-suite criterion whose declared cheap command exits 0. Everything
committed, tree clean. "Seeding a timing of S seconds" means: run `node bin/ac.mjs suite run --command
"<that command>"` once, set `seconds` to S in the receipt it wrote under `.astrocode/.local/suite-receipts/`
(machine-local, never committed), then make a new commit so that receipt is no longer reusable at HEAD.
"Runs" below always means the marker file gained a line.

### C1 [core] — The cheap first pass does not execute a suite whose most recent recorded run on this machine exceeded the threshold; it reports that suite as held back (not run), and still lists every other unmet criterion
- **Observe:** in the fixture, seed a timing of 900 s, then run `node bin/ac.mjs verdict cheap <n> --json` (and the same without `--json`). The marker file gains no line; the output names the suite criterion as held back / not run (not in `unmet`, not reported passed); `unmet` is exactly the failing non-suite criterion; exit status is non-zero because of that criterion. `node bin/ac.mjs verdict history <n>` and `verdict show <n> --json` do not list the suite criterion as unmet or failed. Repeat with criterion (b) fixed to exit 0: still no marker line, the pass ends clean-or-held-back but nothing is recorded as a PASS and `node bin/ac.mjs phase verify <n>` refuses.
- **Files:** `lib/cheappass.mjs` `lib/receipts.mjs` `lib/verdict.mjs` `lib/impact.mjs` `bin/ac.mjs`
- **Fails if:** the slow suite still runs in the cheap pass; it is reported as passed, failed or unmet; the pass stops at the first unmet id instead of listing every one; or a cheap pass with a held-back suite lets the phase verify.

### C2 [core] — A suite command with no recorded run is treated as slow until it has been timed once, and the timing the verifier's run records is what decides the next round
- **Observe:** in a fresh fixture with no receipt at all for the suite command, `node bin/ac.mjs verdict cheap <n> --json` adds no marker line and reports the suite held back. Then run the suite once through `node bin/ac.mjs suite run --command "<cmd>"` (a fast command, a second or two), make a new commit, and run the cheap pass again: this time the marker gains exactly one line and the suite criterion is reported met.
- **Files:** `lib/cheappass.mjs` `lib/receipts.mjs` `bin/ac.mjs`
- **Fails if:** an untimed suite runs in the cheap pass; or after a timed fast run the suite stays held back (e.g. because only a receipt for the current HEAD counts as "a timing", so every new commit looks untimed again); or `ac suite run` does not leave a timing the next pass reads.

### C3 [core] — A fast suite keeps today's behaviour: it runs in the cheap pass and its failure is reported there
- **Observe:** in the fixture, seed a timing of 30 s, make the suite command exit 1 (still appending its marker line), commit, then `node bin/ac.mjs verdict cheap <n> --json`. The marker gains exactly one line, the suite criterion is listed in `unmet` alongside the failing non-suite criterion, and a fresh receipt for the new HEAD records the run. With the suite command exiting 0 instead, it is reported met.
- **Files:** `lib/cheappass.mjs` `lib/receipts.mjs` `bin/ac.mjs`
- **Fails if:** a suite timed under the threshold is held back (the change would add a round to every project with a fast suite, against the constraint that nothing adds time to every phase), or its failure is hidden.

### C4 [core] — A reusable suite receipt is still used for a slow suite: it costs nothing, so the cheap pass reports the suite met from it without running it
- **Observe:** in the fixture at a clean HEAD, run `node bin/ac.mjs suite run --command "<cmd>"` (exit 0), set that receipt's `seconds` to 900 WITHOUT making a new commit, then `node bin/ac.mjs verdict cheap <n> --json`. The marker gains no further line and the suite criterion is reported met through the receipt (not held back, not unmet).
- **Files:** `lib/cheappass.mjs` `lib/receipts.mjs`
- **Fails if:** a reusable receipt is ignored because the suite is slow (reported held back), or the slow suite is re-run despite a valid receipt.

### C5 [core] — The threshold is 10 minutes by default and a project setting changes it
- **Observe:** in the fixture with no threshold setting, a seeded timing of 590 s makes the cheap pass run the suite (marker +1) and 610 s holds it back (marker +0). Set the project setting the shipped docs name for the threshold (CONTEXT suggests `verify.slow_suite_minutes`) through `node bin/ac.mjs config set …` to 1: a seeded 120 s timing is now held back. Set it to 30: a seeded 610 s timing now runs.
- **Files:** `lib/cheappass.mjs` `lib/config.mjs` `bin/ac.mjs`
- **Fails if:** the default is not 10 minutes (either boundary case comes out wrong), the setting is ignored, or it is read in the wrong unit (seconds vs minutes).

### C6 [core] — "Slow" is decided by the MOST RECENT recorded run of that exact command on this machine, not the oldest, the longest or one at HEAD only
- **Observe:** in the fixture, seed a 900 s timing at commit A, commit, seed a 30 s timing (a later run) at commit B, commit again; the cheap pass runs the suite (marker +1). Reverse the order (30 s earlier, 900 s latest): the suite is held back. A receipt with a long timing for a DIFFERENT command string does not make this command slow.
- **Files:** `lib/cheappass.mjs` `lib/receipts.mjs`
- **Fails if:** an older or longer run decides, a timing for another command leaks in, or only a receipt on the current HEAD counts.

### C7 [edge] — An unusable threshold setting never silently makes every suite fast
- **Observe:** `node bin/ac.mjs config set` with a non-numeric or negative value for the threshold setting is either refused with a message, or (if stored) the cheap pass falls back to the 10 minute default with a warning: a seeded 900 s timing is still held back.
- **Files:** `lib/config.mjs` `lib/cheappass.mjs` `bin/ac.mjs`
- **Fails if:** a bad value turns into a threshold that runs a 900 s suite in the cheap pass, or crashes the pass.

### C8 [core] — A failing verify round with the slow suite held back is recorded as a FAIL that lists every unmet non-suite criterion and shows the suite as not run — never passed, never failed
- **Observe:** in the fixture, after the cheap pass of C1, record a verifier result the way the shipped verifier contract (`agents/astro-verifier.md`) says to report a held-back suite, with two non-suite criteria failed: `node bin/ac.mjs verdict record <n> --result '<json>'`. Then `node bin/ac.mjs verdict show <n> --json` and `verdict history <n>`: the run is FAIL, `unmet` holds both failing ids, and the suite criterion appears as held back / not run (not in `unmet`, not `passed`, not `failed`, not flagged flapping, not offered in the `deferrable:` line). `node bin/ac.mjs phase verify <n>` refuses.
- **Files:** `lib/verdict.mjs` `bin/ac.mjs` `agents/astro-verifier.md`
- **Fails if:** a held-back suite is recorded as passed (a false PASS route) or as failed (a false FAIL that later reads as flapping or gets remediated/deferred), or only the first unmet criterion is recorded.

### C9 [core] — A PASS still requires the suite observed on the verified commit: no verdict can verify a phase while the slow suite is held back
- **Observe:** in the fixture, record a result where every non-suite criterion passed and the suite criterion is held back / not observed: `node bin/ac.mjs verdict record <n> --result '<json>'` does not record a PASS and `node bin/ac.mjs phase verify <n>` refuses. Then run the suite through `node bin/ac.mjs suite run --command "<cmd>"` at the clean HEAD (exit 0) and record the suite criterion as passed on that commit: the record is a PASS and `phase verify` succeeds. A receipt from an earlier commit is not accepted as the suite's evidence at HEAD. Targeted/narrowed carries keep ADR-089's rules (a suite criterion is never carried without a receipt for the exact clean tree).
- **Files:** `lib/verdict.mjs` `lib/receipts.mjs` `bin/ac.mjs`
- **Fails if:** any path (narrowed, targeted, cheap-stage, carried) reaches verified without the suite observed or a valid reusable receipt for the verified commit.

### C10 [core] — Remediation and narrowed re-verify rounds follow the same order: the unmet non-suite criteria first, the slow suite only after they all pass
- **Observe:** after the FAIL of C8, `node bin/ac.mjs verdict plan <n> --json` puts the failing non-suite ids in the set re-checked first and keeps the slow suite out of that first set while still requiring it before a PASS (it is not dropped from the round). Drive `workflows/execute-phase.mjs` with recording stub agents, the way `tests/verify_loop.test.mjs` drives it: a verifier round returning two unmet non-suite criteria plus the held-back suite spawns a remediation whose prompt lists the two unmet ids and does NOT ask the executor to fix the suite; the following verify is ordered the same way.
- **Files:** `lib/verdict.mjs` `workflows/execute-phase.mjs` `bin/ac.mjs`
- **Fails if:** a narrowed/remediation round runs the slow suite before (or regardless of) the unmet non-suite criteria, drops the suite from what a PASS needs, or hands the held-back suite to an executor as a failure to fix.

### C11 [core] — The human report of a held-back round names every unmet criterion and says the suite was held back, and a round with nothing unmet but a held-back suite never spends a remediation cycle
- **Observe:** with the same stubbed drive of `workflows/execute-phase.mjs`: the round's `verdict.summary` starts with FAIL, names each unmet id and states the suite was not run (held back: slow suite); it never reads `ok` and never says the suite failed. When a verifier round reports every non-suite criterion passed but the suite held back (no unmet ids), no `remediate:` agent is spawned with an empty unmet list; the loop goes on to observe the suite (or reports why it could not), never a PASS without it.
- **Files:** `workflows/execute-phase.mjs`
- **Fails if:** the summary hides an unmet id, calls the suite failed or passed, reads `ok`, or an executor is spawned with zero unmet criteria.

### C12 [core] — Folded-in debt: after a withdrawn carried PASS with zero unmet criteria the loop spends no remediation cycle, and the FAIL summary states the withdrawal instead of 'ok'
- **Observe:** drive `workflows/execute-phase.mjs` with stub agents: a verifier claims `passed: true` while carrying a criterion and the record clerk withdraws it with no failing ids. No `remediate:` agent is spawned; the next verify is a forced full one; when that is withdrawn too, `verdict.summary` leads with a FAIL naming the withdrawal and never reads `ok` (also with a `carried, not re-checked` line appended). A withdrawal that does leave failing ids still remediates exactly those.
- **Cheap:** `node --test tests/verify_loop.test.mjs`
- **Files:** `workflows/execute-phase.mjs`
- **Fails if:** an executor is spawned with an empty unmet list, the loop logs a `0 criterion/criteria still failing — continuing` cycle, or the summary of a non-PASS round reads `ok`.

### C13 [core] — Both tiers of the verify contract (Workflow and Agent-tool fallback) give the same order, and which suite is slow comes from an `ac` command, not the verifier's judgement
- **Observe:** read `agents/astro-verifier.md`, `commands/astro-verify.md` and `commands/astro-execute.md` (and any verify workflow under `workflows/`): a verifier or orchestrator following the text in either tier observes every non-suite criterion first, runs a slow suite only after all of them pass and only through `ac suite run`, and otherwise reports the suite as held back / not run. The slow-or-fast decision it acts on is printed by an `ac` command (drive it in the fixture: the command's output for a 900 s timing says held back, for a 30 s timing says run), never left to the verifier to estimate. The verifier stays plan-blind (no instruction to read PLAN.md).
- **Files:** `agents/astro-verifier.md` `commands/astro-verify.md` `commands/astro-execute.md` `workflows/` `bin/ac.mjs`
- **Fails if:** one tier keeps the old order, the verifier is told to decide "slow" itself, a held-back suite may be reported failed or passed, or the slow suite may be run outside `ac suite run` (no timing recorded).

### C14 [suite] [core] — The project's test suite passes on the verified commit
- **Observe:** `node scripts/test.mjs` exits 0 on a clean tree at the commit being verified (a reusable `ac suite run` receipt for that exact command and tree counts).
- **Fails if:** any test fails, or the run is on a dirty tree or a different commit.
