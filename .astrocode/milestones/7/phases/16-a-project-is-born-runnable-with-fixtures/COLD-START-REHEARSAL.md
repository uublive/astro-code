# Cold-start rehearsal — phase 16

Honest record of driving `commands/astro-new-project.md` against a scratch repo, per
the same honesty rule C7 holds the command prose to.

## t10 — `/astro-new-project`, app-shaped

**Where:** `/Users/buu/Development/astro-scratch-p16/app-shaped/` (outside this repo,
deleted after the rehearsal).

**What was run.** `ac init --name "cold-start-rehearsal"` (works fine — no Docker
involved). Drove steps 2-4 of `astro-new-project.md` by hand: wrote `PROJECT.md` /
`CONVENTIONS.md` for an app-shaped, data-persisting Node/Express + Postgres todo API
with one stubbed third party (an email notifier). Then drove step 4a exactly as written:
read `templates/RUN-CONTRACT.md` and authored, for that stack, `Dockerfile`,
`docker-compose.yml`, `docker-compose.preview.yml`, `scripts/seed.mjs` (delegated to by
`npm run seed`, guarded by `RUN_SEED === 'true'`, idempotent via
`ON CONFLICT DO NOTHING`, `--reset`-aware, with the fixture seam marked), and
`.env.example` with dev values filled in — using the pinned service names (`app`,
`seed`, `db`), the `${APP_PORT:-3000}:3000` port expression, both
`service_completed_successfully` (`app` on `seed`) and `service_healthy` (`seed` and
`app` on `db`) edges, and no top-level `version:` key.

**What could NOT be run, and why.** Step 4b's live boot check (`docker compose up -d`,
`docker compose ps`, the port curl) requires Docker, which is not present inside this
container — by design, every docker invocation is meant to go through this
environment's `host` bridge helper (`host docker compose up -d`, per the operator's
environment notes). In this session, both `host` and the underlying `ssh host` fallback
are blocked outright by this session's shell-command sandbox (`lean-ctx`), which refused
every invocation before it reached a shell ("not in the shell allowlist"), including
`docker` directly. This is a harder stop than "Docker unavailable" — the command prose's
own probe (`docker compose version` via Bash) would hit the exact same sandbox wall and
correctly degrade to `Cold start NOT verified — Docker unavailable, skipping the boot
check`, which is the honest outcome this rehearsal is reporting by hand since the probe
itself could not be exercised as a subprocess of this session.

Per the task's own honesty rule, this is reported exactly as that: **the live boot,
repair loop, and fixture-seam-round-trip proof were not executed in this session**
because Docker/the host bridge was unreachable, not because the command prose was
found lacking. No change was made to `commands/astro-new-project.md` or
`templates/RUN-CONTRACT.md` on that basis — inventing a passing (or failing) boot result
would be worse than reporting the gap plainly.

**What the non-live pass DID confirm.** Reading and hand-driving steps 2-4a end to end
turned up no inconsistency between the command prose and `RUN-CONTRACT.md`'s pinned
values (service names, port expression, dependency edges, consent variable, reset fork)
— the scaffold produced above matches the contract value-for-value. One implementation
note surfaced while authoring the preview override that is worth recording here rather
than in the contract (RUN-CONTRACT.md deliberately states the *what*, not the *how*):
making `db`'s volume ephemeral in `docker-compose.preview.yml` needs the service's
`volumes:` key overridden to an empty list (Compose merges service-level list keys by
replacement, not append), not a bind-mount trick — the first draft used one and was
self-corrected before it was ever run.

## t10 — `/astro-new-project`, library/CLI-shaped

**Where:** `/Users/buu/Development/astro-scratch-p16/lib-shaped/` (deleted after the
rehearsal).

`ac init` plus a library-shaped answer to the interview fork (a small parsing library,
no persistence, no third parties). Steps 4a/4b are gated behind "if app-shaped" in the
command prose, so for this answer they are skipped in full: no `Dockerfile`, no compose
file, no seed script, no run-contract section written into `CONVENTIONS.md`. Confirmed
by inspection of the resulting scratch tree (only `.astrocode/`, `PROJECT.md`,
`CONVENTIONS.md` — no container artifacts) — satisfies C5.

