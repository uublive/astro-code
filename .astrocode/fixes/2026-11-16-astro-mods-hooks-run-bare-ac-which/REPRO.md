# Reproduction

- Machine: `env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin sh -c 'command -v ac; ac status --json'` printed
  `/usr/sbin/ac` and `total 0.00` (macOS login accounting), the report's symptom.
- `node --test tests/fix_mods_bare_ac.test.mjs`: before the fix 3/3 fail (bare `['ac', …]` argvs in 4 hook
  files; no `hooks/lib/ac.js`; the installed copy not pinned). After: no bare argv, the repo copy is `['ac']`,
  and an install into a scratch HOME writes `[process.execPath, <repo>/bin/ac.mjs]`, which answers
  `--version` under the minimal PATH.
