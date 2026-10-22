---
description: Run the project's mutation tool on the lines a phase changed (test-strength evidence), check for the tool, set up its config, or dismiss the install hint
argument-hint: <phase number> | check | setup | dismiss
allowed-tools: Bash
---

Deterministic mutation testing for phase `$ARGUMENTS` (ADR-083). `ac mutate` does the
mechanical work — detect the tool, scope to the lines the phase's stamped commits changed, run the
phase's own tests under a time cap, parse the report. You only relay what it prints.

Route by the argument:

- a phase number → `ac mutate <phase>`
- `check` → `ac mutate --check`
- `setup` → `ac mutate setup`
- `dismiss` → `ac mutate dismiss`

Reporting bounds:

- For a run, relay the counts line, the scope and tests lines, **one line per survivor, at most
  10**, then the full-list and log paths `ac` prints last (one line each). A capped run adds its
  one capped line, which names the step and the key to raise.
- To change the cap or the tests for one phase, name the command:
  `ac config set mutation.phases.<n>.cap_seconds <s>` or `ac config set mutation.phases.<n>.tests '["tests/a.test.mjs"]'`
  (project-wide: `mutation.cap_seconds`, `mutation.tests`).
- When the tool is missing, relay `ac`'s output **verbatim** — the full suggestion or the one-line
  reminder, exactly as `ac` chose. Say nothing beyond that.
- For `check`, `setup` and `dismiss`, relay `ac`'s output as printed. Say nothing else.

**Never run an install command yourself** — not `npm`, `pip`, `go install`, nothing. A missing
tool is suggested to the user, never installed. `setup` writes only the tool's own config file
and only when it is absent; it never edits a dependency list.
