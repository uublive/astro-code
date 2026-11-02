# Reproduction

Test: `tests/config_codex.test.mjs` (4 tests). Command: `node --test tests/config_codex.test.mjs`

Observed before the fix: 0 pass, 4 fail —
- `the Models section needs an "On Codex" branch`
- `must forbid offering the Claude tiers`
- `must say why: config.json is shared with Claude users`
- `the rendered SKILL.md must still contain the branch`

# Diagnosis

**Symptom:** on Codex, `/astro-config` (the `astro-config` skill) offers `opus`/`sonnet`
tiers and profiles, and the user has to argue the model out of them.

**Cause:** the Models section of `commands/astro-config.md` is written for one host. Its
steps hard-code the Claude ladder ("The tier ladder is opus → sonnet for EVERY role",
profiles of opus/sonnet, per-role options `opus|sonnet|inherit`) with no host check. The
Codex renderer passes the body through unchanged (`lib/hosts/codex.mjs` skillBody), so
Codex receives exactly those instructions and follows them.

**Second-order hazard found while diagnosing:** `ac` accepts any model id
(`ac config set models.planner gpt-5.5-codex` succeeds), and `.astrocode/config.json` is
shared and committed. The natural workaround on Codex, typing a Codex model into a role,
would hand every Claude teammate's subagents a model their host does not have. So the fix
must also forbid writing `models.*` from Codex, not just stop offering Claude tiers.

**Ruled out:**
- `ac`/`lib/config.mjs` validation: it does not reject or rewrite anything, so it is not
  forcing Claude tiers. The defaults come from the project config, read faithfully.
- `localModelSession()` (lib/models.mjs): it only covers Claude Code on a non-Claude
  endpoint, and extending it to detect Codex would need Codex's env vars, which can't be
  verified here (no Codex install in the container or on the host). Guessing them would
  make a fix that passes its test and does nothing in the field.
- The Codex runner path (`lib/hosts/codex.mjs execCommand --model`): nothing in the
  shipped workflows calls it today, so it is not how the bug was reached.

**Not fixed here (out of scope, a design question):** per-host model maps, so a Codex
user can pick per-role Codex models without touching Claude teammates. That is a feature,
worth a backlog item, not part of this fix.
