// Function spans for Go and JS/TS (phase 49 t1, P1/P2): survivors are grouped by the function
// they sit in (D6), and the mutant identity key includes it, so something has to say which
// function a line belongs to. Python is `lib/pyscan.mjs`; this is the other two languages.
//
// A mechanical scan, never a parse claim (333f): strings, comments and template literals are
// blanked out and braces are matched. A wrong span can only regroup a survivor or move its key
// to a neighbouring function — it never decides a verdict. Anything the scanner cannot place
// comes back as null and the survivor is grouped as "outside any function" (b940).
//
// Only named functions are reported. A nested function or arrow folds into the enclosing named
// one, as a nested `def` does in pyscan. Class methods are `K.m`.
import { pythonFunctions, functionAt } from './pyscan.mjs';

// The source with every string, comment and template literal replaced by spaces (newlines kept,
// so offsets and line numbers still line up). `go` also blanks raw backtick strings.
function blank(text, go) {
  const s = String(text).replace(/\r\n?/g, '\n');
  let out = '';
  let i = 0;
  const pad = (from, to) => { for (let k = from; k < to; k += 1) out += s[k] === '\n' ? '\n' : ' '; };
  while (i < s.length) {
    const ch = s[i];
    if (ch === '/' && s[i + 1] === '/') {
      let j = s.indexOf('\n', i); if (j === -1) j = s.length;
      pad(i, j); i = j; continue;
    }
    if (ch === '/' && s[i + 1] === '*') {
      let j = s.indexOf('*/', i + 2); j = j === -1 ? s.length : j + 2;
      pad(i, j); i = j; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      let closed = false;
      // Backticks (Go raw, JS template) run across lines and a Go raw string has no escapes;
      // the other quotes end at the line's end if unterminated.
      while (j < s.length) {
        if (s[j] === '\\' && !(go && ch === '`')) { j += 2; continue; }
        if (s[j] === ch) { closed = true; j += 1; break; }
        if (s[j] === '\n' && ch !== '`') break;
        j += 1;
      }
      j = Math.min(j, s.length);
      out += ch; pad(i + 1, closed ? j - 1 : j); if (closed) out += ch;
      i = j; continue;
    }
    out += ch; i += 1;
  }
  return out;
}

// Index of the bracket closing the one at `open`, or -1.
function closeOf(code, open) {
  const o = code[open];
  const c = { '(': ')', '{': '}', '[': ']' }[o];
  let d = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === o) d += 1;
    else if (code[i] === c) { d -= 1; if (d === 0) return i; }
  }
  return -1;
}

const lineStarts = (code) => {
  const a = [0];
  for (let i = 0; i < code.length; i += 1) if (code[i] === '\n') a.push(i + 1);
  return a;
};
const lineOf = (starts, idx) => {
  let lo = 0; let hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
  return lo + 1;
};

const GO_FN = /^func\s+(?:\(\s*(?:\w+\s+)?\*?\s*(\w+)(?:\[[^\]]*\])?\s*\)\s*)?(\w+)/;

/** `[{ qual, start, end }]` (1-based, inclusive): `F` or `T.M`; literals fold into the enclosing func. */
export function goFunctions(text) {
  const lines = blank(text, true).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = GO_FN.exec(lines[i]);
    if (!m) continue;
    const qual = m[1] ? `${m[1]}.${m[2]}` : m[2];
    const first = lines[i].trimEnd();
    let end = i;
    const opens = (first.match(/\{/g) || []).length;
    const closes = (first.match(/\}/g) || []).length;
    if (!(first.endsWith('}') && opens === closes && opens > 0)) {
      end = lines.length - 1;
      for (let j = i + 1; j < lines.length; j += 1) if (lines[j].startsWith('}')) { end = j; break; }
    }
    out.push({ qual, start: i + 1, end: end + 1 });
    i = end;
  }
  return out;
}

const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'new', 'typeof', 'await', 'super']);

// From the `(` of a parameter list: the index of the body's `{`, skipping a TS return type
// (including an object-type literal in it), or -1 when there is no block body.
function bodyBrace(code, paren) {
  const close = closeOf(code, paren);
  if (close === -1) return -1;
  for (let i = close + 1; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') {
      const prev = code.slice(0, i).trimEnd().slice(-1);
      if (':,|<(&'.includes(prev) && prev !== '') { const c = closeOf(code, i); if (c === -1) return -1; i = c; continue; }
      return i;
    }
    if (ch === ';' || ch === '=' && code[i + 1] !== '>') return -1;
    if (ch === '(' || ch === '[') { const c = closeOf(code, ch === '(' ? i : i); if (c === -1) return -1; i = c; }
  }
  return -1;
}

// The end of an arrow/expression body that is not a block: the first `;` or newline at depth 0.
function exprEnd(code, from) {
  let d = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if ('([{'.includes(ch)) d += 1;
    else if (')]}'.includes(ch)) { d -= 1; if (d < 0) return i; }
    else if (d === 0 && (ch === ';' || ch === '\n')) return i;
  }
  return code.length;
}

