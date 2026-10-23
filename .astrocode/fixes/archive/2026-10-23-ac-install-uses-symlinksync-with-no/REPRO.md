# Reproduction — not reproducible on current code

The report describes code that no longer exists. Commit 295c457 (2026-10-08, "fix(install): Windows
installs survive without symlink rights") added `linkOrCopy` in lib/install.mjs: a symlink refused
with EPERM/EACCES/ENOTSUP/EXDEV falls back to a plain copy, copies of renamed-away `astro-*` commands
are pruned by name, and `uninstallClaude` removes the copies (REQ-008 reversibility).

Its test already exists and passes: `tests/install.test.mjs` — "Windows without symlink rights
(EPERM) → commands are copied, pruned and uninstalled" (symlinkSync forced to throw EPERM).

Command: `node --test --test-name-pattern="Windows without symlink rights" tests/install.test.mjs`
Observed 2026-10-23: pass 1, fail 0.

The debt item (filed 2026-09-17) was never closed when 295c457 landed, so the triage graduated a bug
that was already fixed. No code change made under this fix.
