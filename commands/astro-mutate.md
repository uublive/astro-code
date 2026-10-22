---
description: Run the project's mutation tool on a phase's changed files (test-strength evidence), check for the tool, set up its config, or dismiss the install hint
argument-hint: <phase number> | check | setup | dismiss
allowed-tools: Bash
---

Deterministic mutation testing for phase `$ARGUMENTS` (ADR-083). `ac mutate` does the
mechanical work — detect the tool, scope to the phase's stamped commits, run under a time cap,
parse the report. You only relay what it prints.

Route by the argument:

- a phase number → `ac mutate <phase>`
- `check` → `ac mutate --check`
- `setup` → `ac mutate setup`
- `dismiss` → `ac mutate dismiss`

Reporting bounds:

- For a run, relay the counts line plus **one line per survivor, at most 10**, then one line
  pointing at `ac mutate <phase> --json` for the rest. A capped run adds its one capped line.
- When the tool is missing, relay `ac`'s output **verbatim** — the full suggestion or the one-line
  reminder, exactly as `ac` chose. Say nothing beyond that.
- For `check`, `setup` and `dismiss`, relay `ac`'s output as printed. Say nothing else.

**Never run an install command yourself** — not `npm`, `pip`, `go install`, nothing. A missing
tool is suggested to the user, never installed. `setup` writes only the tool's own config file
and only when it is absent; it never edits a dependency list.