/** `[{ qual, start, end }]`: named functions, `const f = …=>`/`function`, and class methods `K.m`. */
export function jsFunctions(text) {
  const code = blank(text, false);
  const starts = lineStarts(code);
  const out = [];
  const push = (qual, from, to) => out.push({ qual, start: lineOf(starts, from), end: lineOf(starts, Math.max(from, to)) });
  const FN_DECL = /(?:^|[\s;}])(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)?\s*(?:<[^>(]*>)?\s*\(/g;
  const VAR = /(?:^|[\s;}])(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*/g;
  const CLASS = /(?:^|[\s;}])(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([\w$]+)?[^{;]*\{/g;
  const taken = []; // [from, to] char ranges already reported as a named function/class body

  const inside = (idx) => taken.some(([a, b]) => idx > a && idx < b);

  let m;
  while ((m = CLASS.exec(code))) {
    const open = m.index + m[0].length - 1;
    if (inside(m.index)) continue;
    const close = closeOf(code, open);
    if (close === -1) continue;
    taken.push([open, close]);
    const K = m[1] || 'default';
    // Methods sit at the class body's own depth (1 relative to `open`).
    let depth = 0;
    let lineStart = open + 1;
    for (let i = open; i <= close; i += 1) {
      const ch = code[i];
      if (ch === '{' || ch === '(' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
      if (depth === 1 && (ch === '\n' || i === open)) {
        lineStart = i + 1;
        const rest = code.slice(lineStart, close);
        const mm = /^[ \t]*(?:(?:public|private|protected|static|async|readonly|override|abstract|declare)\s+)*(?:(?:get|set)\s+)?\*?\s*(#?[\w$]+)\s*(?:<[^>(]*>)?\s*(\()/.exec(rest);
        if (mm && !NOT_METHOD.has(mm[1])) {
          const paren = lineStart + mm[0].length - 1;
          const b = bodyBrace(code, paren);
          if (b !== -1) {
            const e = closeOf(code, b);
            if (e !== -1) { push(`${K}.${mm[1]}`, lineStart + (mm[0].length - mm[0].trimStart().length), e); }
          }
        }
        // property arrow: `foo = (...) => {` / `foo = async () => {`
        const pm = /^[ \t]*(?:(?:public|private|protected|static|readonly|override)\s+)*(#?[\w$]+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:\([^)\n]*\)|[\w$]+)\s*(?::[^=\n]+)?=>\s*(\{)?/.exec(rest);
        if (pm && !mm) {
          if (pm[2]) {
            const b = lineStart + pm[0].length - 1;
            const e = closeOf(code, b);
            if (e !== -1) push(`${K}.${pm[1]}`, lineStart, e);
          } else push(`${K}.${pm[1]}`, lineStart, exprEnd(code, lineStart + pm[0].length));
        }
      }
    }
  }
  while ((m = FN_DECL.exec(code))) {
    if (!m[1] || inside(m.index + 1)) continue;
    const paren = m.index + m[0].length - 1;
    const b = bodyBrace(code, paren);
    if (b === -1) continue;
    const e = closeOf(code, b);
    if (e === -1) continue;
    const nameIdx = code.indexOf(m[1], m.index);
    taken.push([nameIdx, e]);
    push(m[1], nameIdx, e);
  }
  while ((m = VAR.exec(code))) {
    const at = m.index + m[0].length;
    if (inside(m.index + 1)) continue;
    // the assignment `=` (not `=>`, not `==`), past an optional type annotation
    let eq = -1;
    for (let i = at; i < code.length && code[i] !== ';' && code[i] !== '\n'; i += 1) {
      if (code[i] === '=' && code[i + 1] !== '>' && code[i + 1] !== '=' && !'=!<>'.includes(code[i - 1])) { eq = i; break; }
    }
    if (eq === -1) continue;
    const rhs = code.slice(eq + 1);
    const lead = rhs.length - rhs.trimStart().length;
    const body = rhs.trimStart();
    const nameIdx = code.indexOf(m[1], m.index);
    const rhsAt = eq + 1 + lead;
    const fm = /^(?:async\s+)?function\b[^(]*\(/.exec(body);
    if (fm) {
      const b = bodyBrace(code, rhsAt + fm[0].length - 1);
      const e = b === -1 ? -1 : closeOf(code, b);
      if (e !== -1) { taken.push([nameIdx, e]); push(m[1], nameIdx, e); }
      continue;
    }
    // arrow: find `=>` at depth 0 before the statement ends
    let d = 0; let arrow = -1;
    for (let i = rhsAt; i < code.length; i += 1) {
      const ch = code[i];
      if ('([{<'.includes(ch) && ch !== '<') d += 1;
      else if (')]}'.includes(ch)) { d -= 1; if (d < 0) break; }
      else if (d === 0 && (ch === ';' || ch === '\n')) break;
      else if (d === 0 && ch === '=' && code[i + 1] === '>') { arrow = i; break; }
    }
    if (arrow === -1) continue;
    let k = arrow + 2;
    while (k < code.length && /\s/.test(code[k])) k += 1;
    if (code[k] === '{') {
      const e = closeOf(code, k);
      if (e !== -1) { taken.push([nameIdx, e]); push(m[1], nameIdx, e); }
    } else {
      const e = exprEnd(code, k);
      taken.push([nameIdx, e]); push(m[1], nameIdx, e);
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

const JS_EXT = /\.(?:[cm]?[jt]sx?)$/;

/** The innermost named function's qual holding `line` (1-based) in `text`, or null (top level, unknown file). */
export function enclosingFunction(file, text, line) {
  const f = String(file);
  let spans;
  if (f.endsWith('.go')) spans = goFunctions(text);
  else if (JS_EXT.test(f)) spans = jsFunctions(text);
  else if (f.endsWith('.py')) return functionAt(pythonFunctions(text), line);
  else return null;
  let best = null;
  for (const s of spans) {
    if (line < s.start || line > s.end) continue;
    if (!best || s.end - s.start < best.end - best.start) best = s;
  }
  return best ? best.qual : null;
}
