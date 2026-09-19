# Success Criteria — Phase 16: A project is born runnable with fixtures

> Pre-registered before any plan exists. These grade the **outcome** — a generated or
> adopted project that actually comes up, seeded, on one command — never the shape of
> the code or prose that produces it.

**Environment notes for whoever verifies these (all Observe steps must stay runnable with
Read/Bash/Grep/Glob only):**

- This container has no `docker` CLI. Docker lives on the host and is reachable with the
  `host` helper, which runs the command in your current directory: `host docker compose up -d`.
- The host only sees paths under `/Users/buu/Development`, so create every scratch project
  there (e.g. `/Users/buu/Development/astro-code/.scratch-p16/<name>`), never under `/tmp`,
  and delete it when done.
- `/astro-new-project` and `/astro-adopt` are agent-executed prose. "Drive the command"
  means: read the command file as written and execute its steps yourself against a scratch
  repo, supplying the interview answers inline. If the instructions as written do not get
  you to the stated outcome, that is the criterion failing — that is the point.

---

### C1 — A cold clone of a scaffolded app-shaped project reaches a healthy, already-seeded app with exactly one command and zero configuration

- **Observe:** Drive `/astro-new-project` in an empty scratch repo for an app-shaped project
  that persists data (pick any stack). Then, without editing a single file and without
  running anything else first, run the one command the project documents as its start
  (`host docker compose up -d` or whatever single command the project states). Then
  `host docker compose ps`: the service named `app` reports **healthy**, and the seed
  service has **exited 0**, with the app becoming healthy only after it. `host curl -sS
  localhost:<published port>` (port taken from the compose file, not guessed) returns the
  app's response. Now add one fixture record through the seed script's existing seam, run
  the same single command again, and observe that record served by the running app.
- **Fails if:** anything is needed before or besides that one command (copying `.env`,
  exporting a variable, running migrations, a second `up`); the `app` service can serve
  while the seed service is still running or has failed; no service ever reports a health
  state, so "ready" is unobservable; the published container port cannot be read off the
  compose file; or a fixture added at the seam does not reach the running app.

### C2 — Seeding fires only on an explicitly-handed consent variable, and nothing in the app's own boot path can trigger it

- **Observe:** In the C1 project, invoke the seed entry point with the consent variable
  absent: it refuses and writes nothing (verify the data store is untouched afterwards).
  Repeat with `NODE_ENV=development` (or the stack's equivalent "I'm in dev" signal) set and
  the consent variable still absent, and again against a completely empty data store: still
  refuses, still writes nothing. Then bring up **only** the app service (no seed service,
  consent variable unset) and exercise the app: it serves, and the data store remains empty
  — proving the app never calls the seeder.
- **Fails if:** any signal other than that one deliberately-handed variable causes data to be
  written; emptiness of the database, a dev/test env name, or a hostname/branch heuristic is
  accepted as permission; or starting the app alone populates data, i.e. the seeder is
  reachable from the boot path.

### C3 — Fixtures are idempotent, and reset is keyed to the volume: preview returns to the baseline, local dev keeps the developer's data

- **Observe:** With a fixture in place, run the seed twice and compare the data store: the
  same records with the same ids, no duplicates, no second copy of anything. Then, on the
  local-dev path (persistent volume), create an extra record by hand, bring the stack down
  and up again: the hand-made record survives and the fixtures are not duplicated. On the
  preview path (ephemeral volume / the `--reset` invocation), repeat: the hand-made record
  is gone and the state is byte-for-byte the fixture baseline again. Also confirm the
  fixtures are plain reviewable source — `git diff` on a fixture change shows readable text,
  not an opaque blob.
- **Fails if:** a second run duplicates records or fails on a unique constraint; ids are
  non-deterministic across runs; local dev wipes developer-created data on `up`; preview
  keeps stale state from the previous boot; or the fixture data lives in a committed binary
  database file that a diff cannot show.

### C4 — The generated project's stated run contract is sufficient to drive it and matches what actually shipped, with astro-code removed

- **Observe:** In the C1 project, take only the run-contract document and the project's own
  canon (nothing from the astro-code repo) and check: (a) they tell a reader the service
  name, the healthcheck, the container port, how the seed is invoked and what grants it
  consent — enough to produce a conforming project for a different stack without further
  information; build that second toy project from the document alone and boot it per C1.
  (b) Every concrete value stated in the document and the canon matches the project's actual
  compose file and running containers (service name, published port, the stack-native seed
  command actually present). Then `rm -rf .astrocode/` in the C1 project and run the one
  command again: it still comes up healthy and seeded.
- **Fails if:** a reader of the document alone cannot get to a bootable project (a required
  element is unstated or ambiguous); the document or canon states a port, service name, or
  seed command that disagrees with the shipped compose file; the canon distillation and the
  contract document contradict each other; or removing `.astrocode/` breaks the boot.

### C5 — Library/CLI-shaped projects get none of this

- **Observe:** Drive `/astro-new-project` again in a fresh scratch repo, answering that the
  project is a library/CLI. The resulting tree contains no container or seed scaffolding and
  its canon makes no run-contract claim; diff it against the C1 tree to show the fork
  produced materially different output. Do the same for `/astro-adopt` against a copy of the
  astro-code repo itself (a library-shaped codebase): it adds no Dockerfile, compose, or seed,
  and does not stop to ask — the shape is unambiguous.
- **Fails if:** the library run produces container/seed scaffolding or run-contract canon;
  the two runs are indistinguishable because the fork is never established; or adopt
  interrogates the user about shape in an unambiguous case.

### C6 — Adopt gives an existing codebase the same one-command boot while adapting to the seeding it already has

- **Observe:** Build a scratch app-shaped repo that already seeds its own way (e.g. a
  `make seed` / `npm run seed` that loads checked-in SQL or JSON fixtures) and has no
  container contract. Drive `/astro-adopt` against it, then run the single documented start
  command: `app` healthy, seed service exited 0 first, and the **pre-existing fixture
  records** are present in the running app. Confirm the project's original seeding command
  still works unchanged when invoked directly.
- **Fails if:** adopt replaces, duplicates, or bypasses the existing seeding mechanism; the
  pre-existing fixtures no longer load after adoption; the original seed command is broken;
  or the adopted project does not actually come up on one command.

### C7 — The cold-start check reports what it observed and never claims a boot it did not see

- **Observe:** Three runs. (a) Drive `/astro-new-project` with `docker` made unavailable
  (invoke it with a `PATH` that contains no docker, and no host bridge): project creation
  completes normally and the run's own report states plainly that the cold start was **not
  verified**. (b) Drive it with docker available but the stack rigged to fail its first boot
  (e.g. an invalid image tag introduced before the check): the run attempts repair a small
  bounded number of times and then, if still broken, reports the failure — the final summary
  names what is broken and does not read as success. (c) The C1 run, where the boot did
  succeed, reports a verified cold start. The three reports must be distinguishable from one
  another.
- **Fails if:** a missing Docker blocks or aborts project creation; any run reports success
  (or leaves the user believing the contract holds) on the strength of a compose file
  existing rather than a boot observed; repair retries are unbounded/looping; or the
  unverified, failed, and verified outcomes are worded the same way.
