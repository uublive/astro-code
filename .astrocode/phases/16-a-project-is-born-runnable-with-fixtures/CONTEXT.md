<!-- astro-discuss: captured -->

# Context — Phase 16: A project is born runnable with fixtures

## Goal

A fresh clone of a generated project reaches a **running app with realistic data in it**
using **one command**. `/astro-new-project` scaffolds whatever that takes; `/astro-adopt`
adds the same to a project that lacks it.

## Why this exists

astro-fleet is gaining ephemeral previews: after a run opens its PR, the fleet builds the
branch, runs it in a disposable container, and hands a tester a URL that dies a couple of
hours later. An empty app makes that strictly worse than a long-lived staging box — the
tester spends the session creating records by hand, the container is reclaimed, and the
next preview starts empty again. Pay the setup cost every single time.

Fixtures plus disposable inverts it: every preview starts from an identical, known state.
No drift, no "someone deleted the test account", no tester corrupting it for the next one.
That only holds if the fixtures exist and stay current — **staying current is phase 17**.

## Scope

**In scope**
- `/astro-new-project`: scaffold the container contract + a wired seed for app-shaped projects.
- `/astro-adopt`: the same for an existing codebase, adapting to what's already there.
- A `RUN-CONTRACT.md` that states the contract, plus its distillation into the generated
  project's canon.
- Proving the cold start actually works at scaffold time.

**Out of scope**
- Anything the fleet does with the resulting image — building it, proxying it, deciding
  when to reclaim it. This phase defines and produces the contract; the fleet consumes it.
- Enforcement that later phases extend the fixtures — that is **phase 17**, which depends
  on this one.

## Decisions

### D1 — The contract is convention, not a manifest
`Dockerfile` + `docker-compose.yml`, service named **`app`**, a **`healthcheck`** so the
fleet knows when the URL is safe to hand over, and the container port for the proxy. These
are real Docker semantics: the fleet speaks them without knowing astro-code exists, and
they stay true if astro-code is removed from the project entirely.

**Rejected:** a separate machine-readable manifest. It is a second source of truth that can
claim "start with X" while compose says Y, and the drift is invisible until a preview comes
up dead. The compose file cannot lie that way, because booting it *is* the check. Same
reasoning as `ROADMAP.md` being generated so a hand-maintained copy cannot drift.

If the fleet later needs something compose genuinely cannot express, add it then and
**derive** it from the compose file rather than hand-maintain it alongside.

### D2 — The contract is written down in `RUN-CONTRACT.md`, mirroring `KIT-CONTRACT.md`
Scaffolding is agent-authored per stack with **no templates** (D5), so something must state
the contract or every generated project drifts. Mirror the existing kit precedent
(`commands/astro-kit-new.md:46,70`): copy `RUN-CONTRACT.md` **verbatim** into the generated
project so agents working in it have a binding reference, **and** distil it into that
project's `.astrocode/CONVENTIONS.md` so every future planner and executor sees it as canon.

This file is also the **source for the fleet-facing handoff document** shipped with the
major version at the end of phases 16+17 (recorded as a durable note on phase 17).

### D3 — Only app-shaped projects get this
`/astro-new-project` asks one fork in the interview: is this a runnable app, or a
library/CLI? Only app-shaped projects get Dockerfile + compose + seed. astro-code itself
would get none of it, and a Dockerfile in a library is noise.

`/astro-adopt` has no such interview — **astro-mapper** (already spawned there) reports
app-shaped vs library, and adopt raises an `AskUserQuestion` **only when genuinely
ambiguous**. No question in the clear cases.

### D4 — The scaffolding lands in the command layer, never in `lib/`
`lib/` must not write outside `.astrocode/` — `bin/ac.mjs:404-432` is explicit about why:
doing so "dirtied the tree for every lib consumer and made `ac flow branch` refuse straight
after a scaffold." Even the single `.gitignore` line was pushed up into the CLI dispatcher.
So the Dockerfile, compose file and seed script are authored by the **agent running the
command**, the way `PROJECT.md` and `CONVENTIONS.md` already are. This is a hard
architectural constraint, not a preference.

### D5 — Agent-authored per stack, no templates
No `templates/run/` skeletons. The command prose states what the contract requires and the
agent writes it for the actual stack. `RUN-CONTRACT.md` (D2) is what keeps output
consistent in the absence of templates.

### D6 — The cold start is proven at scaffold time, and repaired if it fails
`/astro-new-project` attempts the one command once, **if Docker is available**; when Docker
is absent it skips with a loud note and never blocks project creation.

On failure the agent **attempts repair and retries a bounded number of times**, then reports
honestly what is still broken. An unrun Dockerfile is worse than none — it looks like a
contract and isn't one, and that is exactly what this check exists to prevent.

`/astro-adopt` likewise attempts the cold start once and reports what actually happened —
it must never claim the contract holds because it merely saw a compose file.

