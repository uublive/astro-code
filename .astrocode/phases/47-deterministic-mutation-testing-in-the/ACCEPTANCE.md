# Acceptance — phase 47: deterministic mutation testing in the verifier

Use `ac` from this branch (`node /Users/buu/Development/astro-code/bin/ac.mjs`).

**Shared setup — the scratch JS project.** Every item below starts from this project unless it
says otherwise:
- `mktemp -d`, then `git init` and `ac init`, then `ac phase add "Demo"`.
- A `package.json`.
- `src/a.mjs` committed as `feat: a (phase 01 t1)`.
- A `CRITERIA.md` in the phase folder with `### C1 [mutation] — tests kill the mutants`.

The fake Stryker is a copy of `tests/fixtures/mutate/stub.mjs` at `node_modules/.bin/stryker`,
made executable, run with
`MUTATE_STUB_REPORT=/Users/buu/Development/astro-code/tests/fixtures/mutate/stryker-mutation.json`.
You can use a real Stryker install instead.

1. **You get a fixed mutant list from the tool, scoped to the phase.**
   - Run `ac mutate 1`. You see:
     - one line naming Stryker and why it was picked (`package.json → stryker`);
     - the counts per status (killed / timeout / survived / no-coverage / error);
     - `scope: src/a.mjs`;
     - one line per survivor.
   - Run `ac mutate 1 --json` twice. You get the same mutant list both times.
   - *Precondition:* the shared setup and fake Stryker above. `src/b.mjs` is committed under a
     different phase stamp, and it must NOT appear in the scope.

2. **A capped run never reads as "all killed".**
   - Run `ac config set mutation.cap_seconds 2` and set `MUTATE_STUB_SLEEP=60`.
   - Run `ac mutate 1`. It returns within a few seconds and says it was capped, listing what did
     not run.
   - Then run `ac config unset mutation.cap_seconds` followed by `ac mutate --check`. It shows a
     600 s cap.
   - *Precondition:* item 1's project, with the fake Stryker.

3. **With no tool, you are told once and then left alone, and nothing is installed.**
   - Remove `node_modules/.bin/stryker`.
   - Run `ac mutate 1` three times:
     - The first run shows the full suggestion with `npm i -D @stryker-mutator/core`.
     - The second and third runs show only `mutation tool not installed — AI mutants used`.
   - `ac mutate --check` still shows the full suggestion.
   - `package.json` and `git status` are unchanged.
   - In a fresh copy of the project, `ac mutate dismiss` silences the first suggestion too.
   - *Precondition:* the shared setup without any mutation tool. No
     `.astrocode/.local/mutate-notices.json` exists yet.

4. **Only `ac mutate setup` writes tool config.**
   - `ac mutate --check` and `ac mutate 1` leave every file outside `.astrocode/` untouched.
   - `ac mutate setup` then writes `stryker.config.json`, which parses as JSON.
   - Running `setup` a second time leaves that file alone.
   - *Precondition:* the shared setup with the fake Stryker, and no `stryker.config.json` yet.

5. **The verdict keeps the evidence, and refuses a test gap.**
   - Record `ac verdict record 1 --result '<json>'` with C1 passed and a `mutation` block, copied
     from item 1's `--json` output, with one survivor triaged `test-gap`. The output shows C1
     refused, names that survivor, and `passed: false`.
   - Re-record with the survivor triaged `equivalent` plus a one-line justification. The phase
     passes, and `VERDICT.json` shows the tool, version, command, counts and justification.
   - *Precondition:* item 1's project, at least one survivor in the fixture, and no prior
     `VERDICT.json`.

6. **You can find it.**
   - `ac help` lists `ac mutate <phase>`, `--check`, `setup` and `dismiss`.
   - `/astro-mutate` exists.
   - The MANUAL's mutation section gives each language's install command, the cap and override
     keys, how to dismiss, and where that memory lives (local, never committed).
   - *Precondition:* this branch installed (`ac install`), with no project state needed.
