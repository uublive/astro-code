# Acceptance — phase 48: mutation testing that scales to real projects

Each item names the state the project must already hold for it to be checkable (ADR-050).

- [ ] **The user can run `ac mutate <n>` and see it mutate only the lines (or, for mutmut, the
  functions) that phase changed.** The result says which scope applied and why.
  - *Precondition:* the project is initialised with astro-code and its mutation tool is installed
    (Stryker, Gremlins or mutmut 3). Phase `<n>`'s work landed as `(phase NN tK)` commits that
    lightly edited one large file, and other commits before and after the phase touched other
    lines.
  - *Example:* Waupaca phase 26 with mutmut 3.8 shows a few thousand mutants, not ~15,000.
- [ ] **The user can see which tests the run used.** By default they are the phase's own test
  files, and the result says so. `ac config set mutation.tests '["<file>"]'` (project) or
  `ac config set mutation.phases.<n>.tests '[…]'` (one phase) makes it run those instead.
  - *Precondition:* the same project. The phase's commits changed at least one test file, and
    untouched test files also exist.
- [ ] **The user can set a low cap and, when it hits, read which step it stopped in, how many
  mutants were tested, and the exact command to raise it.** After raising the cap for that phase
  only with `ac config set mutation.phases.<n>.cap_seconds <s>`, the run finishes, while other
  phases keep the project cap.
  - *Precondition:* the same project, where the tool's initial test run takes longer than the low
    cap. No `roadmap.json`/`state.json` edits are needed.
- [ ] **The user can open the tool's log and the full mutant list from the paths the result
  prints.** Both are under `.astrocode/.local/mutate-runs/`. Neither shows in `git status`. A
  rerun of the same phase replaces them.
  - *Precondition:* the same project, with one completed `ac mutate <n>` run.
- [ ] **The user can read a short result.** It lists every survivor at its real line (mutmut 3
  included: never line 0) and the killed, timeout and not-run mutants as per-file counts. The
  `--json` output stays small.
  - *Precondition:* the same project. The phase's run produces thousands of mutants and at least
    one survivor.
- [ ] **In a uv-managed Python project, the user gets an install hint that works there** (`uv pip
  install --python .venv/bin/python mutmut`, plus a pin warning when `uv.lock` manages the
  env). An installed but unconfigured mutmut 3 is reported as "installed but not configured",
  not as missing. After `ac mutate setup`, mutmut starts without config errors or deprecated-key
  warnings.
  - *Precondition:* a Python project with a `.venv` that has no pip and a `uv.lock`, first without
    mutmut. Then with mutmut 3 installed and no `[mutmut]` config and no `src/` or package dir it
    can guess.
- [ ] **The user can run `/astro-verify` on a phase whose criteria carry no `[mutation]` tag, with
  a tool installed, and see the verdict cite `ac mutate` survivors instead of hand-made mutants.**
  A tagged criterion is still refused without valid tool evidence.
  - *Precondition:* a project with a mutation tool installed, and an executed phase whose
    CRITERIA.md has a test-strength-style criterion without the tag.
