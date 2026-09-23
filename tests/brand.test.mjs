// The Astrolize mark (hooks/_astro-brand.mjs): one source for the SessionStart banner,
// `ac help`, `ac logo` and /astro-help. Plain wherever ANSI is not rendered; shaded on a
// real terminal; NO_COLOR respected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderLogo, wantColor, LOGO_ART, WORDMARK } from '../hooks/_astro-brand.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('the plain logo is the art with the wordmark and version beside it, no ANSI', () => {
  const out = renderLogo({ lines: ['a tagline', 'next: x'], version: '9.9.9' });
  assert.doesNotMatch(out, /\x1b\[/);
  for (const row of LOGO_ART) assert.ok(out.includes(row.trimEnd()), `missing art row: ${row}`);
  assert.match(out, new RegExp(`ääZPäP\\s+${WORDMARK.replace('|', '\\|')} · astro-code v9\\.9\\.9`));
  assert.match(out, /àääPPääà\s+a tagline/);
});

test('the coloured logo is the same text, shaded', () => {
  const plain = renderLogo({ lines: ['t'], version: '1.0.0' });
  const color = renderLogo({ lines: ['t'], version: '1.0.0', color: true });
  assert.match(color, /\x1b\[3[4-7]m/, 'uses the white/blue/magenta/cyan shading');
  assert.equal(strip(color), plain, 'colour changes no character or column');
});

test('extra lines continue under the art instead of being dropped', () => {
  const out = renderLogo({ lines: Array.from({ length: 10 }, (_, i) => `line ${i}`), version: '' });
  assert.match(out, /line 9/);
});

test('colour only on a TTY, never with NO_COLOR or TERM=dumb', () => {
  assert.equal(wantColor({ isTTY: false }, {}), false);
  assert.equal(wantColor({ isTTY: true }, {}), true);
  assert.equal(wantColor({ isTTY: true }, { NO_COLOR: '' }), false, 'NO_COLOR set to anything disables colour');
  assert.equal(wantColor({ isTTY: true }, { TERM: 'dumb' }), false);
});

test('`ac help` and `ac logo` lead with the mark; piped output is plain', () => {
  const help = spawnSync(process.execPath, [AC, 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^ {8}PZÇP\n/, 'the logo comes first');
  assert.match(help.stdout, /4str0\|ize · astro-code/);
  assert.match(help.stdout, /ac init \[--name N\]/, 'the command list follows');
  assert.doesNotMatch(help.stdout, /\x1b\[/, 'piped (not a TTY) → plain');
  const logo = spawnSync(process.execPath, [AC, 'logo'], { encoding: 'utf8' });
  assert.equal(logo.status, 0);
  assert.match(logo.stdout, /°²²°\n$/);
  const verb = spawnSync(process.execPath, [AC, 'tune', '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(verb.stdout, /PZÇP/, 'a verb\'s own help stays terse — no logo');
});
