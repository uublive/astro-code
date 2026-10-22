// lib/pyscan.mjs (phase 48 t2): Python function spans and the mutmut 3 mutant-name grammar.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SRC = [
  'import os',                          // 1
  '',                                   // 2
  'X = 1',                              // 3
  '',                                   // 4
  'def a():',                           // 5
  '    return 1',                       // 6
  '',                                   // 7
  '@deco',                              // 8
  '@other(',                            // 9
  '    1)',                             // 10
  'async def b(',                       // 11
  '    x,',                             // 12
  '    y,',                             // 13
  '):',                                 // 14
  '    def inner():',                   // 15
  '        return x',                   // 16
  '    s = """',                        // 17
  'def fake():',                        // 18
  '"""',                                // 19
  '    return inner()',                 // 20
  '',                                   // 21
  '# comment',                          // 22
  'class K:',                           // 23
  '    attr = 1',                       // 24
  '',                                   // 25
  '    def __init__(self):',            // 26
  '        self.v = 0',                 // 27
  '',                                   // 28
  '    @property',                      // 29
  '    def m(self):',                   // 30
  '        return 2',                   // 31
  '',                                   // 32
  'def c():',                           // 33
  '    return 3',                       // 34
].join('\n');

test('pythonFunctions: spans for top-level defs, class methods, decorators, multi-line signatures, strings and nesting', async () => {
  const { pythonFunctions, functionAt } = await import('../lib/pyscan.mjs');
  const f = pythonFunctions(SRC);
  const by = Object.fromEntries(f.map((x) => [x.qual, x]));
  assert.deepEqual(Object.keys(by), ['a', 'b', 'K.__init__', 'K.m', 'c']);
  assert.deepEqual([by.a.start, by.a.def, by.a.end], [5, 5, 6]);
  assert.deepEqual([by.b.start, by.b.def, by.b.end], [8, 11, 20]); // decorators, signature, nested def + string folded in
  assert.equal(by['K.__init__'].cls, 'K');
  assert.equal(by['K.__init__'].name, '__init__');
  assert.deepEqual([by['K.m'].start, by['K.m'].def, by['K.m'].end], [29, 30, 31]);
  assert.deepEqual([by.c.def, by.c.end], [33, 34]);
  assert.equal(f.some((x) => x.name === 'fake' || x.name === 'inner'), false);
  assert.equal(functionAt(f, 16), 'b', 'a nested function line belongs to its parent');
  assert.equal(functionAt(f, 18), 'b', 'a def inside a string is not a function');
  assert.equal(functionAt(f, 3), null, 'module body');
  assert.equal(functionAt(f, 24), null, 'class body outside a method');
  assert.equal(functionAt(f, 31), 'K.m');
});

test('pythonFunctions: CRLF input gives the same spans', async () => {
  const { pythonFunctions } = await import('../lib/pyscan.mjs');
  assert.deepEqual(pythonFunctions(SRC.replace(/\n/g, '\r\n')), pythonFunctions(SRC));
});

test('mutmutModule and mutmutGlob follow mutmut 3 naming', async () => {
  const { mutmutModule, mutmutGlob } = await import('../lib/pyscan.mjs');
  assert.equal(mutmutModule('src/pkg/mod.py'), 'pkg.mod');
  assert.equal(mutmutModule('pkg/__init__.py'), 'pkg');
  assert.equal(mutmutGlob('src/pkg/mod.py', 'b'), 'pkg.mod.x_b__mutmut_*');
  assert.equal(mutmutGlob('pkg/mod.py', 'K.m'), 'pkg.mod.xǁKǁm__mutmut_*');
});

test('parseMutantName reads functions, methods, dunder and private names, and refuses junk', async () => {
  const { parseMutantName } = await import('../lib/pyscan.mjs');
  assert.deepEqual(parseMutantName('pkg.mod.xǁKǁ__init____mutmut_12'), { module: 'pkg.mod', qual: 'K.__init__', n: 12 });
  assert.deepEqual(parseMutantName('pkg.mod.x_b__mutmut_3'), { module: 'pkg.mod', qual: 'b', n: 3 });
  assert.equal(parseMutantName('pkg.mod.x__priv__mutmut_1').qual, '_priv');
  assert.equal(parseMutantName('not a mutant'), null);
  assert.equal(parseMutantName('pkg.mod.b'), null);
});
