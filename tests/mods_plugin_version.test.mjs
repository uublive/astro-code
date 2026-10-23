// The astro-mods plugin manifest carries astro-code's own version. Claude Code keys its plugin cache
// by this version, so a manifest that never moves means `claude plugin update` (run by `ac update`)
// copies nothing and every band/mod change stays invisible — it sat at 0.41.0 from v0.41 to v0.50.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('the astro-mods plugin manifest version is astro-code\'s package version', () => {
  assert.equal(read('../mods/astro-mods/.claude-plugin/plugin.json').version, read('../package.json').version,
    'bump mods/astro-mods/.claude-plugin/plugin.json with package.json on every release');
});
