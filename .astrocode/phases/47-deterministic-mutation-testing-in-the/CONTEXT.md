<!-- astro-discuss: captured by agent: claude -->
# Phase 47 — Deterministic mutation testing in the verifier

## Why
On a real project (Waupaca, phase 23 C11) the astro-verifier spent hours hand-inventing
"broken versions" (mutants) to test a criterion's test strength. Every fresh round found new
survivors and there was no natural end. A mutation tool produces a closed, reproducible
mutant list; the AI should only judge the survivors.

## Goal
When a criterion asks for test-strength evidence, verification runs the project's mutation
tool on the phase's changed files under a time cap, gets a fixed killed / survived / timeout
list, and the verifier triages only the survivors. The result is recorded in the verdict as
reproducible evidence. With no tool, verification falls back to today's AI-invented mutants
and says why.

## Decisions (answered by Matteo, Telegram #1784)

D1 — **A deterministic `ac mutate <phase>` command runs the tool** (answer 1a), not the
verifier agent by hand. It:
- detects the tool for the project's language (manifests, as `lib/stack.mjs` does; an explicit
  config override wins, and the output says which tool was picked and why);
- scopes to the files the phase changed (the phase's commits / diff), using the tool's
  incremental or diff mode where it has one;
- runs under a time cap and parses the tool's report into a fixed JSON result: every mutant
  with file, line, mutator, status `killed | survived | timeout | no-coverage | error`;
- prints the same result for humans and `--json` for the verifier.
Zero runtime deps (ADR-001): the tool is the project's own, invoked through `child_process`.

D2 — **It runs only for criteria that ask for test strength** (answer 2a), never on every
verify. The criteria author can write a criterion whose bar is "all mutants killed or every
survivor justified" (a recognisable marker the verifier and `ac mutate` key off). Phases
without such a criterion pay nothing.

D3 — **A missing tool is suggested, never installed, and never nags** (answer 3a, plus
Matteo's own addition: "it must not ask every time, be annoying and repetitive"):
- `ac mutate --check` and the first verify that needs the tool print the exact install
  command for the ecosystem: `npm i -D @stryker-mutator/core` (JS/TS),
  `go install github.com/go-gremlins/gremlins/cmd/gremlins@latest` (Go), `pip install mutmut`
  (Python).
- Show the full suggestion **once per project per tool**. Remember that it was shown, or that
  the user dismissed it, and do not repeat it on later verifies. After that, at most a
  one-line reminder in the verdict ("mutation tool not installed — AI mutants used").
- Setting up a config is a separate, explicit `ac mutate setup` that writes a minimal config
  for the detected tool. It is never run implicitly.
- No interactive prompt during verify: unattended runs must never stall (principle 5116).
  The AI-mutant fallback runs instead (principle b940: fail soft, with a visible reason).

D4 — **Pass bar and limits** (answer 4a):
- A survivor that is a real test gap **fails the criterion**, so the verify→remediate loop
  writes or requires the missing test.
- An equivalent mutant (no test could tell it apart) passes with a **one-line justification**
  recorded in the verdict. No human sign-off on each justification; they are visible at accept.
- Timeouts count as killed (the tool detected the change).
- Default time cap **10 minutes**, configurable in config. When the cap is hit, the result
  says so and lists the mutants not run; a capped run never counts as "all killed".
- Tools on day one: **Stryker (JS/TS), Gremlins (Go), mutmut (Python)**, kept in one table so
  more (cargo-mutants, PIT) can be added later as rows, not code paths.

## Scope
In:
- `ac mutate <phase>` (`--check`, `--json`, `setup`), its tool table, scoping, cap, parser.
- Verdict records the mutation evidence (tool, version, command, counts, survivors with
  triage) so it can be reproduced; `ac verdict record` accepts it.
- Verifier agent instructions: use `ac mutate` for test-strength criteria, triage survivors
  only, fall back to AI mutants with the reason stated.
- Criteria author guidance for writing a test-strength criterion.
- Docs (MANUAL, CHANGELOG).
- Tests per CONVENTIONS (real fs, `node:test`); tools faked by fixture reports or stub
  binaries on PATH — the suite must not need Stryker/Gremlins/mutmut installed.

Out:
- Installing tools, editing a project's dependency manifest.
- Mutation testing astro-code's own suite (zero dev deps; Stryker has no `node:test` runner).
- Running mutation on every verify; whole-repo mutation.
- Languages beyond the three above.

## Open / for the planner
- Where the "suggestion shown/dismissed" memory lives (per project, per tool). It must
  survive across verifies; decide whether it is a committed project file or a local one,
  and say why.
- How tools that lack a diff mode are scoped (pass the changed file list explicitly).
- Exact report formats to parse: Stryker JSON report, Gremlins JSON output, mutmut results.
