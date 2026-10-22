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
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname } from 'node:path';

const name = basename(process.argv[1]).replace(/\.(cmd|exe)$/, '');
const argv = process.argv.slice(2);
const env = process.env;
if (env.MUTATE_STUB_LOG) {
  const configs = ['stryker.config.json', '.gremlins.yaml', 'setup.cfg'].filter((f) => existsSync(f));
  appendFileSync(env.MUTATE_STUB_LOG, JSON.stringify({ tool: name, argv, cwd: process.cwd(), configs }) + '\n');
}
const DEFAULT_VERSION = { stryker: '8.2.6', gremlins: 'gremlins version 0.5.0', mutmut: 'mutmut, version 2.4.4' };
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
    hang();
  } else if (argv[0] === 'result-ids') process.stdout.write(env.MUTATE_STUB_SKIPPED ?? '');
  else process.stdout.write(report());
}
