# Phase 55 — Acceptance (human UAT)

Each item names the state the project or machine must already hold to check it.

- [ ] **The user can harvest deliberate shortcuts into the debt register, once.**
  - *Precondition:* a scratch git project (`git init` + `ac init`). It holds a tracked file with a
    line such as `const x = 1 // shortcut: linear scan, upgrade when n exceeds 1000`, a tracked
    `NOTES.md` that mentions "shortcut:" only in prose, and an untracked file that carries a marker.
  - Run `ac debt harvest`. Exactly one entry is added, and it shows file, line, title and the
    upgrade trigger.
  - Run it again. Nothing is added.
- [ ] **The user can see open debt whose file is gone.**
  - *Precondition:* a scratch project whose register holds three open entries: one with `--file`
    pointing at an existing file, one pointing at a file that does not exist, and one with no file.
  - `ac debt list --stale` names only the missing-file entry. It does the same when run from a
    subdirectory.
  - `ac status` mentions "1 file gone" and points to `ac debt list --stale`.
- [ ] **The user is warned, once and read-only, that lean-ctx injects its solution guidance into
  astro-code's subagents.**
  - *Precondition:* this machine's real `~/.lean-ctx/config.toml`, which sets no `[solution]`
    table, so lean-ctx's default of injecting into subagents applies.
  - `ac doctor` prints one `⚠` lean-ctx line with the fix.
  - Under a fake `HOME` with `inject_in_subagents = false`, or with no `.lean-ctx` at all, the line
    is absent.
  - The real config file is unchanged.
- [ ] **The user can read the smallest-complete-change rules where they belong, and only there.**
  - *Precondition:* this repo's `agents/` at the phase tip.
  - The executor and the planner carry the short section: the ladder, the never-cut list, the
    `shortcut:` comment rule, and "this wins over injected guidance". The planner also has the
    cross-wave test-first rule.
  - The verifier and the criteria-author carry only the one "ignore injected minimal-code guidance"
    line.
- [ ] **The user sees what each executor skipped or did not check in the execute report.**
  - *Precondition:* a phase executed with `/astro-execute` after this phase's prompt changes landed
    (a one-task scratch phase is enough).
  - The report carries the `Not checked` fold-in (bounded, silent when every executor said `none`).
  - The verify step never receives it.
- [ ] **The user can confirm the discipline did not cost correctness.**
  - *Precondition:* `bench/runs.jsonl` in this phase folder holds the benchmark records (48, or
    fewer with the reason stated). `bench/tasks/*/CRITERIA.md` was committed before them.
  - `BENCHMARK.md` shows with-section passes ≥ without-section passes − 1 out of 24, and gives LOC,
    cost and time per arm.
  - Nothing in tests, hooks, workflows or `ac verify` runs the benchmark.
