// lib/funcscan.mjs (phase 49 t1): Go and JS/TS function spans for survivor grouping.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const GO = [
  'package p',                                 // 1
  '',                                          // 2
  'func F(a int) int {',                       // 3
  '\tg := func(x int) int {',                  // 4
  '\t\treturn x + 1',                          // 5
  '\t}',                                       // 6
  '\treturn g(a)',                             // 7
  '}',                                         // 8
  '',                                          // 9
  'func (r *T) M() string {',                  // 10
  '\ts := `',                                  // 11
  'func fake() {',                             // 12
  '}`',                                        // 13
  '\t// func commented() {',                   // 14
  '\treturn s',                                // 15
  '}',                                         // 16
  'func One() int { return 1 }',               // 17
  'func (t T[K]) G(x interface{}) {',          // 18
  '}',                                         // 19
].join('\n');

test('goFunctions: names, receivers, spans; raw strings, comments and literals ignored', async () => {
  const { goFunctions } = await import('../lib/funcscan.mjs');
  assert.deepEqual(goFunctions(GO), [
    { qual: 'F', start: 3, end: 8 },
    { qual: 'T.M', start: 10, end: 16 },
    { qual: 'One', start: 17, end: 17 },
    { qual: 'T.G', start: 18, end: 19 },
  ]);
});

const JS = [
  'export function a(x) {',                    // 1
  '  const f = (y) => y + 1;',                 // 2
  '  return f(x) + "}";',                      // 3
  '}',                                         // 4
  'export default async function g() {',       // 5
  '  return `${1}}`; // }',                    // 6
  '}',                                         // 7
  'const h = (a: number, b: string): R => {',  // 8
  '  return a;',                               // 9
  '};',                                        // 10
  'const k = function () {',                   // 11
  '  return 1;',                               // 12
  '};',                                        // 13
  'const e = (v) => v * 2;',                   // 14
  'class K extends B {',                       // 15
  '  static async s(a) {',                     // 16
  '    return a;',                             // 17
  '  }',                                       // 18
  '  get v(): number {',                       // 19
  '    return 1;',                             // 20
  '  }',                                       // 21
  '  m(a: T): { x: number } {',                // 22
  '    if (a) { return { x: 1 }; }',          // 23
  '    return { x: 2 };',                      // 24
  '  }',                                       // 25
  '}',                                         // 26
  'x = 1;',                                    // 27
].join('\n');

test('jsFunctions: declarations, arrows, expressions, class methods; braces in strings do not shift spans', async () => {
  const { jsFunctions } = await import('../lib/funcscan.mjs');
  const got = jsFunctions(JS).map((f) => [f.qual, f.start, f.end]);
  assert.deepEqual(got, [
    ['a', 1, 4], ['g', 5, 7], ['h', 8, 10], ['k', 11, 13], ['e', 14, 14],
    ['K.s', 16, 18], ['K.v', 19, 21], ['K.m', 22, 25],
  ]);
});

test('jsFunctions: CRLF input gives the same spans', async () => {
  const { jsFunctions } = await import('../lib/funcscan.mjs');
  assert.deepEqual(jsFunctions(JS.replace(/\n/g, '\r\n')), jsFunctions(JS));
});

test('enclosingFunction dispatches by extension and returns null at top level', async () => {
  const { enclosingFunction } = await import('../lib/funcscan.mjs');
  assert.equal(enclosingFunction('a.go', GO, 5), 'F');
  assert.equal(enclosingFunction('a.go', GO, 2), null);
  assert.equal(enclosingFunction('a.ts', JS, 2), 'a');
  assert.equal(enclosingFunction('a.mjs', JS, 23), 'K.m');
  assert.equal(enclosingFunction('a.mjs', JS, 27), null);
  assert.equal(enclosingFunction('a.py', 'def f():\n    return 1\n', 2), 'f');
  assert.equal(enclosingFunction('a.rb', 'def f\n end', 1), null);
});
