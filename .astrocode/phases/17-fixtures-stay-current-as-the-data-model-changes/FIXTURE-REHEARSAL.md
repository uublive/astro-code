# FIXTURE-REHEARSAL — proved by hand, not by test

## Part 1 (t14) — a canon-only project is self-sufficient, and the check reads its declaration

**Scratch project:** `/Users/buu/Development/astro-scratch-p17/` (outside this repo — no
worktree dirtied). Assembled from the shipped canon alone: a verbatim copy of
`templates/RUN-CONTRACT.md`, a two-line `CONVENTIONS.md` pointing at it, and (once `ac` itself
needed a project root to run against — an unrelated, generic `ac` precondition, not a
fixtures-layer concern) a minimal `.astrocode/state.json`. No astro-code source checkout is
reachable from inside the scratch tree; `ac` was invoked by absolute path from outside it.

### (a) What must happen to fixtures, read from `RUN-CONTRACT.md` §10 alone

> When a phase adds a table, a column, or any new persisted shape, the one-command cold start
> (§1) must come up holding the state that phase's acceptance items assume — extend the
> fixtures at the §8 seam so the seed script still produces that state.

Stated as an outcome (state the booted app holds), never as "edit the seed file" — matches
the rule as pinned.

### (b) Where and in what format to declare, read from §10 alone

A marker line `<!-- astro-code: fixtures-declaration -->` followed by two keys, one per line,
each a comma-separated list of repo-relative paths; a trailing `/` means "this directory and
everything under it". Live-but-empty as shipped; a worked example is given directly below the
live block.

### Commands run, verbatim, in order

```
$ cd /Users/buu/Development/astro-scratch-p17 && git init -q
$ git config user.email test@test.com && git config user.name test
$ cp /Users/buu/Development/astro-code/templates/RUN-CONTRACT.md ./RUN-CONTRACT.md
$ printf '# CONVENTIONS.md\n\n## Run contract\n\nSee RUN-CONTRACT.md at the project root.\n' > CONVENTIONS.md
```

Filled the declaration block (only the live block, not the worked example below it) using
nothing but the (a)/(b) reading above — a migrations directory and a single seed script,
following §10's own worked-example shape:

```
<!-- astro-code: fixtures-declaration -->
data-model: db/migrations/
seed: scripts/seed.mjs
```

```
$ git add -A && git commit -q -m "chore: initial canon (phase 17 t0)"
```

First `ac fixtures check` attempt, **before** adding `.astrocode/`:

```
$ node /Users/buu/Development/astro-code/bin/ac.mjs fixtures check --phase 17
✖ no .astrocode/ found — run `ac init` first
EXIT=1
```

Not a fixtures-layer defect: every `ac` verb needs a project root (`.astrocode/`), and every
real project scaffolded by `/astro-new-project` has one from `ac init` in step 1 — the
rehearsal's "canon alone" scope is about the *fixture rule and declaration* being
self-sufficient from `RUN-CONTRACT.md` + `CONVENTIONS.md` without the astro-code source
checkout, not about skipping `ac init`. Added the minimal state file and re-ran:

```
$ mkdir -p .astrocode
$ printf '{\n  "project": "scratch",\n  "status": "active",\n  "active_phase": "17"\n}\n' > .astrocode/state.json
$ git add -A && git commit -q -m "chore: add minimal .astrocode state (phase 17 t0)"
$ node /Users/buu/Development/astro-code/bin/ac.mjs fixtures check --phase 17
(no output)
EXIT=0
```

Clean, as expected — no phase-17-stamped commit had yet touched the declared data-model path.

Landed a phase-17-stamped commit touching only the declared `data-model` path:

```
$ mkdir -p db/migrations
$ printf 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);\n' > db/migrations/0001_add_widgets.sql
$ git add -A && git commit -q -m "feat(db): add widgets table (phase 17 t20)"
$ node /Users/buu/Development/astro-code/bin/ac.mjs fixtures check --phase 17
⚠ stale fixtures — phase 17 changed db/migrations/ and no declared seed source changed
EXIT=0
```

Fired, correctly attributed to phase 17 and naming the exact declared path — never
"not checked". Debt was filed by the verb itself (`.astrocode/debt.json` in the scratch
project), one open item titled `stale fixtures: db/migrations/ changed without the declared
seed source`, phase-invariant per the pinned title.

### Verdict

Reading `templates/RUN-CONTRACT.md` §10 and the generated project's `CONVENTIONS.md` alone
was sufficient to write a correct declaration and to predict, then observe, both a clean and
a fired outcome — never "not checked" for an opted-in project. **No defect found**: no change
was needed to `templates/RUN-CONTRACT.md`, `lib/fixtures.mjs`, or `commands/astro-new-project.md`.
The scratch tree is left in place at `/Users/buu/Development/astro-scratch-p17/` for t15 to
extend, per the plan's wave ordering (t14 → t15 on this same file).
