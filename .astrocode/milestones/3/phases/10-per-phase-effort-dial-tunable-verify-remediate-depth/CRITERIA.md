# Success Criteria — Phase 10: Per-phase effort dial (ADR-022)

> Pre-registered, plan-blind. Derived from the phase goal + CONTEXT.md + canon (ADR-022,
> ADR-021, ADR-006/REQ-006, CONVENTIONS §State). Each criterion is an observable outcome
> a *different but valid* implementation of the same goal must still satisfy.
>
> Shorthand: `AC = node /Users/buu/Development/astro-code/bin/ac.mjs` (the repo CLI).
> Where a criterion drives internal decision logic, the verifier may `import` the owning
> `lib/` helper OR extract-and-eval the relevant region of `workflows/execute-phase.mjs`
> exactly as `tests/workflows.test.mjs` already does (`runInNewContext`) — feed known
> inputs, observe the returned values. Do NOT grade the shape of the code; grade the
> input→output behavior.

### C1 — A phase carries a per-phase effort level that is set, durably stored, defaulted to `standard`, backward-compatible, and validated
- **Observe:** In a throwaway project: `D=$(mktemp -d); cd "$D"; git init -q; AC init; AC phase add "x"`. (1) `AC phase effort 1 deep` then inspect `.astrocode/roadmap.json` — the phase entry now carries the level `deep`. (2) Round-trip `light`, `standard`, `deep` — each is stored and read back. (3) A phase that was **never** given a level resolves as `standard` (no field, or explicit — either way the effective level is `standard`). (4) Hand-write a roadmap.json whose phase entry has **no** effort field, then load it (`AC roadmap list` / status) — it works and treats that phase as `standard`, no crash. (5) `AC phase effort 1 sideways` (a bogus level) exits non-zero and does not write the bad value.
- **Fails if:** the level is not persisted or not read back; an entry without the field crashes loading or is treated as anything other than `standard`; the default is sourced from config rather than a hardcoded `standard`; an invalid level is accepted/stored.

### C2 — Setting effort mutates only that phase’s level and never clobbers the rest of the roadmap
- **Observe:** In the throwaway project add two phases and set fields (e.g. mark one status). Snapshot `.astrocode/roadmap.json`, run `AC phase effort 2 deep`, diff the before/after JSON: the ONLY change is phase 2’s effort level. All other phases, their numbers/slugs/statuses, and the milestone are byte-for-byte preserved. Run two `AC phase effort` calls concurrently on different phases (`&` then `wait`); the resulting roadmap.json is valid JSON and both writes survived.
- **Fails if:** the write drops or reorders other phases, resets a status/field, corrupts the JSON, or a concurrent pair of updates loses one write (a non-atomic / non-lock-guarded hand-write).

### C3 — Effort level resolves to the remediation-cycle budget light=0 / standard=1 / deep=3
- **Observe:** Locate the logic the execute-phase loop consults to turn an effort level into a maximum number of verify→remediate cycles (import the lib helper, or extract-and-eval from the workflow as the existing tests do). Feed `light`, `standard`, `deep`; the returned max cycle counts are exactly `0`, `1`, `3`. Feed an absent/unknown level → it falls back to the `standard` budget (`1`).
- **Fails if:** any level maps to a different count (e.g. light≠0 so light auto-remediates; deep≠3); an unknown level does not fall back to `standard`; the budget is not bounded (an unbounded loop).

### C4 — `deep` escalates execute+verify to the opus tier for that phase only, without persisting; light/standard pass the configured tier through
- **Observe:** Set a base preset where the executor tier is NOT opus (e.g. `AC models fast` → executor `sonnet`, verifier `opus`). Drive the effort→model-tier resolution: for `deep`, BOTH the executor and verifier tiers used for that phase are `opus`; for `standard` and `light`, the executor tier is the base (`sonnet`). Then re-read `.astrocode/config.json` `models` — it is unchanged (the deep escalation was in-memory for that run only).
- **Fails if:** `deep` does not force executor+verifier to opus; `standard`/`light` get silently upgraded; the opus escalation mutates persisted config.