### D7 — Seeding is behind positive consent, never detection
The seed script asserts **one condition it was handed deliberately** (an explicit app-env
or seed variable) and refuses otherwise.

- It must **not** key off `NODE_ENV` — `NODE_ENV=development` reaching production is a
  common accident.
- It must **not** use "the database looks empty" as its safety — an empty-looking database
  at the instant you check is not evidence you are allowed to write to it.

One positive assertion, one function, a comment saying why. Deliberately **not** a
multi-condition safety ladder: astro-code generates this for arbitrary stacks, and an
elaborate ladder written once at new-project time is the first thing to rot. One assertion
is reviewable in ten seconds in any language.

The structural half matters more than the flag: **the seeder is a separate script, invoked
by the dev/preview entrypoint, never imported by the app's boot path.** Production cannot
run it by accident because production never calls it.

### D8 — Reset behaviour is keyed to the volume, not to a global policy
The "reload every boot vs load once if empty" fork largely dissolves: preview containers
boot **once** and live a couple of hours, so a boot-time reset already leaves the tester a
whole session to build on their own state. The two goals only collide if the container
restarts mid-session.

- **Preview** — ephemeral volume, nothing to lose → **always reset**. This is what buys the
  identical known state that makes ephemerality the point.
- **Local dev** — persistent volume → **seed only if empty**. Wiping a developer's working
  data on `docker compose up` is a bug, not a feature.

Same script, one `--reset` flag; the preview compose file passes it, the local one does not.

### D9 — Seeds are idempotent, and always plain source
Fixed ids, deterministic keys, upsert semantics. Required anyway for the motivating case: a
fixture that duplicates itself on re-run cannot be the baseline for testing de-duplication.

**Hard constraint from experience: seed by running code, never by committing a pre-built
database file.** A staged binary produced a patch that could not be replayed and killed a
run outright. Fixtures must be plain source the repo can diff, review and merge, loaded by
a script.

### D10 — The seed is wired as a compose dependency that must complete first
The `app` service depends on the `seed` service **completing successfully**, so
`docker compose up` is genuinely one command and the app never serves unseeded. This keeps
seeding out of the app's own boot path (D7) while still satisfying the one-command promise.

**Invocation:** a compose service named `seed` that **delegates to the stack-native script**
(`npm run seed`, `make seed`, …). Uniform for the fleet and for phase 17's criteria;
natural for the developers who type it daily. One layer of indirection, worth it.

### D11 — At birth the seed is wired but empty
At `/astro-new-project` time there is no data model yet. The seed script and its compose
wiring **exist and run successfully as a no-op**, so the contract is live from day one and
the first data-model phase has a seam to fill. No invented placeholder records — fake data
someone has to remember to delete.

### D12 — Zero-configuration boot
Compose carries **non-secret dev defaults** (database URL, ports, keys that don't matter)
so a fresh clone needs nothing at all. A `.env.example` documents anything genuinely secret
for real deployments. If the tester has to fill in values first, it was never one command.

### D13 — Database service only when the project persists data
The interview already establishes whether the project stores anything; scaffold a database
service only when it does. No dead service in stateless apps.

### D14 — Third-party integrations are stubbed in dev and preview
The contract requires external calls to be faked or stubbed, so a preview needs **no real
credentials** and can never reach a real third party. The tester exercises the full flow
against fakes; the fleet never has to hold secrets; a disposable container can never write
to real external state.

## Handoff to phase 17 (do not build it here)

Phase 17 enforces that **every phase touching the data model extends the fixtures**, via
three layers — the rule in `CONVENTIONS.md`, the enforcement as a behavioural `CRITERIA.md`
entry the verifier actually runs, and an advisory diff check covering the lanes that skip
verify (notably `/astro-fast`, where the verifier self-derives its bar). Explicitly **not**
a hard build gate: the only thing one can mechanically see is that a file changed when a
migration changed — forgeable by touching the file, and the exact shape
`agents/astro-criteria-author.md:41` bans as a structural check.

What phase 16 must therefore leave behind for 17 to grip: a **stable seed entry point**
(D10) and a **stated contract** (D2) that a criterion can be written against.

## Open questions / assumptions left to the planner

- The exact guard variable name and accepted values (D7) — any single positive assertion
  satisfies the decision.
- How many repair attempts before reporting failure (D6) — bounded and small.
- Where `RUN-CONTRACT.md` lives in this repo (alongside `templates/kit/KIT-CONTRACT.md` is
  the obvious home) and whether `/astro-adopt` copies the identical file.
- Cross-reference updates (README, `/astro-help`, `AGENTS.md`) — ordinary housekeeping.
- **Assumption:** the fleet is content with the compose convention (D1). If it later needs
  a manifest, that is a follow-up, and it derives from compose rather than duplicating it.

## Debt

Checked at discuss time: 6 open items, none touching the files this phase implicates
(`commands/astro-new-project.md`, `commands/astro-adopt.md`, `templates/`). Nothing folded in.
