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

## Part 2 (t15) — the criterion actually discriminates stale fixtures from current ones

**Probe first, as required.** `host "docker compose version"` → `Docker Compose version
v5.3.1`. The bridge and Docker are reachable in this session, so the live path was driven
end to end — no honesty-register gap to report.

**Extended the same scratch project** at `/Users/buu/Development/astro-scratch-p17/` into a
real app-shaped, data-persisting project: `Dockerfile`, `docker-compose.yml` (services `db`
— `postgres:16-alpine` with a `pg_isready` healthcheck —, `seed`, `app` — a plain
`node:http` server with `/health`, `/widgets`, `/gadgets`), `package.json` (the `pg`
driver), `server.mjs`, and `scripts/seed.mjs` (applies every `db/migrations/*.sql` file in
order, then inserts fixtures at a marked `--- fixture seam ---` block, matching §8/§10's
seam). `db/migrations/0001_add_widgets.sql` (from t14) became
`CREATE TABLE IF NOT EXISTS widgets (id INTEGER PRIMARY KEY);` so the migration runner is
idempotent on every cold start. All of this scaffolding, plus the original widgets
fixture, was committed **unstamped** (`chore: initial canon + app scaffold …`, no
`(phase 17 tN)` in the subject) — it represents the pre-existing app the phase begins
against, not phase 17's own change, so it must not appear in phase 17's stamped-commit
diff range (D8).

### Commands run, verbatim, in order

Baseline cold start, before any schema change — confirms the harness itself is sound:

```
$ host "docker compose up -d --build"
 … Container astro-scratch-p17-db-1 Healthy
 … Container astro-scratch-p17-app-1 Started
$ host "docker compose ps"
NAME                      STATUS
astro-scratch-p17-app-1   Up (healthy)
astro-scratch-p17-db-1    Up (healthy)
$ host "curl -s http://localhost:3897/health"
{"ok":true}
$ host "curl -s http://localhost:3897/widgets"
[{"id":1},{"id":2},{"id":3}]
```

Landed the schema change — a new `gadgets` table — as the **only** phase-17-stamped commit
touching a declared data-model path, and **left the seed untouched**:

```
$ cat > db/migrations/0002_add_gadgets.sql <<'SQL'
CREATE TABLE IF NOT EXISTS gadgets (id INTEGER PRIMARY KEY, name TEXT);
SQL
$ git add db/migrations/0002_add_gadgets.sql
$ git commit -q -m "feat(db): add gadgets table (phase 17 t22)"
```

Advisory layer, checked immediately:

```
$ node /Users/buu/Development/astro-code/bin/ac.mjs fixtures check --phase 17
⚠ stale fixtures — phase 17 changed db/migrations/ and no declared seed source changed
EXIT=0
$ node /Users/buu/Development/astro-code/bin/ac.mjs debt list --json
[{ "title": "stale fixtures: db/migrations/ changed without the declared seed source",
   "status": "open", "phase": "17", "file": "db/migrations/", … }]
```

Real cold start, fixtures **not** extended — the criterion's own check:

```
$ host "docker compose down -v"
$ host "docker compose up -d --build"
 … Container astro-scratch-p17-db-1 Healthy
 … Container astro-scratch-p17-app-1 Started
$ host "docker compose ps"
NAME                      STATUS
astro-scratch-p17-app-1   Up (healthy)
astro-scratch-p17-db-1    Up (healthy)
$ host "curl -s http://localhost:3897/health"
{"ok":true}
$ host "curl -s http://localhost:3897/gadgets"
[]
```

The app came up **healthy** and the query for the state the (hypothetical) acceptance item
assumes — "a gadget exists" — returned **empty**, not a boot failure and not a non-zero seed
exit. **The criterion FAILS**, exactly as required — a healthy-but-empty result, never
mistaken for "not checked".

Extended the seed's fixtures at the declared seam, changing nothing else:

```
$ git diff scripts/seed.mjs
+  await pool.query(
+    "INSERT INTO gadgets (id, name) VALUES (1, 'Sprocket'), (2, 'Widgetron') ON CONFLICT (id) DO NOTHING",
+  );
$ git add scripts/seed.mjs
$ git commit -q -m "feat(seed): extend fixtures for gadgets (phase 17 t23)"
```

Advisory layer, re-checked — now agrees the phase is current:

```
$ node /Users/buu/Development/astro-code/bin/ac.mjs fixtures check --phase 17
(no output)
EXIT=0
$ node /Users/buu/Development/astro-code/bin/ac.mjs debt list --json
[{ "title": "stale fixtures: db/migrations/ changed without the declared seed source", … }]
```

(Still exactly one open item — filed once, from the fired run above; extending fixtures
doesn't retroactively close it, matching C3's register semantics. The check itself is
clean going forward.)

Real cold start, fixtures extended — same schema, same query, nothing else changed:

```
$ host "docker compose down -v"
$ host "docker compose up -d --build"
 … Container astro-scratch-p17-db-1 Healthy
 … Container astro-scratch-p17-app-1 Started
$ host "docker compose ps"
NAME                      STATUS
astro-scratch-p17-app-1   Up (healthy)
astro-scratch-p17-db-1    Up (healthy)
$ host "curl -s http://localhost:3897/health"
{"ok":true}
$ host "curl -s http://localhost:3897/gadgets"
[{"id":1,"name":"Sprocket"},{"id":2,"name":"Widgetron"}]
$ host "curl -s http://localhost:3897/widgets"
[{"id":1},{"id":2},{"id":3}]
```

**The criterion PASSES** — same migration, same fresh volume, same query; the only change
between the FAIL and PASS runs was the seed's fixture content at the declared seam.

Tear down and delete:

```
$ host "docker compose down -v"
$ rm -rf /Users/buu/Development/astro-scratch-p17
```

### A scoping note, not a defect

The advisory check (layer 3) reads *all* of a phase's stamped commits as one unordered set:
"did any stamped commit touch the declared seed path at all", not "did a seed-touching
commit follow the last data-model-touching one". That is why the unstamped baseline commit
in this rehearsal (which touches both `db/migrations/` and `scripts/seed.mjs`) had to
predate phase 17's own stamped commits rather than carry a `(phase 17 t0)` subject — a
stamped commit touching seed anywhere in the phase's history reads as "seed kept up" for
the rest of that phase, by the pinned Fired-condition wording (`PLAN.md`'s pinned-values
table), regardless of commit order. This matches D1's framing exactly: the advisory layer
is a coarse, best-effort net for the lanes a criterion never reaches, **not** the
enforcement mechanism — the cold-start criterion exercised above has no such blind spot,
because it observes the booted app's actual state rather than a commit-set union. No change
was made to `lib/fixtures.mjs` on this basis (out of scope for this task's declared files,
and consistent with the pinned spec, not a bug in it).

### Verdict

The behavioural criterion — a query against a real, freshly-booted cold start for the state
an acceptance item would assume — discriminates stale fixtures from current ones exactly as
CONTEXT.md D1/D11 and CRITERIA.md C5 require: healthy-but-absent when the schema outran the
seed, healthy-and-present once the seed caught up, with no other change in between. The
advisory check agreed at both checkpoints once its phase-scoped, commit-order-insensitive
semantics were accounted for. **No defect found** in `templates/RUN-CONTRACT.md` or
`agents/astro-criteria-author.md` — both were followed as written and produced the expected
outcomes, so neither file changed as part of this task.
