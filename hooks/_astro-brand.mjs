// The Astrolize mark — the one place the logo lives, shared by the SessionStart banner
// (hooks/_astro-ctx.mjs), `ac help` / `ac logo` (bin/ac.mjs) and, through `ac logo`,
// the /astro-help command. It sits beside the hooks rather than in lib/ because the
// hooks are installed into ~/.astro/code/hooks WITHOUT lib/; the CLI imports it from
// here instead, and npm ships hooks/ (package.json "files").
//
// The art and its pseudo-3D shading come from the Astrolize `astro` CLI
// (apps/astro/src/ui/renderer.ts), so the two tools carry the same mark.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const LOGO_ART = [
  '        PZÇP',
  '       ääZPäP',
  '      àääPPääà',
  '      PäP  PäP',
  '     Pääà  àääP',
  '    àääP ºº Pää¥',
  '    Pää –²²– äää',
  '        °²²°',
];
export const WORDMARK = '4str0|ize';
export const TAGLINE = 'lean, multi-developer planning for Claude Code';
const TEXT_COL = 20; // the right-hand column starts here, clear of the widest art row

const ESC = '\x1b[';
const C = {
  reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`,
  cyan: `${ESC}36m`, white: `${ESC}37m`, blue: `${ESC}34m`, magenta: `${ESC}35m`,
  gray: `${ESC}37m${ESC}2m`, darkGray: `${ESC}90m`,
};

// Pseudo-3D shading, as in the astro CLI: a spark highlight, then a bright face, a
// blue body, and a purple/gray deep shadow, by diagonal depth.
function shade(line, row) {
  let out = '';
  for (let col = 0; col < line.length; col++) {
    const ch = line[col];
    if (ch === ' ') { out += ch; continue; }
    const depth = row * 1.62 + col * 0.26;
    const spark = (row * 13 + col * 7) % 17 === 0;
    const c =
      spark && depth < 6.4 ? C.cyan + C.bold
        : depth < 2.5 ? C.white + C.bold
          : depth < 4.0 ? C.white
            : depth < 6.7 ? C.blue + C.bold
              : depth < 8.6 ? C.blue
                : depth < 10.6 ? C.magenta
                  : depth < 12.8 ? C.darkGray
                    : C.gray;
    out += `${c}${ch}${C.reset}`;
  }
  return out;
}

/** Colour only on a real terminal, and never when NO_COLOR is set (no-color.org). */
export function wantColor(stream = process.stdout, env = process.env) {
  return !!(stream && stream.isTTY) && !('NO_COLOR' in env) && env.TERM !== 'dumb';
}

/** astro-code's version: the installed home's stamp first, else this checkout's package.json. */
export function brandVersion() {
  try {
    const v = readFileSync(join(homedir(), '.astro', 'code', 'version'), 'utf8').trim();
    if (v) return v;
  } catch { /* not installed — fall through */ }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version || '';
  } catch { return ''; }
}

/**
 * The logo with a right-hand text column. Row 1 carries the wordmark; `lines` fill the
 * rows beneath it and continue under the art if there are more lines than rows.
 * `color` shades the art and styles the text; plain output is byte-stable for places
 * that do not render ANSI (the SessionStart systemMessage, a model-relayed command).
 */
export function renderLogo({ lines = [], color = false, version = brandVersion() } = {}) {
  const right = [`${WORDMARK} · astro-code${version ? ` v${version}` : ''}`, ...lines];
  const rows = Math.max(LOGO_ART.length, right.length + 1);
  const out = [];
  for (let r = 0; r < rows; r++) {
    const art = LOGO_ART[r] || '';
    const text = r === 0 ? '' : right[r - 1] || '';
    const artOut = color ? shade(art, r) : art;
    let textOut = text;
    if (color && text) {
      textOut = r === 1 ? `${C.white}${C.bold}${WORDMARK}${C.reset}${C.dim}${text.slice(WORDMARK.length)}${C.reset}` : `${C.dim}${text}${C.reset}`;
    }
    const pad = text ? ' '.repeat(Math.max(1, TEXT_COL - art.length)) : '';
    out.push((artOut + pad + textOut).replace(/\s+$/, ''));
  }
  return out.join('\n');
}
