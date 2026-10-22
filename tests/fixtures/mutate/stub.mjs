#!/usr/bin/env node
// Stand-in for Stryker / Gremlins / mutmut (phase 47). Copied into a temp bin/ (or
// node_modules/.bin/) UNDER THE TOOL'S NAME; it picks its behaviour from its own basename.
//   MUTATE_STUB_REPORT   fixture to emit, written where the real tool would put it
//   MUTATE_STUB_LOG      append {tool, argv, cwd, configs} JSON lines
//   MUTATE_STUB_SLEEP    sleep N seconds after writing
//   MUTATE_STUB_CHILD=1  spawn a sleeping child first (records pids to MUTATE_STUB_PIDS)
//   MUTATE_STUB_VERSION  version string to report
//   MUTATE_STUB_V2_REAL=1  mutmut: reject --version like real 2.x (only `mutmut version` answers)
//   MUTATE_STUB_EXIT     mutmut: `run` exits with this status at once (a fatal baseline)
//   MUTATE_STUB_SKIPPED  mutmut: what `result-ids skipped` prints
// Phase 48 knobs:
//   MUTATE_STUB_OUT / MUTATE_STUB_ERR  text written to stdout / stderr when `run` / `unleash`
//                        starts, BEFORE any sleep: step markers, progress lines, a unique marker
//   MUTATE_STUB_VERSION_CRASH=1  mutmut: `--version` and `version` exit 1 like an unconfigured 3.x
//   MUTATE_STUB_SHOW=<dir>  mutmut: `show <name>` prints `<dir>/<name>.diff`
//   MUTATE_STUB_MUTANTS=<dir>  mutmut: `run` copies <dir> to ./mutants (the generated sources)
// Phase 49 knobs (the flaky pre-check runs the project's own test runner; copied as `go` or
// `pytest` the stub emulates that runner, argv `test …` for go):
//   MUTATE_STUB_FLAKY=<counterfile>:<name>  fails <name> on odd-numbered invocations
//                        (go prints `--- FAIL: <name>`, pytest prints `FAILED <name>`; exit 1)
//   MUTATE_STUB_BROKEN=<name>   fails <name> on every invocation
//   MUTATE_STUB_TEST_SLEEP=<s>  sleeps per invocation, for the cap tests
// Every log line also carries `at` (epoch ms), so a test can see when a tool started.
// The log line also records env {GOFLAGS, PYTEST_ADDOPTS}, and `configText` (the content) when
// `run`'s first operand is a file path (the Stryker config ac generates).
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname } from 'node:path';

