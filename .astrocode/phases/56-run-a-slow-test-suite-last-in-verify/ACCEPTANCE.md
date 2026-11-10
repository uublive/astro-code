# Acceptance: phase 56, run a slow test suite last in verify

Check these in a scratch project (`ac init` in a fresh git repo under a temp dir), never against this repo's own
`.astrocode/` state.

**Shared precondition, called "the slow-suite phase" below:**
- an astro-code project with one phase whose committed CRITERIA.md holds:
  - `### C1 [suite] — …` naming a suite command that appends a line to a marker file OUTSIDE the repo and exits 0;
  - C2 with a `- **Cheap:** \`node -e "process.exit(1)"\`` line;
  - C3 with a `- **Cheap:** \`node -e "process.exit(0)"\`` line;
- a clean tree;
- `.astrocode/.local/suite-receipts/` either empty or holding receipts written by `ac suite run --command "<C1's command>"` whose `seconds` you edited, as each item says. "Seeding S seconds" means: run `ac suite run --command "<C1's command>"`, edit `seconds` to S in the receipt it wrote, then commit something.

## Slow suite held back

- [ ] **Precondition:** the slow-suite phase with **no receipt** for C1's command. The user can run `ac verdict cheap <n>` and see C1 reported as held back (not run), C2 listed as unmet, and no new line in the marker file.
- [ ] **Precondition:** the slow-suite phase with **900 s seeded**. The user sees the same result: C1 held back and the marker unchanged. With **30 s seeded**, the user sees C1 run (the marker gains one line) and reported met.
- [ ] **Precondition:** the slow-suite phase with **900 s seeded**. The user can run `ac config set verify.slow_suite_minutes 30` and see `ac verdict cheap <n>` now run C1. After `ac config set verify.slow_suite_minutes abc`, the user sees a `⚠` warning and C1 held back again under the 10-minute default.
- [ ] **Precondition:** the slow-suite phase at a clean HEAD **after `ac suite run --command "<C1's command>"` exited 0, with its receipt's `seconds` set to 900 and no new commit**. The user sees `ac verdict cheap <n>` report C1 met from the receipt, without running it.
- [ ] **Precondition:** the slow-suite phase with **900 s seeded**. The user can run `ac suite receipt --command "<C1's command>"` and read a line saying the suite is slow and runs last. With **30 s seeded**, the same command says it runs in order.

## PASS still needs the suite

- [ ] **Precondition:** the slow-suite phase **after the cheap pass above recorded its FAIL**. The user records `{"mode":"full","criteria":[{"id":"C1","held":true,"suite":true},{"id":"C2","passed":false},{"id":"C3","passed":false}]}` with `ac verdict record <n> --result '…'`. In `ac verdict show <n>`, the user sees FAIL, unmet C2 and C3, and C1 held back: not failed, not deferrable, not flapping. `ac phase verify <n>` refuses.
- [ ] **Precondition:** the same phase. The user records C2 and C3 passed with C1 still held, and the result is not a PASS. After running `ac suite run --command "<C1's command>"` at the clean HEAD and recording C1 passed, the result is a PASS and `ac phase verify <n>` succeeds.
- [ ] **Precondition:** a phase run through `/astro-execute`, whose verify round fails a non-suite criterion while the suite is slow. In the human report, the user reads a summary that starts with `FAIL`, names every unmet criterion, and says `held back: slow suite (…), not run this round`. It never reads `ok`, and the remediation does not mention the suite.


## On accept

- [ ] **Precondition:** this phase verified. The user settles the folded-in debt `2026-10-15-after-a-withdrawn-carried-pass-the-loop`. It was fixed in phase 54 t1, and this phase's tests guard it.
