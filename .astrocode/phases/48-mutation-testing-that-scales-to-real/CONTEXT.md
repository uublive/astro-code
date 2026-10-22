<!-- astro-discuss: captured by agent: claude -->
# Phase 48 — Mutation testing that scales to real projects

## Why
First real use of phase 47 (Waupaca, phase 26, mutmut 3.8): `ac mutate 26` hit its 10-minute
cap having tested 0 of 15,022 mutants and reported only "incomplete", with no reason. One shared
file the phase edited lightly produced 5,704 mutants; mutmut's initial full-suite run (6,000
tests, 13 min) alone outlasted the cap. The log went to a temp folder, `ac mutate setup` wrote
deprecated mutmut keys, the install hint (`pip install mutmut`) failed in a uv-managed `.venv`,
the JSON was 2.6 MB with every mutmut 3 mutant at line 0, and the verifier still hand-invented
mutants because phase 26's criteria predate the `[mutation]` tag. Points 1–4, 7 and 8 hit
Stryker and Gremlins as well (shared `ac mutate` code or the same tool behaviour).

## Goal
On a project the size of Waupaca, `ac mutate <phase>` mutates only what the phase changed,
against the tests that matter, finishes (or says exactly why it stopped), and gives a result a
human and the verifier can read — for Stryker, Gremlins and mutmut alike. Phase 26 should come
down to roughly 3,000 mutants against fast tests instead of 15,000 against the full suite.

## Decisions (Matteo, in this session)

D1 — **Scope = the lines the phase changed.** From the phase's own stamped commits (task and
remediate stamps, as today), take the changed line ranges, not whole files:
- Stryker: `--mutate <file>:<start>-<end>` line ranges.
- Gremlins: its native diff mode (`--diff`) against the phase's base, instead of excluding
  every other file.
- mutmut: it cannot target lines, so the changed **functions** (mutant-name globs for the
  functions whose bodies hold changed lines; mutmut 2 via the closest supported mechanism).
- A project setting can still add or skip files (e.g. `mutation.files` / `mutation.exclude`);
  the result says which scope applied and why. Results are filtered back to the scope as today.

D2 — **Tests = the phase's own tests, with an override.** By default the test files the
phase's commits added or changed; a project or phase setting (e.g. `mutation.tests`) names
others. When the phase touched no test files, say so and fall back to the full suite. Passed
natively to each tool (Stryker test-file/runner options, `go test` package/run filters through
Gremlins, mutmut 3 test selection / pytest args). The result names the tests used.

D3 — **The verifier uses the tool whenever it would hand-make mutants; the tag stays the
gate.** When a mutation tool is installed, the verifier never invents broken versions by hand:
for any criterion where it would, it runs `ac mutate` and triages survivors. Only
`[mutation]`-tagged criteria get the hard pass bar in code (`ac verdict record`), unchanged
from phase 47 / ADR-083 (2a). Untagged use is evidence in the verdict, not a code gate.

D4 — **Cap: settable per phase, and always says why.** Keep 600 s default
(`mutation.cap_seconds`); a phase can raise it (phase-level setting beside the project one).
When the cap hits, the result names the step it was in (e.g. "cap reached during the initial
test run, 0 mutants tested") and the key to raise. No up-front sizing guess. (Principle b940.)

D5 — **Output: summary + full list in a local file.** Survivors stay listed in full (the
verifier must triage each). Killed / timeout / not-run mutants become per-file counts in the
human and JSON output. The complete mutant list is written to a local file whose path the
result gives. mutmut 3 mutants are mapped to their real line (not 0).

D6 — **Install hint matches the project.** Detect the environment from the project itself:
a `.venv` without pip → the `uv pip install --python .venv/bin/python mutmut` form; `pnpm-lock`
→ `pnpm add -D`, `yarn.lock` → `yarn add -D`, else npm; Go unchanged. Warn when the
environment pins versions so an install may change nothing. Still never installs (ADR-083).

D7 — **Log kept locally beside the run.** The tool log goes to `.astrocode/.local/` next to
the kept run for that phase (never committed); the result gives its path; the next run of the
same phase replaces it.

## Also in scope
- `ac mutate setup` writes current mutmut settings (`source_paths`,
  `pytest_add_cli_args_test_selection`, …) for mutmut 3.x, and still valid ones for 2.x.
- Debt folded in (`2026-10-22-ac-mutate-reads-an-installed-mutmut-3`): an installed mutmut 3
  whose `--version` crashes because it cannot find the source folder is reported as
  "installed but not configured" with `ac mutate setup`, never as "not installed".
- Docs (MANUAL, CHANGELOG), tests per CONVENTIONS with stub tools and fixture reports; check
  flags/report shapes against the real tools (Stryker 10, Gremlins 0.6, mutmut 2.4/3.8).

## Out
- Changing the `[mutation]` gate rules or ADR-083's evidence binding.
- Installing tools; mutation testing astro-code itself.
- New languages.

## Open / for the planner
- How Gremlins `--diff` and Stryker line ranges behave on renamed or newly added files.
- How a phase-level cap / tests override is stored (phase config vs CRITERIA-adjacent file);
  must not need hand-editing roadmap.json.
- Which mutmut 2 mechanism narrows to functions, if any; otherwise file-level for 2.x, stated.