const name = basename(process.argv[1]).replace(/\.(cmd|exe)$/, '');
const argv = process.argv.slice(2);
const env = process.env;
if (env.MUTATE_STUB_LOG) {
  const configs = ['stryker.config.json', '.gremlins.yaml', 'setup.cfg'].filter((f) => existsSync(f));
  const entry = {
    tool: name, argv, cwd: process.cwd(), configs, at: Date.now(),
    env: { GOFLAGS: env.GOFLAGS ?? null, PYTEST_ADDOPTS: env.PYTEST_ADDOPTS ?? null },
  };
  if (argv[0] === 'run' && argv[1] && existsSync(argv[1]) && statSync(argv[1]).isFile()) entry.configText = readFileSync(argv[1], 'utf8');
  appendFileSync(env.MUTATE_STUB_LOG, JSON.stringify(entry) + '\n');
}
if ((name === 'go' && argv[0] === 'test') || name === 'pytest') {
  if (env.MUTATE_STUB_TEST_SLEEP) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(env.MUTATE_STUB_TEST_SLEEP) * 1000);
  const failing = [];
  if (env.MUTATE_STUB_BROKEN) failing.push(env.MUTATE_STUB_BROKEN);
  if (env.MUTATE_STUB_FLAKY) {
    const at = env.MUTATE_STUB_FLAKY.lastIndexOf(':');
    const file = env.MUTATE_STUB_FLAKY.slice(0, at);
    const n = (existsSync(file) ? Number(readFileSync(file, 'utf8')) || 0 : 0) + 1;
    writeFileSync(file, String(n));
    if (n % 2 === 1) failing.push(env.MUTATE_STUB_FLAKY.slice(at + 1));
  }
  if (name === 'go') {
    for (const f of failing) console.log(`=== RUN   ${f}\n--- FAIL: ${f} (0.00s)`);
    console.log(failing.length ? 'FAIL\nFAIL\texample.com/p\t0.01s' : 'ok  \texample.com/p\t0.01s');
  } else {
    for (const f of failing) console.log(`FAILED ${f} - AssertionError`);
    console.log(failing.length ? `${failing.length} failed in 0.01s` : '1 passed in 0.01s');
  }
  process.exit(failing.length ? 1 : 0);
}
const DEFAULT_VERSION = { stryker: '8.2.6', gremlins: 'gremlins version 0.5.0', mutmut: 'mutmut, version 2.4.4' };
// An unconfigured mutmut 3.x cannot even answer --version (phase 47 debt, real 3.8 behaviour).
if (name === 'mutmut' && env.MUTATE_STUB_VERSION_CRASH === '1' && (argv[0] === '--version' || argv[0] === 'version')) {
  process.stderr.write('FileNotFoundError: Could not figure out where the code to mutate is. Please specify it by adding "source_paths=code_dir" in setup.cfg to the [mutmut] section.\n');
  process.exit(1);
}
// Real mutmut 2.x: no --version flag (click exits 2), only a `version` subcommand.
if (name === 'mutmut' && env.MUTATE_STUB_V2_REAL === '1' && argv[0] === '--version') {
  process.stderr.write("Error: No such option '--version'.\n");
  process.exit(2);
}
if (name === 'mutmut' && argv[0] === 'version') {
  console.log(`mutmut version ${env.MUTATE_STUB_VERSION ?? '2.4.5'}`);
  process.exit(0);
}
if (argv[0] === '--version') {
  console.log(env.MUTATE_STUB_VERSION ?? DEFAULT_VERSION[name]);
  process.exit(0);
}
const report = () => (env.MUTATE_STUB_REPORT ? readFileSync(env.MUTATE_STUB_REPORT, 'utf8') : '');
const hang = () => {
  if (env.MUTATE_STUB_OUT) process.stdout.write(env.MUTATE_STUB_OUT);
  if (env.MUTATE_STUB_ERR) process.stderr.write(env.MUTATE_STUB_ERR);
  const pids = [process.pid];
  if (env.MUTATE_STUB_CHILD === '1') {
    const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    pids.push(c.pid);
  }
  if (env.MUTATE_STUB_PIDS) writeFileSync(env.MUTATE_STUB_PIDS, pids.join(' '));
  if (env.MUTATE_STUB_SLEEP) setTimeout(() => process.exit(0), Number(env.MUTATE_STUB_SLEEP) * 1000);
  else if (env.MUTATE_STUB_CHILD === '1') process.exit(0);
};

if (name === 'stryker') {
  if (env.MUTATE_STUB_REPORT) {
    mkdirSync('reports/mutation', { recursive: true });
    writeFileSync('reports/mutation/mutation.json', report());
  }
  hang();
} else if (name === 'gremlins') {
  const i = argv.indexOf('--output');
  if (i > -1 && env.MUTATE_STUB_REPORT) {
    mkdirSync(dirname(argv[i + 1]), { recursive: true });
    writeFileSync(argv[i + 1], report());
  }
  hang();
} else if (name === 'mutmut') {
  if (argv[0] === 'run') {
    if (env.MUTATE_STUB_EXIT) { process.stderr.write('RuntimeError: Tests don\'t run cleanly\n'); process.exit(Number(env.MUTATE_STUB_EXIT)); }
    if (env.MUTATE_STUB_MUTANTS) cpSync(env.MUTATE_STUB_MUTANTS, 'mutants', { recursive: true });
    hang();
  } else if (argv[0] === 'show' && env.MUTATE_STUB_SHOW) {
    const f = `${env.MUTATE_STUB_SHOW}/${argv[1]}.diff`;
    if (existsSync(f)) process.stdout.write(readFileSync(f, 'utf8'));
    else { process.stderr.write(`no such mutant: ${argv[1]}\n`); process.exit(1); }
  } else if (argv[0] === 'result-ids') process.stdout.write(env.MUTATE_STUB_SKIPPED ?? '');
  else process.stdout.write(report());
}
