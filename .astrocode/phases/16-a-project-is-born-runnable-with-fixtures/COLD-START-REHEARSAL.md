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

## Scratch trees

Both scratch directories were deleted after this rehearsal; no container was ever
started, so there was nothing to `docker compose down -v`.

## t11 — not yet run

t11 depends on t10 and is a separate task; see its own entry appended here when it
runs.
