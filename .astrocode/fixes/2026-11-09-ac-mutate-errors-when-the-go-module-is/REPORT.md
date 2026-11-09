Bug report from the astrobot-vault session, sent at the owner's request: `ac mutate` always errors on a project whose Go module is in a subfolder.

Seen on /Users/buu/Development/astrobot-vault (Go module in host/, no go.mod at the repo root), astro-code 0.55.0, config mutation.tool = gremlins. `ac mutate 129 --json` and `ac mutate 130 --json` return outcome "error", with baseline_failing in about 100 ms and "not in a Go module: open /go.mod". `ac mutate --check` says Gremlins v0.6.0 is found, so the tool itself is fine.

Cause as far as I read it (lib/mutate.mjs, not tested): every run uses cwd: root (the flaky-check runCapped around line 912, the main run around line 1256), and the go test baseline uses repo-root paths like ./host/cmd/hostd. No mutation.* config key changes the working directory.

What a fix needs: run Gremlins and the baseline from the module directory (nearest go.mod of the scoped files, or a config key such as mutation.cwd), and translate paths both ways: --exclude-files patterns, the mutation.files scope, and the file paths in Gremlins' report that get matched to the phase's lines. Please add a test with a fixture repo whose go.mod is in a subfolder.

Also worth a look: in this repo the phase's changes can be console TypeScript too, and the Gremlins row only ever covers Go.

Please do this on a branch with a PR, per your repo's usual flow. Don't change the installed copy in ~/.astroforge/astro-code; the owner decides when it is released. In astrobot this is logged as debt three times: 2026-10-31-ac-mutate-cannot-run-gremlins-on-a-go, 2026-11-07-ac-mutate-runs-gremlins-from-the-repo, 2026-11-08-ac-mutate-cannot-run-on-this-project.

(Pasted by the owner into the astro-code session, 2026-11-09.)

## Diagnosis

- **Symptom:** `outcome: "error"`, baseline failing, "not in a Go module: open /go.mod".
- **Cause:** `lib/mutate.mjs` ran both the go-test baseline (flaky check) and `gremlins unleash` with
  `cwd: root`, and built every path repo-relative. Go needs the module folder; Gremlins also names files
  module-relative in its report and in `--exclude-files`.
- **Second cause found while reproducing:** Gremlins' `--diff` (ac's default narrowing for Go) cannot work
  for a subfolder module even from the right folder: it compares git's repo-relative diff paths with its
  module-relative file names and skips every mutant (7/7 on the real tool). So a subfolder module uses
  the existing file mode (exclude the module's other .go files); survivors are still filtered to the
  phase's changed lines.
- **Ruled out:** the Gremlins install (`--check` finds it; it runs fine from the module folder); the
  report parser's suffix matching (it would usually match `p2/p2.go` to `host/p2/p2.go` by chance, but
  the prefix is now explicit).

## Fix

- `goModuleDir(root, files)`: the nearest `go.mod` of the phase's Go files ('' = root; error with a clear
  message if the files span several modules).
- Gremlins and the `go test` baseline run from that folder; `--exclude-files`, the go-test package dirs and
  `mutation.exclude` are made module-relative; report paths get the module prefix back (`parseGremlins`
  `modDir`). A subfolder module never uses `--diff`, and the scope reason says why.
- Root-module projects are unchanged (same argv, same `--diff` mode).

## Not covered here (follow-ups)

- **Detection:** with no `go.mod` at the root, `ac mutate` does not detect Go at all (it falls back to AI
  mutants). Projects like astrobot-vault must keep `mutation.tool = gremlins`. Detecting a nested module is a
  stack-detection change, wider than this fix.
- **`.gremlins.yaml`** is read from the working directory, so for a subfolder module it must sit in the
  module folder (`host/.gremlins.yaml`); `ac mutate setup` still writes it at the root.
- **Mixed-language phases** (Go host + console TypeScript): `ac mutate` picks one tool per run, so the
  TypeScript part is never mutated. Running one tool per language in the same run is a phase, not a fix.

## Verification

- Repro (stub, always runs): `tests/fix_mutate_go_subdir.test.mjs` fails on develop, passes with the fix.
- Real tools: `AC_MUTATE_REAL=1` Gremlins tests 3/3 pass (new subfolder case + both root-module cases).
- Manual: the scratch subfolder project now reports `outcome: survivors`, 1 killed / 1 survived, the
  survivor at `host/p2/p2.go`, `go test -count=1 -v ./p2` run from `host/`.
- Full suite (`npm test`): 2,859 tests, 2,850 pass, 0 fail, 9 skipped.
- Not run against astrobot-vault itself: that would write its SURVIVORS.json/run files into that project.
