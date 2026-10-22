// Python source scanning for mutmut 3 (phase 48, P3/P9): function spans and the mutant-name
// grammar. Pure text matching (333f) — no Python is run and nothing is interpreted.
//
// Why only top-level functions and top-level classes' methods: mutmut 3 trampolines exactly
// those (a generated `x_<f>` / `xǁKǁ<m>` per function, each with `__mutmut_N` variants). A
// nested def is part of its parent's body, so it is folded into the parent's span. A line in a
// module body or a class body outside any method is not mutatable by mutmut 3 at all.
//
// The scanner is line-based but string-, comment- and bracket-aware, so a `def` inside a
// triple-quoted string is ignored and a multi-line signature (`):` back at the def's indent)
// does not end the function early.

// Python identifiers are Unicode: mutmut 3's generated method names contain `ǁ`, which `\w` is not.
const FN = /^(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)/u;
const CLS = /^class\s+([\p{L}_][\p{L}\p{N}_]*)/u;

// Per line: { raw, code, indent, stmt, content }. `code` is the line with strings and comments
// blanked out; `stmt` means a new statement starts here (not a continuation, not inside a
// triple-quoted string); `content` means the line carries code or string text (not blank/comment).
function scanLines(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let triple = null; // '"""' | "'''" while inside a multi-line string
  let depth = 0;
  for (const raw of lines) {
    const startedInString = triple !== null;
    const startDepth = depth;
    let code = '';
    let sawString = startedInString;
    let i = 0;
    let quote = null; // single-line string delimiter
    while (i < raw.length) {
      const ch = raw[i];
      if (triple) {
        if (ch === '\\') { i += 2; continue; }
        if (raw.startsWith(triple, i)) { triple = null; i += 3; continue; }
        i += 1; continue;
      }
      if (quote) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) quote = null;
        i += 1; continue;
      }
      if (ch === '#') break;
      if (ch === '"' || ch === "'") {
        sawString = true;
        if (raw.startsWith(ch.repeat(3), i)) { triple = ch.repeat(3); i += 3; continue; }
        quote = ch; i += 1; continue;
      }
      if ('([{'.includes(ch)) depth += 1;
      else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
      code += ch;
      i += 1;
    }
    const trimmed = code.trim();
    out.push({
      raw,
      code,
      indent: raw.length - raw.trimStart().length,
      stmt: !startedInString && startDepth === 0 && trimmed !== '',
      content: trimmed !== '' || sawString,
    });
  }
  return out;
}

/**
 * `[{ qual, name, cls, def, start, end }]` (1-based, inclusive). `qual` is `name` or `K.name`;
 * `def` the def line, `start` the first decorator line (or `def`), `end` the last content line.
 */
export function pythonFunctions(text) {
  const L = scanLines(text);
  const funcs = [];
  const spanEnd = (from, indent) => {
    let end = from;
    for (let j = from + 1; j < L.length; j += 1) {
      if (L[j].stmt && L[j].indent <= indent) break;
      if (L[j].content) end = j;
    }
    return end;
  };
  const startOf = (i, indent) => {
    let start = i;
    for (let k = i - 1; k >= 0; k -= 1) {
      if (L[k].stmt && L[k].code.trim().startsWith('@') && L[k].indent === indent) start = k;
      else if (!L[k].stmt && L[k].content && k !== i) continue; // a decorator's continuation line
      else break;
    }
    return start;
  };
  for (let i = 0; i < L.length; i += 1) {
    if (!L[i].stmt || L[i].indent !== 0) continue;
    const code = L[i].code.trim();
    const f = FN.exec(code);
    if (f) {
      funcs.push({ qual: f[1], name: f[1], cls: null, def: i + 1, start: startOf(i, 0) + 1, end: spanEnd(i, 0) + 1 });
      continue;
    }
    const c = CLS.exec(code);
    if (!c) continue;
    const classEnd = spanEnd(i, 0);
    let bodyIndent = null;
    for (let j = i + 1; j <= classEnd; j += 1) {
      if (!L[j].stmt) continue;
      if (bodyIndent === null) bodyIndent = L[j].indent;
      if (L[j].indent !== bodyIndent) continue;
      const m = FN.exec(L[j].code.trim());
      if (!m) continue;
      funcs.push({
        qual: `${c[1]}.${m[1]}`, name: m[1], cls: c[1], def: j + 1, start: startOf(j, bodyIndent) + 1, end: spanEnd(j, bodyIndent) + 1,
      });
    }
  }
  return funcs;
}

/** The qual of the function whose span holds `line` (1-based), or null for module/class body. */
export function functionAt(funcs, line) {
  return (funcs || []).find((f) => line >= f.start && line <= f.end)?.qual ?? null;
}

// mutmut 3 names mutants after the importable module: a leading `src.` is stripped
// (`strip_prefix(..., prefix='src.')`) and a package's `__init__.py` is named after the package.
export function mutmutModule(file) {
  return String(file).replace(/(\/__init__)?\.py$/, '').replace(/\//g, '.').replace(/^src\./, '');
}

/** The mutant-name glob selecting every mutant of one function (`b`, or `K.m` for a method). */
export function mutmutGlob(file, qual) {
  const dot = qual.indexOf('.');
  const body = dot === -1 ? `x_${qual}` : `xǁ${qual.slice(0, dot)}ǁ${qual.slice(dot + 1)}`;
  return `${mutmutModule(file)}.${body}__mutmut_*`;
}

/** `pkg.mod.xǁKǁm__mutmut_12` → `{ module: 'pkg.mod', qual: 'K.m', n: 12 }`; junk → null. */
export function parseMutantName(name) {
  const m = /^(.*)\.(x(?:ǁ.+ǁ.+|_.+))__mutmut_(\d+)$/.exec(String(name).trim());
  if (!m) return null;
  const [, module, body, n] = m;
  let qual;
  if (body.startsWith('xǁ')) {
    const [, cls, ...rest] = body.split('ǁ');
    qual = `${cls}.${rest.join('ǁ')}`;
  } else qual = body.slice(2);
  return { module, qual, n: Number(n) };
}
