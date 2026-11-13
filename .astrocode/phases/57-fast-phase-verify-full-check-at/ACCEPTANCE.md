# Acceptance: phase 57, fast phase verify, full check at milestone close

Check these in a scratch project (`ac init` in a fresh git repo under a temp dir), never against this repo's own
`.astrocode/` state.

**Shared precondition, called "the fast milestone" below:**
- an astro-code project with **no `verify` key** in `.astrocode/config.json`, and `verify.suite_command` set to a
  command that appends `SUITE:<sha>` to a log file OUTSIDE the repo and then runs `node --test`;
- `src/a.mjs`, `src/b.mjs`, `tests/a.test.mjs` (imports `../src/a.mjs`), `tests/b.test.mjs` (imports `../src/b.mjs`);
- one active milestone with three phases, each with a committed CRITERIA.md:
  - P1 with two criteria carrying `- **Cheap:**` commands that append `P1:<id>:$(git rev-parse HEAD)` to the log;
  - P2 with one such criterion;
  - P3 with none;
- P1's stamped commit `(phase NN t1)` changes `src/a.mjs`;
- P3's stamped commit changes only `README.md`;
- a clean tree.

## Fast phase verify

- [ ] **Precondition:** the fast milestone, P1 not yet verified. The user runs `ac verdict cheap <P1>` and reads
  `fast mode` with the targeted set `tests/a.test.mjs` and a limits line. The log gains P1's two Cheap lines and
  no `SUITE` line. `tests/b.test.mjs` does not run.
- [ ] **Precondition:** the fast milestone, P3 not yet verified. The user runs `ac verdict cheap <P3>`, reads
  `no linked tests`, and sees no test run. The user records a PASS with `ac verdict record`, and
  `ac phase verify <P3>` succeeds.
- [ ] **Precondition:** the fast milestone with `tests/a.test.mjs` made to fail and committed (stamped P1). After
  `ac verdict cheap <P1>`, the user records a PASS and sees it refused, naming `tests/a.test.mjs`.
  `ac phase verify <P1>` also refuses. After fixing, committing and re-running `ac verdict cheap`, the PASS is
  accepted with no full-suite run.
- [ ] **Precondition:** the fast milestone after `ac config set verify.full_suite phase`. The user sees
  `ac verdict cheap <P1>` run the suite (one `SUITE` line) exactly as before this phase. `ac status` shows no
  "full check pending" marker for phases verified in this mode.

## Marked, then fully checked

- [ ] **Precondition:** the fast milestone with P1 fast-verified. The user sees "full check pending" on P1 in
  `ac status`, `ac phase show <P1>`, the phase band, and the output of `ac phase accept <P1>`. The accept still
  succeeds.
- [ ] **Precondition:** the fast milestone with all three phases fast-verified, and P1 and P2 accepted. The user
  accepts P3 and reads one line proposing `ac milestone verify`. Accepting P1 or P2 earlier showed no such line.
- [ ] **Precondition:** the fast milestone with all phases accepted and no full check yet. `ac milestone complete`
  refuses and names `ac milestone verify`. The user runs `ac milestone verify` and sees one `SUITE:<tip>` line and
  P1's and P2's three Cheap lines, all at the tip, and a PASS report. `ac status` no longer shows the marker, and
  `ac milestone complete` now succeeds (try it on a copy). One extra commit before closing makes it refuse again.

## Failures become fixes, then repair

- [ ] **Precondition:** the fast milestone, all phases accepted, with P2's Cheap command made to fail and
  `tests/a.test.mjs` broken (the last stamped change to `src/a.mjs` is P1's). The user runs `ac milestone verify`
  and sees it fail. `ac fix list` shows one fix tied to P2 and one tied to P1. Running it again adds no
  duplicate. `ac milestone complete` refuses, naming the open fixes.
- [ ] **Precondition:** the state above. The user runs `/astro-verify-milestone` (or drives `ac milestone repair <id>`
  by hand). Each fix gets at most 2 attempts, each attempt re-runs that fix's failing check, and the run ends with
  a report listing what was fixed and what is still open, then a fresh full check.
- [ ] **Precondition:** the fast milestone with P1 fast-verified and accepted, no full check, and a local bare
  remote with gitflow on. `ac flow release` prints "Full check pending" naming P1. After a passing full check on the
  tip, it prints no such line.
