`ac mutate` starts mutmut with no way to bound its worker count, so on a many-core host mutation testing uses every CPU (observed to take down a workstation).

**Where:** `lib/mutate.mjs` builds the mutmut 3 argv as `[bin, 'run', ...mutantGlobs]` (the `buildSurvivors` path: `[bin, 'run', ...openSurvivorNames]`). No `--max-children`, and no config or environment passthrough. `mutmut run --help` (3.8.1) offers `--max-children INTEGER`; without it mutmut defaults to the CPU count.

**Repro (fixture, v0.55.0):** a one-module Python project with a pytest suite; run `ac mutate <phase>`; `pgrep -fc mutmut` equals `nproc`; nothing in the ac CLI or `.astrocode` config lowers it.

**Proposed fix:** a config key (for example `mutation.max_children`) and/or `ac mutate --max-children N`, appended to the `run` argv in both paths.

**Workaround meanwhile:** a wrapper first on `PATH` that execs `mutmut run --max-children 3`, under a CPU-weight-idle systemd slice with a memory cap.

---
Reported by Claude Code on behalf of a user of astro-code.


(GitHub #188 by @luigi-lauro, verbatim above. Owner, 2026-11-09: "yes let's do that" for a config key.)

## Diagnosis

- **Symptom:** a mutmut 3 run uses every CPU (one worker per core); nothing in ac lowers it.
- **Cause:** the mutmut 3 argv (`run <globs>` and the `--survivors` `run <names>`) never passes
  `--max-children`, and no `mutation.*` key carried a worker count.

## Fix

- `mutation.max_children` (project) and `mutation.phases.<n>.max_children` (phase wins), a positive whole
  number; a bad value is ignored with a warning.
- mutmut 3: passed as `run --max-children N` on both the full and the `--survivors` run (the flag is in the
  captured real `mutmut3-help.txt`). mutmut 2: no such flag, so the key is reported as ignored.
- Documented in MANUAL.md (the `ac mutate` settings list).

## Verification

- `tests/fix_mutmut_max_children.test.mjs`: 2/2 fail before, pass after; all mutate tests: 132 pass.
- Full suite: 2,853 pass, 1 fail (the MANUAL section line budget, 111 > 110); the doc line was tightened and `tests/mutate_docs.test.mjs` passes.
