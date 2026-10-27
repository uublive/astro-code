# Acceptance — phase 51: verifier calibration (`ac verify calibrate`)

Each item names the state the project must already hold before it can be checked. astro-code cannot calibrate
itself: its `node --test` suite has no supported mutation tool. Check in a mutation-enabled project (Astrobot or
Waupaca), or in a scratch fixture with a stub `claude`, never in this repo.

**Shared precondition, called "a calibration-ready project" below:**
- Mutation-enabled (mutmut or Stryker installed).
- At least two `complete` phases, each with a CRITERIA.md.
- On this machine, `ac mutate <n>` has been run AFTER this phase's upgrade on each of those phases, so the kept list
  `.astrocode/.local/mutate-runs/<slug>.mutants.jsonl` carries each mutant's exact change.
- Each of those phases has some killed mutants.
- At least one survivor has been judged `--test-gap` in that phase's committed SURVIVORS.json.

- [ ] **The user can see what a calibration would cost before anything runs, and nothing changes.**
  *Precondition:* a calibration-ready project with a clean `git status`.
  *Check:* `ac verify calibrate --defects 4 --runs 2` prints:
  - the estimated cost for 4 defects × 2 runs, with its basis;
  - the seed and the budget;
  - that `--yes` is needed.

  `git status` is still clean, `.astrocode/CALIBRATION.jsonl` is unchanged, and no `ac-v-*` folder is left in the temp
  dir. With `--runs 4` the estimate is higher.

- [ ] **The user can run one real calibration against the real verifier and get two separate false-PASS rates with
  intervals.**
  *Precondition:* a calibration-ready project, the `claude` CLI logged in, and `ac install` current.
  *Check:* `ac verify calibrate --defects 2 --runs 1 --yes` runs two real verifier trials. Its first line gives an
  easy rate and a hard rate, each with a 95% interval. Its per-defect lines name the phase, the tool and caught c/1.
  The spend is printed. Afterwards:
  - the working tree is clean;
  - one new commit holds only the appended `.astrocode/CALIBRATION.jsonl` line;
  - no phase changed status;
  - no VERDICT.json or SURVIVORS.json changed.

- [ ] **The user can repeat a run exactly with the same seed, and get different defects with another seed.**
  *Precondition:* a calibration-ready project with a pool of at least 20 usable defects. A scratch fixture with a stub
  `claude` is enough here.
  *Check:* two `--seed 7 --yes --json` runs list the same defects in the same order. A `--seed 8` run lists a
  different set.

- [ ] **The user can cap the spend and see an honest partial result.**
  *Precondition:* a calibration-ready project (or the stub fixture with a fixed cost per trial).
  *Check:* `ac verify calibrate --defects 4 --runs 3 --budget <less than the bill> --yes` stops before the bill is
  spent. It says it was stopped by the budget, reports completed trials versus planned, and rates only what ran. The
  log record says the same.

- [ ] **The user is told plainly when there are not enough defects, instead of getting padded or made-up numbers.**
  *Precondition:* (a) a project whose accepted phases offer only 2 killed mutants and 1 test-gap survivor; (b) one with
  no test-gap judgements at all; (c) a Go project whose only mutation data comes from Gremlins.
  *Check:*
  - (a) `--defects 10` reports 2 easy and 1 hard of the requested counts, each marked "too few defects to rely on";
  - (b) the hard rate is "unavailable", not 0%;
  - (c) the output says Gremlins is not supported.

- [ ] **The user can compare runs across a verifier change from the committed log.**
  *Precondition:* a calibration-ready project with one calibration record already in `.astrocode/CALIBRATION.jsonl`.
  *Check:*
  1. Edit the verifier's prompt (`agents/astro-verifier.md` in the astro-code install).
  2. Run `ac update`.
  3. Run again with the same seed.
  4. Check that the log holds both records, the first unchanged, with different prompt hashes and the same
     `defect_set_hash`, and that `git log` shows both commits.

- [ ] **The user can drive it from `/astro-calibrate`, which never spends without asking.**
  *Precondition:* a calibration-ready project in a Claude Code session with astro-code installed.
  *Check:* `/astro-calibrate --defects 2 --runs 1` shows the bill and asks. Answering no runs nothing. Answering yes
  runs it with the same seed and relays the short summary. No `/astro-verify`, `/astro-execute` or other loop command
  ever starts a calibration.