### C5 — The `--effort` one-off override wins for a single run and never rewrites the stored per-phase level
- **Observe:** Store `AC phase effort 1 standard`. Drive the effective-effort selection with (stored=`standard`, override=`deep`) → resolves to `deep`; with no override → resolves to the stored `standard` (precedence: flag > stored > hardcoded default). After exercising the override path, `.astrocode/roadmap.json` still shows the phase’s stored effort as `standard` (the override is a run-scoped arg, not a mutation).
- **Fails if:** the override is ignored (stored value wins); the override path writes the level back into roadmap.json; no override surface exists.

### C6 — Anti-thrash: a remediation cycle with no progress bails to a human-facing FAIL even with budget remaining
- **Observe:** Drive the loop’s progress decision with synthetic cycle outcomes: (a) HEAD SHA identical before/after the remediation pass → STOP/bail; (b) HEAD moved but the set of failing-criterion ids is unchanged or grew → STOP/bail; (c) HEAD moved AND the failing-criterion set is strictly smaller → may CONTINUE. Confirm a bail yields a FAIL result for a human (never `verified`) and fires even when the level’s remaining cycle budget is > 0.
- **Fails if:** an unchanged HEAD keeps looping; a non-shrinking failing set keeps looping; the no-progress bail marks the phase `verified`, or only stops at budget exhaustion instead of on no-progress.

### C7 — A remediation pass is scoped to ONLY the unmet criteria and carries the verifier’s evidence, plan-blind
- **Observe:** Feed the remediation-brief builder a known unmet criterion id + the verifier’s evidence (the exact failing command and its output). Inspect the produced instruction handed to the executor: it names only the unmet criterion/criteria, embeds the failing command + output verbatim, and does not instruct reading `PLAN.md`/`SPEC.md` or re-attacking already-passing criteria. Confirm it reuses the existing `astro-executor` (no new agent role is introduced).
- **Fails if:** the brief passes the whole criteria set or the entire plan; omits the failing command/output evidence; points the executor at PLAN.md; or a brand-new remediator agent type is required.

### C8 — Effort is per-phase only — there is no project-wide/global effort knob
- **Observe:** In the throwaway project, attempt to set a global effort via config (`AC config set effort deep`, or any global/preset surface). Then resolve the effective effort for a phase whose stored level is `standard` — it still resolves to `standard`. The resolved effort of a phase is a function of its own roadmap entry only; no config key participates.
- **Fails if:** a global config value changes/participates in a phase’s resolved effort; the effort default is read from config rather than hardcoded `standard`; a project-wide effort preset exists.

### C9 — The two-gate closure and research fan-out are untouched; depth spends only on remediate+tier
- **Observe:** (1) Two-gate: a phase at `verified` or below still cannot be closed by the automation — `AC phase accept 1` on a non-verified phase exits non-zero, and the remediation loop’s best self-produced status is `verified` (it never sets `complete`/accepts). (2) Research invariance: feed each level (`light`/`standard`/`deep`) to the effort resolution and diff the outputs — they differ ONLY in remediation cycles and model tiers; no output field increases a research/angle count. The number of research angles is independent of effort (stays 3).
- **Fails if:** the loop marks a phase `complete`/auto-accepts (weakening REQ-006); or a higher effort level widens the research fan-out beyond 3 angles.

### C10 — The fast lane (`/astro-alex`) stays light / single-pass by default
- **Observe:** Drive the fast-lane path’s effort determination: by default it resolves to `light` (0 remediation cycles = verify once, FAIL stops), regardless of a phase’s stored effort — a deeper effort only applies when a run explicitly opts in.
- **Fails if:** the fast lane inherits `standard`/`deep` budgets and auto-remediates by default, defeating its speed-first purpose.
