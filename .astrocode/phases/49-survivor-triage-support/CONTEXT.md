<!-- astro-discuss: captured -->
# Phase 49 — Survivor triage support

## Why
After phase 48, `ac mutate` finishes on a big project and hands back a closed survivor list.
What is still missing (Matteo's list from the first Waupaca run, points 8, 9 and 11):
triaging hundreds of survivors one by one, judging the same survivors again every run, a
fix round that re-runs everything, flaky tests passing for strong ones, and untagged
test-strength criteria (Waupaca phase 26) still decided by the verifier alone — the loop that
never closed.

## Goal
A survivor list a person or the verifier can get through, and a verdict loop that ends:
survivors grouped, judgements kept across runs, fix rounds re-test only what is still open,
flaky kills caught, and the tool's result is the code-checked bar for every test-strength
criterion, tagged or not.

## Decisions (Matteo, in this session)

D1 — **The tool's result is the bar for every test-strength criterion, tagged or not**
(point 11; reverses phase 48's tag-only gate, amends ADR-084). Passing needs every survivor
killed or justified, checked in code by `ac verdict record`, as for `[mutation]` today.

D2 — **The verifier declares, code holds it.** When the verifier uses the tool's result for a
criterion, it marks that criterion test-strength in the verdict; from then on `ac verdict
record` applies the full bar (the same gate and kept-run binding as `[mutation]`). A later
verdict cannot drop the mark for that criterion (sticky, per phase, recorded in code). Old
criteria like Waupaca phase 26's need no edits. `[mutation]` tags keep working unchanged.

D3 — **Survivor judgements live in a committed file per phase.** A standard survivors file in
the phase folder (committed; teammates and reviewers see every justification). A judgement
(`equivalent` + one-line justification, or `test-gap`) carries over to the next run while
that exact mutant still exists; a changed line re-opens it. `ac mutate` output and the
verifier start from it, so only new or re-opened survivors need judging.

D4 — **Re-run only the open survivors.** `ac mutate <n> --survivors` re-tests just the mutants
still `test-gap` or untriaged (tool-native where the tool can select mutants: Stryker
incremental/mutant filters, mutmut by mutant name; Gremlins by narrowest available means, and
say so). Already-killed mutants are not re-run. A full run is still what a final verdict
records (the kept-run binding of ADR-083 is unchanged).

D5 — **Flaky kills: check the tests first.** Before mutating, run the phase's tests twice on
the unchanged code. A test that fails there is flaky: the result names it, and the kills it
made are re-checked (or not counted as kills when re-checking is not possible — say which).
Inside the existing cap (principle 8d73: one total budget); a cap hit during this step is
named like any other step.

D6 — **Grouping, with message text separate.** Survivors are grouped by function and mutation
kind in human and JSON output. Text-only changes (string/message literals: error strings,
log lines) form their own group; one justification can cover the whole group, but each
survivor in it must be covered (no auto-equivalent).

## Also in scope (debt folded in)
- `2026-10-22-gremlins-installed-via-go-install`: Gremlins built with `go install` reports
  `version dev`, so evidence records `tool.version: null`; read the module version from the
  binary (`go version -m`) when `--version` gives none.
- `2026-10-22-astro-verify-fallback-line-glosses`: `/astro-verify`'s report says "AI mutants
  stood in" even when the fallback reason says none were used (mutation.exclude, tool-installed
  no-scope); word it from the reason.
- Docs (MANUAL, CHANGELOG), verifier/criteria-author instructions, tests per CONVENTIONS with
  stub tools and fixture reports; check re-run flags against the real tools (Stryker 10,
  Gremlins 0.6, mutmut 2.4/3.8 are installed in this container).

## Out
- Changing how phase 48 scopes or selects tests.
- Installing tools; new languages.

## Open / for the planner
- The survivors file's name and shape, and how a judgement is matched to a mutant across runs
  (file + function + mutator + replacement/original text, not line number alone).
- How the sticky test-strength mark is stored so a later verdict cannot drop it, without
  hand-editing roadmap.json.
- How `--survivors` results combine with the last full run for display (never as the recorded
  verdict).
