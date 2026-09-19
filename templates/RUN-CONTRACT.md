# Run Contract

Condensed, prescriptive contract for how a generated **app-shaped** project boots. Every
agent working on this project must respect it — it is what lets a fresh clone, a CI runner,
or astro-fleet's ephemeral-preview machinery bring the app up without knowing astro-code
exists, and it stays true even if astro-code is removed from the project entirely. This is
convention, not a manifest: a manifest is a second source of truth that can claim "start
with X" while `docker-compose.yml` says Y, invisible until a preview comes up dead — booting
compose *is* the check, and every rule below is real Docker semantics.

## 1. The promise

A fresh clone reaches a healthy, already-seeded app with:

```
docker compose up
```

and nothing else — no copying `.env`, no exporting a variable, no running migrations by
hand, no second `up`. If a tester has to fill in a value first, it was never one command.

## 2. The files

`Dockerfile` and `docker-compose.yml` at the repo root. Nowhere else, and no second file
that restates what they already say — real Docker semantics are the only thing that cannot
silently drift from what actually boots.

## 3. The services

- **Web service — `app`.** Declares a `healthcheck` so a caller (the fleet, a CI job, a
  tester) knows when the URL is safe to hand over.
- **Seed service — `seed`.** One-shot; `command` **delegates to the stack-native script**
  (`npm run seed`, `make seed`, …) — never reimplements the seeding logic in compose. It
  **must exit 0**. "Wired but empty" still has to terminate, or Compose's
  `service_completed_successfully` condition never fires and `app` never starts.
