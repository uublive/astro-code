// The argv prefix every astro-mods hook runs `ac` with (fix 2026-11-16-astro-mods-hooks-run-bare-ac-which).
//
// Claude Code can start the hooks with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), and on macOS a bare
// `ac` there is /usr/sbin/ac, the login-accounting command ("total 0.00"), so every read failed as "ac
// printed output that is not JSON". `ac install` / `ac update` rewrite THIS file in the installed copy
// (~/.astro/code/mods/astro-mods) with absolute paths: [<node>, <clone>/bin/ac.mjs]. The repo copy keeps
// the plain name, so tests and a dev checkout run exactly as before. Hooks spread it: `[...AC, 'status']`.
export const AC = ['ac']
