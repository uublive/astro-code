# Reproduction

Test: `tests/fix_statusline_epipe.test.mjs` — runs the hook into a reader that exits at once
(`node hooks/astro-statusline.mjs < payload | true`), three times, and checks stderr and the hook's
own exit status (`PIPESTATUS[0]`).

Command: `node --test tests/fix_statusline_epipe.test.mjs`

Observed before the fix: every run printed `Error: write EPIPE` with a Node stack trace and the
hook exited 1 (also reproduced by hand: 3 of 3 runs, `rc=1`).

# Diagnosis

- Symptom: a stack trace and exit 1 when the hook's output is piped into a short reader.
- Cause: stdout to a pipe is asynchronous in Node; a write to a closed pipe surfaces as an
  `error` event on `process.stdout`, and with no listener Node treats it as uncaught.
- Ruled out: the rendering (the hook produced its lines normally; only the final write failed).
- Live Claude Code reads the whole output, so users never hit it; it affected manual debugging and
  any future caller that pipes the hook.

# Fix

An `error` listener on `process.stdout` before the final write: EPIPE exits 0 (nobody is reading),
any other error is rethrown unchanged.
