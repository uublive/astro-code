# Acceptance — phase 49: survivor triage support

Each item names the state the project must already hold before you check it.

- [ ] **The user can see survivors grouped by function and kind, with text-only changes in one
  group of their own.**
  - *Precondition:*
    - a test project (Go with Gremlins, or Python with mutmut 3) with a registered phase;
    - the phase's stamped commits leave survivors in at least two functions, of two kinds,
      including at least two survivors that change only a string or message literal (Python);
    - no `SURVIVORS.json` yet.
  - *Check:*
    - `ac mutate <n>` prints group headers, not a flat list;
    - `ac mutate <n> --json` has `groups[]` whose counts add up to the survivor total.

- [ ] **The user can judge a whole text-only group with one note, and nothing gets judged on its
  own.**
  - *Precondition:* the project above, after one full `ac mutate <n>`, with no judgements
    recorded.
  - *Check:*
    1. Before judging, no survivor shows as judged.
    2. Run `ac mutate judge <n> g:text-only --equivalent "<one line>"`.
    3. Every text-only survivor is now judged and the logic survivors stay open.
    4. `--equivalent ""` is refused.

- [ ] **The user can commit their judgements and see them carry over, in a teammate's clone too,
  until the mutated line changes.**
  - *Precondition:* the project above, with one `equivalent` and one `test-gap` judgement
    recorded in `.astrocode/phases/<slug>/SURVIVORS.json`.
  - *Check:*
    1. `git status` shows the file.
    2. After committing and `git clone`, `ac mutate <n>` in the clone shows both judgements and
       separates judged survivors from open ones.
    3. Inserting lines above the function keeps the judgement.
    4. Editing the judged line re-opens only that survivor.

- [ ] **The user can re-test only the open survivors in a fix round, and that re-test never
  counts as the verdict.**
  - *Precondition:*
    - the project above, after a full run, with survivors that are judged `equivalent`,
      `test-gap` and untriaged;
    - then a test added that kills the `test-gap` survivor.
  - *Check:*
    1. `ac mutate <n> --survivors` re-runs only the `test-gap` and untriaged mutants (see the
       tool's log), labels itself a partial re-run on top of the last full run, and for Gremlins
       says how it narrowed.
    2. `ac verdict record` with that output as evidence is refused.
    3. After a fresh full `ac mutate <n>`, the same verdict is accepted.

- [ ] **The user can see a flaky test named before mutation, inside the same time cap.**
  - *Precondition:* the project above, with one phase test that fails on every other run on
    unchanged code (it toggles a file).
  - *Check:*
    1. `ac mutate <n>` names that test as flaky and says whether its kills were excluded,
       discounted or left unverified.
    2. With a cap smaller than two test runs, the result is capped "during flaky check (tests
       run twice)" within roughly the cap.
    3. With the flaky test removed, nothing is reported flaky.

- [ ] **The user can rely on the tool's result as the bar for an untagged criterion once the
  verifier marks it, and the mark cannot be dropped later.**
  - *Precondition:*
    - a phase whose `CRITERIA.md` has an untagged test-strength criterion (no `[mutation]`);
    - a full `ac mutate <n>` run with one open survivor;
    - no `VERDICT.json` yet.
  - *Check:*
    1. `ac verdict record` passing it with `test_strength: true` is refused while the survivor
       is open, and accepted once it is judged.
    2. A later verdict that passes it without the mark, while a survivor is open, is still
       refused, including in a fresh clone.

- [ ] **The user sees the real Gremlins version, and an honest `/astro-verify` fallback line.**
  - *Precondition:*
    - this container's go-installed Gremlins, whose `--version` prints `dev`;
    - a phase whose source is excluded with `mutation.exclude`.
  - *Check:*
    1. `ac mutate <n> --json` on a Go phase shows `tool.version` equal to the module version
       from `go version -m "$(command -v gremlins)"`.
    2. For the excluded phase, `fallback.report` says no mutants were run, not that AI mutants
       stood in.
