Matteo's go (relayed by Comet, 27/11): kit-test rule R-11 must accept a recipe phase output that is marked optional.

(Requested by the astro-port-6e session on the owner's behalf. Halo is adding optional outputs on recipe phases
(astro-halo-b8). An EnviroTech gaps-only run aborts because its answer phase requires _report/change_set.json, which
a gaps run never writes; R-11 fails if kit.json declares an artifact no phase produces, so the kit cannot drop it.)

## Diagnosis

- kit_test.py read `phase.output` as a list of strings only (`str(o)` for every entry), so a `{path, optional}` entry
  was a malformed path, and there was no way to declare an output a run may skip while R-11 still counts it.
- The builtin recipe parser (used without PyYAML) read only scalar list items and refused a mapping item.
- kit_run_local.py (Tier 2) failed a run for any missing declared output.

## Fix

- `phase_outputs()` normalises an entry: a string is required; `{path, optional}` (path a non-empty string,
  optional a boolean, default false, no other keys) may be optional. A malformed entry fails R-07.
- R-07: at least one REQUIRED output per phase. R-09 (paths stay in the workspace), R-10 (dataflow) and R-11
  (declared artifacts produced) read required and optional outputs alike.
- The builtin parser accepts block (`- path: x` / `optional: true`) and flow (`- {path: x, optional: true}`) mapping
  items, in `output` lists only, so a constraint containing a colon is never misread.
- Tier 2 reports a missing optional output as skipped (`–`), never as a failure.
- KIT-CONTRACT.md documents the form.

## Open

The syntax is the one proposed to Halo by astro-port-6e; Halo has not confirmed it yet. Merge and release wait for
that confirmation.

## Verification

- `tests/kit_test_optional_outputs.test.mjs`: 11 of 13 cases failed before (only the plain-string cases passed),
  all 13 pass after, on PyYAML and the builtin parser.
- All kit tests: 212 pass, 0 fail.
