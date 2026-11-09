# Reproduction

## Real tools (Go 1.26.4, Gremlins built from go-gremlins/gremlins, dev build)

Scratch repo: `.astrocode/` at the root, Go module in `host/` (`host/go.mod`, `host/p1/p1.go`,
`host/p2/p2.go` + test), phase 5 changes `host/p2/p2.go`, `mutation.tool = gremlins`.

    ac mutate 5 --json

Before the fix:

    "outcome": "error",
    "flaky": { "checked": true, "command": "go test -count=1 -v ./host/p2", "baseline_failing": [...] }
    "error": "the tool produced no report (exit 1: ERROR: not in a Go module: open /go.mod: no such file or directory)"

Exactly the reported symptom.

Probing Gremlins by hand from `host/`:
- the report names files module-relative (`"file_name":"p2/p2.go"`);
- `unleash --diff <base>` from `host/` marks **every** mutant Skipped (7/7): git's diff paths are
  repo-relative (`host/p2/p2.go`) and never match the module-relative files, so `--diff` cannot be used
  for a subfolder module;
- `unleash --exclude-files '^p1/p1\.go$'` from `host/` tests p2 normally (3 killed, 1 lived).

## Tests

- `tests/fix_mutate_go_subdir.test.mjs` (always runs; stub tools log cwd and argv):
  `node --test tests/fix_mutate_go_subdir.test.mjs` — failed before the fix, passes after.
- `tests/mutate_real.test.mjs`, "real Gremlins on a Go module in a subfolder" (opt-in):
  `PATH="$HOME/go/bin:$PATH" AC_MUTATE_REAL=1 node --test --test-name-pattern=Gremlins tests/mutate_real.test.mjs`
  — 3/3 pass after the fix (the two existing root-module cases unchanged).
