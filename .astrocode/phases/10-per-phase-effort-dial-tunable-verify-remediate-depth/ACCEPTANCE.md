# Acceptance (UAT) — Phase 10: Per-phase effort dial

Human-confirmable checks. Confirm each before `/astro-accept` closes the phase.

- [ ] The user can set a phase's effort level with `ac phase effort <n> <light|standard|deep>`,
      see it stored in `.astrocode/roadmap.json`, and read it back — while a phase that was
      never set (or an older roadmap with no effort field) is treated as `standard` with no crash.
- [ ] The user can watch a mid-phase verify FAIL trigger an automatic remediate→re-verify loop
      (no human stop): `standard` retries up to once, `deep` up to three times, `light` never
      retries (single pass, FAIL stops).
- [ ] The user can see a genuinely-stuck phase bail to a human-facing FAIL — not grind the whole
      budget — when a remediation cycle makes no progress (no new commit, or the failing-criteria
      set didn't shrink).
- [ ] The user can run `/astro-execute <n> --effort deep` as a one-off and observe deeper effort
      for that run while `.astrocode/roadmap.json` still shows the phase's originally-stored level.
- [ ] The user can confirm a `deep` phase runs its executor and verifier on the opus tier for that
      run, and that `.astrocode/config.json` `models` is left unchanged afterward.
- [ ] The user can confirm the remediation only re-attacks the unmet criteria (with the verifier's
      failing command + output in hand) — not the whole plan — and that the loop reaches `verified`
      at best; `/astro-accept` is still required to close the phase.
- [ ] The user can confirm the fast lane `/astro-alex` still verifies once and stops (light), and
      that there is NO project-wide effort setting — effort is per-phase only.