- **Database service — `db`** — only when the project actually persists data. No dead
  service in a stateless app. Declares its own healthcheck (`pg_isready`-style, or the
  stack's equivalent).
- **Port.** `ports: ["${APP_PORT:-<container port>}:<container port>"]` on `app` — readable
  straight off the compose file by anything that needs to reach it, while still overridable
  without editing a file, so a host port already in use never fails a cold start for a
  reason unrelated to this contract.
- **Dependency graph**, stated explicitly, all edges that apply:
  - `app.depends_on.seed: service_completed_successfully`
  - when a `db` exists, also `seed.depends_on.db: service_healthy` and
    `app.depends_on.db: service_healthy`
- **No top-level `version:` key** — Compose v2 ignores it; a stale value there is a lie with
  no effect, so it is better absent than wrong.
- **Minimum tooling: Docker Compose v2.1.1+.** Below that version,
  `service_completed_successfully` is silently ignored and `app` starts before `seed`
  finishes — the app serves unseeded, which is exactly the failure this contract exists to
  prevent, and it fails invisibly outside a machine that specifically checks for it.

## 4. The seed

A separate script, invoked by the dev/preview entrypoint — **never imported by the app's own
boot path.** Production cannot run it by accident because production never calls it.

Consent is one positive assertion, checked with strict string equality:

```
RUN_SEED === 'true'   // (or the shell equivalent: [ "$RUN_SEED" = "true" ])
```

with a comment saying why. Two signals that must **never** grant consent, because both are
common accidents rather than deliberate intent:

- `NODE_ENV` (or the stack's equivalent "I'm in dev" variable) — `NODE_ENV=development`
  reaching production is a common accident, not evidence anyone meant to seed it.
- "The database looks empty" — an empty-looking database at the instant you check is not
  evidence you are allowed to write to it.

One assertion, one function — deliberately not a multi-condition safety ladder. An elaborate
ladder written once at project-birth time for an arbitrary stack is the first thing to rot;
one assertion is reviewable in ten seconds in any language.

**Idempotent.** Fixed ids, deterministic keys, and the stack's native upsert
(`ON CONFLICT DO NOTHING`, `upsert()`, `find_or_create`, `get_or_create`, …) — never a
hand-rolled existence check, and never `uuid4()`/autoincrement inside fixture data, or the
"same known state every preview" guarantee dies the first time the seed runs twice.

**Plain source, never a binary.** Fixtures are source the repo can diff, review and merge —
never a committed binary database file. A staged binary once produced a patch that could not
be replayed and killed a run outright.

## 5. Reset, keyed to the volume

- **Local dev** — named, persistent volume; seed invoked **without** `--reset`. Wiping a
  developer's working data on `docker compose up` is a bug, not a feature.
- **Preview** — ephemeral volume; seed invoked **with** `--reset`, via a compose **override
  file**: `docker-compose.preview.yml`, applied as
  `-f docker-compose.yml -f docker-compose.preview.yml`. Preview containers are ephemeral so
  resetting on boot buys the one thing that makes ephemerality worth having — every preview
  starts from an identical, known state.

Prefer the override file over a second, hand-maintained full compose file. Two divergent
compose files are the exact same drift this contract's convention-not-manifest choice (§2)
was written to prevent, just moved one level down.

## 6. Zero-configuration boot

Compose carries non-secret dev defaults inline (`${VAR:-default}`) for anything not
genuinely secret — database URL, ports, keys that don't matter in dev. `.env.example` is
committed **with the dev values already filled in**, not blank keys, documenting only what a
real deployment would need to supply for itself. A fresh clone needs no `.env` file at all.

## 7. Third-party integrations are stubbed

Dev and preview never make a real third-party call, so a preview needs no real credentials
and can never write to real external state. Two concrete shapes, so independent agents
converge without a shared template:

- **Preferred** — an in-process fake swapped in at the seam the real client is already
  imported from, behind its own positive variable (e.g. `USE_FAKE_INTEGRATIONS=true`,
  defaulted on in compose).
- **When the integration is genuinely out-of-process** — a local stub service declared in
  compose. Do not reach for WireMock/Prism-class tooling at birth; that is more machinery
  than a wired-but-empty seed needs.

## 8. At birth, the seed is wired but empty

There is no data model yet at scaffold time. The seed script and its compose wiring **exist
and run successfully as a no-op** — so the contract is live and provably working from day
one — and carry a clearly marked seam:

```
// --- FIXTURE SEAM: the first data-model phase adds fixtures here ---
```

No invented placeholder records; fake data is something someone always forgets to delete
later. Name the seam explicitly and keep its entry point stable — a later phase that extends
the fixtures needs a fixed place to write against, not a script it has to relocate first.

## 9. Who this applies to

App-shaped projects only. A library or CLI gets none of this — no `Dockerfile`, no
`docker-compose.yml`, no seed, no run-contract claim in its canon. A Dockerfile in a library
is noise nobody boots.

## 10. Data model & fixtures declaration

**The rule.** When a phase adds a table, a column, or any new persisted shape, the
one-command cold start (§1) must come up holding the state that phase's acceptance items
assume — extend the fixtures at the §8 seam so the seed script still produces that state.
Never phrase this as "edit the seed file": a touched file proves nothing about what the app
actually serves, and a rewritten seed that still produces the old state would satisfy a
file-edit obligation while failing the thing that matters. Fixtures that stop covering the
current data model make the preview empty again even though the machinery works — that is
the exact failure this whole contract exists to prevent.

**The declaration.** Name where the data model lives and where the fixtures that must stay
in step with it come from, so a tool (or a person) can tell a current declaration from a
stale one without guessing. The block below is a marker line followed by two keys, one per
line, each a comma-separated list of repo-relative paths. A trailing `/` on a path means
"this directory and everything under it"; anything else matches that exact path, or that
path used as a directory prefix. No globs, no inference — an empty or missing declaration is
never assumed to mean "nothing to declare".

```
<!-- astro-code: fixtures-declaration -->
data-model:
seed:
```

A worked example, for a project whose schema lives under a migrations directory and whose
seed script is a single file:

```
<!-- astro-code: fixtures-declaration -->
data-model: db/migrations/, prisma/schema.prisma
seed: scripts/seed.mjs
```

Left empty (as shipped), the declaration means "not opted in": `ac fixtures check` (from
astro-code, if present) reports the check was **not run**, never clean — a project that never
declared its paths must never read as passing. This contract, including this section, stands
on its own even if astro-code is removed from the project entirely.
