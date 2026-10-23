ac install uses symlinkSync with no copy fallback, so a standard Windows user gets EPERM

Source: debt 2026-09-17-ac-install-uses-symlinksync-with-no, graduated to this fix by Matteo at the
milestone 13 debt triage ("Pay it as a fix").

Recorded observation, verbatim: "lib/install.mjs:81 symlinks unconditionally; on Windows symlinks
need Developer Mode or an elevated shell, so a normal install fails. A copy fallback must keep
REQ-008 reversibility — uninstall has to recognise copies too."
