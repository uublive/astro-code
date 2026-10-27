# Acceptance: phase 52, targeted verify and suite receipts

Each item names the state the project must already hold before it can be checked. Most of astro-code's own criteria
name commands rather than files, so they are always re-checked. Check the items in a scratch project instead, either
created with `ac init` or the end-to-end fixture of `tests/verdict_targeted_e2e.test.mjs`. Do not check them in this
repo.

**Shared precondition, called "a targetable phase" below:**
- A git project with astro-code initialised and one phase whose CRITERIA.md has about 8 criteria.
- Most criteria name a distinct file in backticks on their Observe line, for example `` `src/a.mjs` ``.
- One criterion is tagged `[suite]`, with the project's suite command as its evidence.
- One criterion is tagged `[mutation]`.
- The phase's source files arrive in stamped `(phase NN tK)` commits.
- The tree is clean.

- [ ] **The user can see a verify after a full PASS target only what the change can affect, and be told so.**
  *Precondition:*
  - a targetable phase with a recorded full PASS (`VERDICT.json` with `mode: "full"` and every criterion passed);
  - one later commit that touches only `src/b.mjs`, which one criterion names.

  *Check:* `ac verdict plan <n>` prints one `• targeted: …` line. The line names how many criteria are affected out of
  the total, the full PASS's short sha, and the ids to re-check: the criterion naming `src/b.mjs`, plus the suite
  criterion. Running it twice prints the same thing. `/astro-verify <n>` reports the targeted mode in its result line.

- [ ] **The user gets a full verify, with a reason that says why, whenever targeting would be unsafe.**
  *Precondition:* the targetable phase in each of these states:
  - (a) no VERDICT.json;
  - (b) a full PASS plus a commit touching most criteria's files;
  - (c) a full PASS plus a one-file commit, with `--full` passed.

  *Check:* `ac verdict plan <n>` (with `--full` in case c) prints `• full: <reason>`, and each case gives a different
  reason. `ac verdict plan <n> --fulll` fails with "unknown flag".

- [ ] **The user can let a valid targeted PASS mark the phase verified, and see which criteria were carried.**
  *Precondition:* the targetable phase in the state of the first item, after `/astro-verify <n>` returned a targeted
  PASS. Alternatively, a targeted verdict recorded with `ac verdict record` that observes the floor and carries the
  rest.

  *Check:*
  - `ac phase show <n>` reports status `verified` and lists each carried criterion with the run and commit of the
    full PASS.
  - `/astro-accept <n>` tells the user in one line which criteria were carried, not re-observed, before it walks the
    checklist.
  - After a full PASS, neither `ac phase show <n>` nor `/astro-accept <n>` mentions carried criteria.

- [ ] **The user cannot reach `verified` by skipping a criterion the change touched.**
  *Precondition:* the targetable phase in the state of the first item.

  *Check:* `ac verdict record <n>` with a targeted result that leaves out the criterion naming `src/b.mjs` prints a
  `⚠ <id> refused: in the floor …` line naming that criterion. Then `ac phase verify <n>` refuses, and the phase stays
  unverified.

- [ ] **The user (or the verifier) can reuse a passing suite run on the identical clean tree, and only there.**
  *Precondition:* the targetable phase with a clean tree and a working suite command, for example `npm test`.

  *Check:*
  - `ac suite run --command "npm test"` runs the suite and prints a reusable receipt line.
  - `ac suite receipt --command "npm test"` then says it is reusable.
  - After either editing a tracked file or adding an untracked one, the same query says `• no reusable receipt:`
    with the reason.
  - After a new commit, it says the same.
  - With `--command "npm run test"`, it says the same.
  - Nothing under `.astrocode/.local/` shows up in `git status`.

- [ ] **The user can read the new rule in the project canon and the manual.**
  *Precondition:* this repo after the phase's commits.

  *Check:*
  - `.astrocode/DECISIONS.in-force.md` holds a new decision saying that a targeted PASS may mark a phase verified
    under the carry conditions, and that it amends ADR-079.
  - ADR-079 is still listed in force.
  - MANUAL's "Two gates close a phase" section describes targeted verify, `--full`, the stated mode and suite
    receipts consistently with that decision.