## t11 — `/astro-adopt` against a project that already seeds itself

**Where:** `/Users/buu/Development/astro-scratch-p16/adopt-target/` (outside this repo,
deleted after the rehearsal).

**The scratch target.** A small Node/`node:http` app with **no container contract** and
**its own pre-existing seeding**: `package.json` wires `npm run seed` to
`scripts/seed.mjs`, which upserts `fixtures/users.json` (checked-in JSON) into
`data/db.json` by fixed id — idempotent, but with no consent guard of its own (it would
run unconditionally). `server.mjs` serves `/health` and `/users` from that file; nothing
imports the seed script.

**What was run.** `ac init --name "adopt-target"` (non-destructive, step 1). Hand-drove
steps 2-3 (map + draft canon: an actual `astro-mapper` spawn is what a live session would
use; here the shape was read by inspection, same substitution t10 made for the interview)
— confirmed app-shaped (an HTTP entry point serving) with an existing seed command, so no
`AskUserQuestion` per D3/step 4's unambiguous-case rule. Drove step 4 exactly as written:
copied `templates/RUN-CONTRACT.md` verbatim to the project root; authored `Dockerfile`,
`docker-compose.yml` (services `app` + `seed`, no `db` — this project persists to a plain
file, not a database server, matching §3's "only when the project actually persists
[to a DB]" reading), `docker-compose.preview.yml`, and `.env.example`; and, because
`scripts/seed.mjs` had no consent guard, added `scripts/seed-with-consent.mjs` as the
small wrapper the compose `seed` service calls — asserting `RUN_SEED === 'true'`,
supporting `--reset`, then `spawnSync('npm', ['run', 'seed'])` — leaving
`scripts/seed.mjs`/`npm run seed` itself byte-for-byte unchanged, exactly as the "adapt,
never replace" clause requires. Distilled a "Run contract" section into
`.astrocode/CONVENTIONS.md` naming the concrete values (service names, no `db`, the
`RUN_SEED` guard living in the wrapper not the original command, the reset fork).

**Verified by hand (no Docker required for these):** ran `node scripts/seed.mjs` twice
directly — 2 users, no duplication, confirming the original command still behaves exactly
as before adoption (part of C6's "original seed command still works unchanged"). Ran the
wrapper with `RUN_SEED=false` (refuses, exit 0, nothing written — it was already seeded so
this only proves it takes no *additional* action) and with `RUN_SEED=true` (delegates to
`npm run seed`, prints its output unchanged, same idempotent result) — confirming the
wrapper adds exactly one gate around the unmodified original.

**What could NOT be run, and why.** Step 4's live boot check (`docker compose up -d`,
`docker compose ps`, the port curl) requires Docker. As in t10, both the `host` bridge and
`ssh host` are blocked outright by this session's shell-command sandbox before reaching a
shell — the same harder-than-"Docker unavailable" stop t10 hit, for the identical reason.
The command prose's own probe (`docker compose version`) would hit the same wall and
correctly degrade to `Cold start NOT verified — Docker unavailable, skipping the boot
check`. Per the honesty rule, the live boot, the `app`-healthy/`seed`-exited-0 ordering,
and the pre-existing-fixtures-served-by-the-running-app proof were **not executed** in
this session for that reason, not because the command prose was found lacking.

**What the non-live pass DID confirm.** No inconsistency turned up between
`commands/astro-adopt.md` step 4 and `templates/RUN-CONTRACT.md`'s pinned values for this
already-seeding target — no change was needed to either file. The "adapt, never replace"
wrapper-script instruction is concrete enough to follow without invention: wrap, don't
touch the original, and the wrapping is small enough (one env check, one `--reset`
branch, one delegated `spawnSync`) to hand-verify without a container. `npm` was present
in this container so the delegated `npm run seed` call itself could be exercised.

## Scratch trees

Both t10 scratch directories and the t11 `adopt-target` scratch directory were deleted
after their rehearsals; no container was ever started, so there was nothing to
`docker compose down -v`.
