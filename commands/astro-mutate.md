---
description: Run the project's mutation tool on the lines a phase changed (test-strength evidence), re-test only the open survivors, record survivor judgements, check for the tool, set up its config, or dismiss the install hint
argument-hint: <phase number> [--survivors] | judge <phase> <ids> | check | setup | dismiss
allowed-tools: Bash
---

Deterministic mutation testing for phase `$ARGUMENTS` (ADR-083). `ac mutate` does the
mechanical work — detect the tool, scope to the lines the phase's stamped commits changed, run the
phase's own tests under a time cap, parse the report. You only relay what it prints.

Route by the argument:

- a phase number → `ac mutate <phase>`
- a phase number and `--survivors` → `ac mutate <phase> --survivors` (a partial re-test of the open
  survivors; never a recordable verdict — finish with a full `ac mutate <phase>`)
- `judge <phase> <s:key|g:group>... --equivalent "<one line why>"` or `--test-gap ["<note>"]` →
  `ac mutate judge …` (writes the phase's `SURVIVORS.json`; `ac verdict record` commits it)
- `check` → `ac mutate --check`
- `setup` → `ac mutate setup`
- `dismiss` → `ac mutate dismiss`

Reporting bounds:

- For a run, relay the counts line, the scope and tests lines, the flaky-check line, the survivors
  summary and **at most 20 open groups, 3 members each** (`ac` prints them that way; the rest is
  `--json`), then the full-list and log paths `ac` prints last (one line each). A `--survivors` run
  leads with its partial line, relayed first. A capped run adds its one capped line, which names the
  step and the key to raise.
- To change the cap or the tests for one phase, name the command:
  `ac config set mutation.phases.<n>.cap_seconds <s>` or `ac config set mutation.phases.<n>.tests '["tests/a.test.mjs"]'`
  (project-wide: `mutation.cap_seconds`, `mutation.tests`).
- When the tool is missing, relay `ac`'s output **verbatim** — the full suggestion or the one-line
  reminder, exactly as `ac` chose. Say nothing beyond that.
- For `check`, `setup`, `dismiss` and `judge`, relay `ac`'s output as printed. Say nothing else.

**Never run an install command yourself** — not `npm`, `pip`, `go install`, nothing. A missing
tool is suggested to the user, never installed. `setup` writes only the tool's own config file
and only when it is absent; it never edits a dependency list.
