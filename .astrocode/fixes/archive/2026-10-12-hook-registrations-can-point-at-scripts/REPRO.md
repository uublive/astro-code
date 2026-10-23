# Reproduction — not reproduced (2026-10-23)

- `ac install` copies hooks into ~/.astro/code BEFORE registering them (lib/install.mjs: copyDir at
  installClaude/refresh, then host.registerHooks), so a single install cannot register a script the
  home lacks.
- ~/.astro is a symlink to /data/.astro (persisted), so the home does not silently revert on a
  container restart; today it is 0.50.1 and holds every registered hook script.
- Likely cause on 2026-10-12: two installs writing the same settings.json from different versions
  or homes (e.g. a newer checkout registering parts 2/4..4/4 while the home in use was still 0.38.0).
  Not observable now; needs the conditions to recur.
- Left open. Candidate hardening if it recurs: register the brief parts through a script every
  version ships (astro-update.mjs with an arg), or have the SessionStart hook detect a registered
  script missing from the home and say "run ac update" instead of a MODULE_NOT_FOUND per part.

# Closed through phase 50 (2026-10-23)

`ac doctor` names this state exactly ("registered hook script missing: <path> → ac install"), per CONTEXT D1 check 7, verified as phase 50 C5. Matteo chose at the phase 50 discussion that the fix closes when the phase is accepted.
