Su macOS gli hook di astro-mods lanciano ac senza percorso. Claude Code li esegue con un PATH suo, a volte solo /usr/bin:/bin:/usr/sbin:/sbin, e lì ac è il comando di sistema /usr/sbin/ac, che risponde total 0.00. A ogni avvio di sessione esce «ac printed output that is not JSON» e tutti i mod si spengono.

(Reported by Andrea, @topastro73-it, 2026-11-16, relayed by the owner as a screenshot; his fix was on a local branch fix/mods-bare-ac he could not push. This fix follows his design.)

## Diagnosis

- **Reproduced:** `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin sh -c 'command -v ac; ac status --json'` → `/usr/sbin/ac`, `total 0.00`.
- **Cause:** every astro-mods hook built its argv as `['ac', …]` (phase-band, brief-section, live-capture,
  switches), so the command depended on the PATH Claude Code hands the hooks.
- **Only the mods:** the classic hooks (`hooks/*.mjs`) and `lib/` never spawn a bare `ac`.

## Fix

- `mods/astro-mods/hooks/lib/ac.js` exports `AC`; every hook spreads it (`[...AC, 'status', '--json']`).
  The repo copy is `['ac']`, so tests and a dev checkout are unchanged.
- `lib/install.mjs` (`refreshMods`): after copying the mods tree, the installed copy's `hooks/lib/ac.js` is
  rewritten to `[<node>, <checkout>/bin/ac.mjs]`, both absolute.
- `tests/mods_plugin.test.mjs`: the phase-band read-only argv check matches the `[...AC, …]` spelling.

## Also reported, not fixed here

- CLI tests that break when the checkout path contains a space (`URL.pathname` keeps `%20`): filed as debt.
- `claude plugin test mods/astro-mods` failing on the phase-band banner test: it passes on this machine
  (332/332 mods tests); not reproduced.

## Verification

- `tests/fix_mods_bare_ac.test.mjs`: 3/3 fail before, pass after; all mods tests: 332 pass.
- Full suite: 3,060 pass, 0 fail.
