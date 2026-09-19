# PLAN — Phase 16: A project is born runnable with fixtures

Everything here lives in the **prose layer** (`templates/`, `commands/`, `agents/`, README)
plus `tests/` and one ADR. **No task touches `lib/`, `bin/ac.mjs` or `workflows/*.mjs`** —
ADR-048/CONTEXT D4 make that a hard architectural constraint, not a preference:
`bin/ac.mjs:404-432` records why even a single `.gitignore` line was pushed out of `lib/`
("dirtied the tree for every lib consumer and made `ac flow branch` refuse straight after a
scaffold"). A task that adds a Dockerfile generator under `lib/` is a defect, not a shortcut.

**Testing strategy (declared, per ADR-018): test-after serialization, not RED-first.** The
behaviour this phase adds is prose interpreted by an agent; the only automatable bar is the
doc-guard pattern already in `tests/commands.test.mjs` / `tests/contracts.test.mjs`, which by
construction asserts on text that must already exist. The guard task (t8) therefore
`depends_on` the doc tasks. No task statically imports a symbol that does not yet exist; the
one dynamic import (`await import('../lib/install.mjs?…')` in t8) is already the house pattern
in `tests/install.test.mjs`. The real bar for this phase is not a unit test at all — it is the
live cold start (t10/t11), exactly as ADR-048 intends ("booting it IS the check").

**Wave-green:** every task is purely additive to a file that already parses. Nothing is
deleted or renamed, so no task can leave a wave boundary non-compiling.

---

## Normative values — pinned here so parallel tasks converge without templates

D5 bans templates, so `RUN-CONTRACT.md` is the only consistency mechanism between generated
projects — and this section is the only consistency mechanism between the tasks that write
about it. **Every task below must use these exact values verbatim.** C4 fails the phase if the
contract document, the generated canon, and the shipped compose file disagree on any of them.

| Thing | Pinned value |
|---|---|
| Start command | `docker compose up` (a `-d` is the user's choice) — nothing before it, ever |
| Web service name | `app` |
| Seed service name | `seed` |
| Database service name (only when the project persists data, D13) | `db` |
| Compose file | `docker-compose.yml` at repo root, **no top-level `version:` key** (Compose v2 ignores it) |
| Minimum tooling | Docker Compose **v2.1.1+** — below it `service_completed_successfully` is silently ignored and `app` starts before `seed` finishes, breaking C1 invisibly outside the proving machine |
| Published port | `ports: ["${APP_PORT:-<container port>}:<container port>"]` — readable straight off the compose file (C1) while still overridable without editing a file, so a busy host port never fails a cold start for a reason unrelated to the contract |
| Health | `app` declares a `healthcheck`; `db` (when present) declares its own (`pg_isready`-style) |
| Dependency graph (all three edges, stated explicitly) | `app.depends_on.seed: service_completed_successfully`; when a `db` exists also `seed.depends_on.db: service_healthy` **and** `app.depends_on.db: service_healthy` |
| Seed service shape | one-shot, **must exit 0**; `command` delegates to the stack-native script (`npm run seed`, `make seed`, …), never re-implements it |
| Consent variable | **`RUN_SEED`**, accepted value the exact string **`true`**, compared with strict string equality (`=== 'true'` / `[ "$RUN_SEED" = "true" ]`) — never truthiness, never `NODE_ENV`, never "the database looks empty" |
| Reset fork | default `docker-compose.yml` = named persistent volume, seed invoked **without** `--reset` (local dev keeps developer data); `docker-compose.preview.yml` **override** (`-f docker-compose.yml -f docker-compose.preview.yml`) = ephemeral volume + `--reset` |
| Repair budget | one boot attempt + **at most 2 repair attempts** (3 boots maximum), then report honestly |
| The three report stems (must be literally distinguishable, C7) | `Cold start verified — …` / `Cold start NOT verified — Docker unavailable …` / `Cold start FAILED after N attempt(s) — …` |
| Secrets | non-secret dev defaults live in compose (`${VAR:-default}`); `.env.example` is committed **with the dev values filled in**, not blank keys; a fresh clone needs no `.env` at all |

Two choices this plan makes that ADR-048/049/050 left open, and why (t9 records them):

- **`RUN_SEED=true`** — reads unambiguously as "run the seed" and cannot be confused with an
  environment name the way `SEED_ENV`/`NODE_ENV` can. One positive assertion, one function,
  one comment saying why (D7). Not a safety ladder: an elaborate ladder written once at
  new-project time for an arbitrary stack is the first thing to rot.
- **Two repair attempts** — "bounded and small" (D6). Bounded is the load-bearing half: C7
  fails on unbounded/looping retries, and an agent that keeps trying is indistinguishable from
  one that is stuck.

---

## t1 — Write the run contract: `templates/RUN-CONTRACT.md`

- **file:** `templates/RUN-CONTRACT.md` (new)
- **depends_on:** —

The keystone. Mirror `templates/kit/KIT-CONTRACT.md` in shape and tone: condensed,
prescriptive, opening with a line in the spirit of "Every agent working on this project must
respect it." Not narrative — a requirements list an agent can execute against an arbitrary
stack.

**Location is deliberate: flat in `templates/`, next to `forge-knowledge.md`, NOT in a new
`templates/run/`.** D5 bans a `templates/run/` skeleton tree, and a directory named `run/`
invites exactly the skeletons it bans. Flat also matches the `forge-knowledge.md` precedent: a
shipped *spec* read via `` `$(ac path templates)/RUN-CONTRACT.md` ``, which `copyTree`
(`lib/install.mjs:205`) already ships to `~/.astro/code/templates/` with no registration —
placing it under `commands/` or `agents/` would make it a phantom slash command. It is **not**
added to the `ac init` copy list in `lib/planning.mjs:89` (that would put it in every library
project, violating C5, and would need a `lib/` change, violating D4).

Content, in this order — a reader with **only this file** must be able to produce a conforming
project for a stack it never names (that is literally C4(a)):

1. **The promise.** A fresh clone reaches a healthy, seeded app with `docker compose up` and
   nothing else. If a tester has to fill in a value first, it was never one command.
2. **The files.** `Dockerfile` + `docker-compose.yml` at the repo root. Why convention and not
   a manifest: a manifest is a second source of truth that can claim "start with X" while
   compose says Y, invisible until a preview comes up dead — booting compose *is* the check,
   and these are real Docker semantics the fleet speaks without knowing astro-code exists.
3. **The services** — every pinned value from the table above: names, healthchecks, the port
   expression, the three dependency edges, the Compose 2.1.1 floor, no `version:` key. State
   plainly that the `seed` service must **exit 0** — "wired but empty" still has to terminate
   or `service_completed_successfully` never fires and the app never starts.
4. **The seed.** Separate script, invoked by the dev/preview entrypoint, **never imported by
   the app's boot path** — production cannot run it by accident because production never calls
   it. One positive assertion on `RUN_SEED === 'true'` with a comment saying why, and the two
   explicit non-signals (`NODE_ENV`, "the database looks empty"). Idempotent: fixed ids and
   the stack's native upsert (`ON CONFLICT DO NOTHING`, `upsert()`, `find_or_create`,
   `get_or_create`) — never a hand-rolled existence check, never `uuid4()`/autoincrement in
   fixture data, or the "same known state every preview" guarantee dies. Fixtures are **plain
   source the repo can diff, review and merge — never a committed binary database file** (a
   staged binary once produced a patch that could not be replayed and killed a run outright).
5. **Reset keyed to the volume**, with the override-file mechanism spelled out. Say why the
   fork exists: preview containers are ephemeral so resetting buys the identical known state
   that makes ephemerality worth having; wiping a developer's working data on
   `docker compose up` is a bug, not a feature. Recommend the override file over a second
   hand-maintained full compose file — two divergent compose files are the same drift D1 was
   written to prevent, just moved one level down.
6. **Zero-configuration boot** and the `.env.example` rule (filled dev values, not blank keys).
7. **Third-party integrations are stubbed in dev and preview** — a preview needs no real
   credentials and can never reach a real third party. Give one or two concrete named shapes
   so agents converge without a template: (a) preferred — an in-process fake swapped in at the
   seam the real client is already imported from, behind its own positive variable
   (`USE_FAKE_INTEGRATIONS=true`, defaulted in compose); (b) a local stub service in compose,
   only when the integration is genuinely out-of-process. Do not reach for WireMock/Prism-class
   tooling at birth.
8. **At birth the seed is wired but empty** (D11): it exists, runs, exits 0 as a no-op, and
   carries a clearly marked seam where the first data-model phase adds fixtures. No invented
   placeholder records — fake data someone has to remember to delete. Name the seam explicitly;
   phase 17 needs a stable entry point to write a criterion against.
9. **Who this applies to.** App-shaped projects only. A library or CLI gets none of it — a
   Dockerfile in a library is noise.

Voice: CONVENTIONS.md "Voice" — say *why* a rule exists and which failure it prevents.

## t2 — `/astro-new-project`: the shape fork and the scaffolding it gates

- **file:** `commands/astro-new-project.md`
- **depends_on:** —

Extend the existing step 4 interview (the requirements/constraints step) with the fork, then
add a new scaffold step after it. Keep the file's register: short numbered imperative steps
that delegate authorship to the agent — no inline Dockerfile, no compose snippet, no template
(D5). Reference the contract as `` `$(ac path templates)/RUN-CONTRACT.md` ``, never restate it
(a restatement is drift bait — the `forge-knowledge.md` precedent).

- **The fork (D3):** one `AskUserQuestion` — runnable app, or library/CLI? Library/CLI is a
  hard stop for everything container-shaped: no Dockerfile, no compose, no seed, no contract
  copy, no run-contract canon (C5). astro-code itself would answer "library".
- **If app-shaped, two more answers** the scaffold needs: does it persist data (D13 — a `db`
  service only then; no dead service in a stateless app), and which third parties it talks to
  (D14 — each gets a fake).
- **Author the contract artifacts** per `RUN-CONTRACT.md` for the actual stack: `Dockerfile`,
  `docker-compose.yml`, `docker-compose.preview.yml`, the stack-native seed script (wired,
  no-op, guarded by `RUN_SEED`, accepting `--reset`, with the fixture seam marked), the
  stack-native task entry it delegates to (`npm run seed` / `make seed` / …), and
  `.env.example`. State the pinned values in the step so the agent cannot invent its own
  service name or variable.
- Say once, in the command, that this is written by the agent and never by `ac`/`lib/`, and
  why (D4) — the next person to "tidy this into a helper" needs to hit that sentence.

## t3 — `/astro-new-project`: prove the cold start, repair it, report honestly, seed the canon

- **file:** `commands/astro-new-project.md`
- **depends_on:** t2

Same file as t2, therefore serialized — never both in one wave.

- **Probe Docker first:** `docker compose version` via Bash; a non-zero exit or "command not
  found" means absent. Absent → **skip the boot, never block project creation**, and print the
  `Cold start NOT verified — Docker unavailable …` line (C7a). Present → attempt
  `docker compose up -d` once.
- **Check what actually came up**, never that files exist: `docker compose ps` shows `app`
  **healthy** and `seed` **exited 0**, and a request to the published port returns the app's
  response. An unrun Dockerfile is worse than none — it looks like a contract and isn't one.
- **Bounded repair:** on failure, diagnose, fix, retry — **at most 2 repair attempts**. Then
  stop and print `Cold start FAILED after N attempt(s) — <what is still broken>`, naming the
  defect. The final summary must not read as success.
- **Always tear down** (`docker compose down -v`) so the scaffold leaves no running containers.
- **Copy `RUN-CONTRACT.md` verbatim to the project root** (not into `.astrocode/`: C4 removes
  `.astrocode/` and the boot must survive, and a human or non-astro agent still needs the
  contract). **Distil it into `.astrocode/CONVENTIONS.md`** as a "Run contract" section — the
  `commands/astro-kit-new.md:70` pattern ("Write CONVENTIONS.md from KIT-CONTRACT.md") —
  carrying the concrete values this project actually shipped: service names, the healthcheck,
  the published port, the seed command, `RUN_SEED=true`, the reset fork, and
  "fixtures are plain source, never a binary database". The distillation must **agree with the
  shipped compose file value for value** (C4b) — say so in the step. Then `ac canon push` (the
  existing step already does this; fold the new section in before the push).
- The library/CLI branch skips this entire step, including the canon section (C5).
- The three report stems must be verbatim as pinned, so the three outcomes are distinguishable
  at a glance and by a guard (C7).

## t4 — `/astro-adopt`: detect shape from the map, adapt to the seeding already there

- **file:** `commands/astro-adopt.md`
- **depends_on:** —

Insert a step between the existing step 3 (draft canon) and step 4 (record decisions), keeping
the file's brevity.

- **No shape interview** (D3). The **astro-mapper** report (already spawned at step 2) decides:
  app-shaped if there is a server entry point / HTTP framework dependency / a start script that
  serves / an existing container image that exposes a port. Library or CLI-only → add nothing
  and say so in one line, without asking (C5 fails if adopt interrogates an unambiguous case).
- **Bar for "genuinely ambiguous"** — ask only when one of these holds, so the bar does not get
  re-invented per run: no entry point suggesting a long-running process; several plausible
  services with no obvious primary; or an existing compose file with no clearly web-facing
  service.
- **Adapt, never replace (C6).** If the project already seeds itself, the `seed` service
  **delegates to that existing command unchanged** — never rewrite, duplicate or bypass it, and
  its pre-existing fixtures must still load. If that entry point has no consent guard of its
  own, add the `RUN_SEED` assertion in a **small committed wrapper script that the compose
  service calls** (the one layer of indirection D10 already blesses), leaving the project's own
  `make seed` / `npm run seed` working exactly as before for a human who types it — and note
  the residual gap in the report rather than silently changing their entry point's contract.
- **Existing compose with a differently-named web service:** the fleet requires the name `app`,
  but silently renaming a service that the project's CI refers to is a breaking change.
  Therefore: `AskUserQuestion` before renaming, and if the user agrees, update **every in-repo
  reference** to the old name (CI config, scripts, docs) in the same change. If they decline,
  say plainly in the report that the contract does not hold.
- Missing pieces only: an existing healthcheck, port mapping or Dockerfile that already
  conforms is kept as-is.

## t5 — `/astro-adopt`: attempt the cold start, report it honestly, seed the canon

- **file:** `commands/astro-adopt.md`
- **depends_on:** t4

Same file as t4, therefore serialized.

- Attempt the cold start **once** with the same Docker probe and the same three report stems,
  and the same bounded 2-attempt repair budget as t3. Adopt "must never claim the contract
  holds because it merely saw a compose file" (D6) — the report says what was observed, and for
  an adopted project it must also state that the **pre-existing fixtures were present in the
  running app** (C6), or that they were not.
- Copy `RUN-CONTRACT.md` verbatim to the project root and distil the same "Run contract"
  section into `.astrocode/CONVENTIONS.md`, carrying this project's real values (including the
  project's own seed command, not a generic one), before the existing `ac canon push` step.
- Library-shaped projects skip all of it, silently and without a question.

## t6 — astro-mapper reports run shape and the seeding that already exists

- **file:** `agents/astro-mapper.md`
- **depends_on:** —

Add to the report structure (keep the file's terse bullet style, read-only role unchanged):
**Run shape** — app-shaped (something long-running that serves) vs library/CLI, with the
evidence; and what container/seed machinery already exists (Dockerfile, compose and the name of
its web service, a `seed`/`db:seed`/`make seed` target and what it loads). This is the signal
`/astro-adopt` decides on instead of interviewing the user (D3), so an unstated conclusion here
turns into a question there.

## t7 — Cross-references: README and `/astro-help`

- **file:** `README.md`, `commands/astro-help.md`
- **depends_on:** —

One line each, matching the existing compact style: `/astro-new-project` and `/astro-adopt` now
give an app-shaped project a one-command container contract (`docker compose up` → healthy,
seeded app) and leave a `RUN-CONTRACT.md` behind. **Do not touch `AGENTS.md`** — its
`<!-- astro-code -->` block is generated from `templates/AGENTS.md` by `lib/agentsmd.mjs` and a
hand edit is overwritten; and that template ships into every project including libraries, where
a run-contract mention would be false.

## t8 — Doc guards: the contract ships, and the three outcomes stay distinguishable

- **file:** `tests/commands.test.mjs`, `tests/install.test.mjs`
- **depends_on:** t1, t3, t5, t6

Test-after by design (see the declared strategy above). Cheap static guards only — they protect
against silent deletion of load-bearing prose, they do **not** pretend to prove the boot.

- In `tests/install.test.mjs`, extend the existing "ships templates/forge-knowledge.md" test
  (same `await import('../lib/install.mjs?…')` idiom) to assert `RUN-CONTRACT.md` lands at
  `~/.astro/code/templates/RUN-CONTRACT.md`, is non-empty, and is **not** registered as a
  command or agent — an installed user must never hold a pointer to a file they don't have.
- In `tests/commands.test.mjs`, guard that `commands/astro-new-project.md` and
  `commands/astro-adopt.md` each contain all three report stems (`Cold start verified`,
  `Cold start NOT verified`, `Cold start FAILED`) — C7 fails if the three outcomes are worded
  the same — plus the pinned `RUN_SEED` consent variable and the
  `service_completed_successfully` edge, and that `templates/RUN-CONTRACT.md` itself states the
  service names `app`/`seed`, `RUN_SEED`, the Compose 2.1.1 floor and the `--reset` fork.
  Failure messages in the house style: say which invariant was lost and why it mattered.
- Run the full `npm test` — the suite must be green, including `tests/contracts.test.mjs`,
  which cross-checks every `/astro-…` and `ac …` token the new prose introduces.

## t9 — Record the two choices this plan settled, as one ADR

- **file:** `.astrocode/DECISIONS.md`
- **depends_on:** —

`ac decision add "<title>" --why "…" --rejected "…"` (shared orphan branch; sole owner of this
file in the plan, so no other task may run `ac decision add`). One ADR covering the three
specifics ADR-048/049/050 left to the planner — do not relitigate anything they settled:

- `RUN_SEED=true`, strict string equality, as the single positive consent assertion —
  **rejected:** `SEED`/`SEED_ENV` (confusable with an environment name), any multi-condition
  safety ladder (rots first, unreviewable across arbitrary stacks).
- Exactly 2 repair attempts after the first boot (3 boots maximum) — **rejected:** unbounded
  retry (C7 fails it, and a looping agent is indistinguishable from a stuck one).
- Adopt wraps, never rewrites, an unguarded existing seed entry point, and renames an existing
  web service to `app` only after asking — **rejected:** editing the project's own seed command
  in place (breaks the command a developer types daily, C6) and silent renaming (breaks their
  CI without telling them).

## t10 — Rehearse the cold start for `/astro-new-project`, and fix what it breaks

- **file:** `commands/astro-new-project.md`, `templates/RUN-CONTRACT.md`,
  `tests/commands.test.mjs`,
  `.astrocode/phases/16-a-project-is-born-runnable-with-fixtures/COLD-START-REHEARSAL.md` (new)
- **depends_on:** t8

The phase's real proof. With no manifest and no template, the live boot carries 100% of the
correctness burden that a validator normally shares — so rehearse it here rather than
discovering it at verify.

- **Where:** a scratch repo at `/Users/buu/Development/astro-scratch-p16/app-shaped/` —
  **outside this repo** (so no worktree is dirtied and `ac flow branch` cannot refuse) and under
  `/Users/buu/Development` (the only tree the host sees). Docker is **not** in this container:
  run every docker command through the host helper, which preserves the working directory —
  `host docker compose up -d`, `host docker compose ps`, `host curl -sS localhost:<port>`.
- **Drive `commands/astro-new-project.md` as written** — read the steps and execute them
  yourself against the scratch repo, answering the interview inline for an app-shaped project
  that persists data. If the instructions as written do not get you to a healthy, seeded app,
  **that is the defect**: fix the command prose and/or `RUN-CONTRACT.md`, not the scratch
  project. Any fix that contradicts a t8 guard must update the guard in the same commit (that
  is why this task declares `tests/commands.test.mjs`).
- **Also rehearse the library/CLI answer** in `/Users/buu/Development/astro-scratch-p16/lib-shaped/`:
  it must produce no container or seed scaffolding and no run-contract canon (C5).
- Confirm the fixture seam works end to end: add one record at the seam, `up` again, see it
  served — and run the seed twice to confirm the no-op stays a clean no-op (idempotency at
  birth is vacuous by construction; report it as "the no-op ran twice and left state
  unchanged", never as "fixtures are proven idempotent").
- **Write `COLD-START-REHEARSAL.md`**: what was run, what came up (service states, port, the
  response), what was fixed and why. This is the honest record, and the same honesty rule as
  C7 applies to it — if the host bridge or Docker is unavailable, say exactly that and change
  nothing else. Tear down (`host docker compose down -v`) and delete the scratch tree.

## t11 — Rehearse `/astro-adopt` against a project that already seeds itself

- **file:** `commands/astro-adopt.md`, `templates/RUN-CONTRACT.md`, `tests/commands.test.mjs`,
  `.astrocode/phases/16-a-project-is-born-runnable-with-fixtures/COLD-START-REHEARSAL.md`
- **depends_on:** t10

Same files as t10, therefore serialized.

- Build a scratch app-shaped repo at `/Users/buu/Development/astro-scratch-p16/adopt-target/`
  that **already** has its own seeding (a `make seed` / `npm run seed` loading checked-in SQL or
  JSON fixtures) and no container contract. Drive `commands/astro-adopt.md` as written, then run
  the single documented start command through the host helper: `app` healthy, `seed` exited 0
  first, and the **pre-existing fixture records present in the running app**. Then invoke the
  project's original seed command directly and confirm it still works unchanged (C6).
- Fix the adopt prose / contract where reality disagrees, keeping t8's guards green.
- Append the observed outcome to `COLD-START-REHEARSAL.md`. Tear down and delete the scratch
  tree.

---

## Waves

| Wave | Tasks |
|---|---|
| 1 | t1, t2, t4, t6, t7, t9 |
| 2 | t3, t5 |
| 3 | t8 |
| 4 | t10 |
| 5 | t11 |

Same-file pairs are serialized by `depends_on`, never co-scheduled: `astro-new-project.md`
(t2 → t3 → t10), `astro-adopt.md` (t4 → t5 → t11), `RUN-CONTRACT.md` (t1 → t10 → t11),
`tests/commands.test.mjs` (t8 → t10 → t11), `COLD-START-REHEARSAL.md` (t10 → t11).

## Criteria coverage

| Criterion | Tasks |
|---|---|
| C1 one-command healthy seeded boot | t1, t2, t3, t10 |
| C2 consent variable only, never the boot path | t1, t2, t8, t10 |
| C3 idempotent fixtures, volume-keyed reset | t1, t2, t10 |
| C4 contract sufficient, matches reality, survives removing `.astrocode/` | t1, t3, t5, t10 |
| C5 library/CLI gets none of it | t2, t4, t6, t10 |
| C6 adopt adapts to existing seeding | t4, t5, t6, t11 |
| C7 honest cold-start reporting | t3, t5, t8, t10 |
