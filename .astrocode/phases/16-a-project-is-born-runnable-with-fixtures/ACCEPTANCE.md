# ACCEPTANCE — Phase 16: A project is born runnable with fixtures

User-facing UAT. A human confirms these before the phase closes (`/astro-accept`).

**Precondition state assumed by items 1–5 (ADR-050):** a scratch repo created under
`/Users/buu/Development/` (the only tree the host Docker sees), empty for items 1–3, and for
item 5 an existing app-shaped repo that already seeds itself. Docker commands run on the host:
`host docker compose up -d`. No item requires a `.env`, an exported variable, or a migration
run beforehand — needing one is itself a failure.

1. **The user can go from an empty repo to a running, seeded app with one command.** Run
   `/astro-new-project`, answer that it is a runnable app that stores data, and then — without
   editing a single file — run the one command the project documents (`docker compose up`).
   `docker compose ps` shows `app` **healthy** and `seed` **exited 0** before it, and hitting
   the port printed in `docker-compose.yml` returns the app's response.

2. **The user can add a fixture at an obvious seam and see it in the app.** The generated seed
   script runs as a clean no-op at birth and has a marked place to put fixture data; adding one
   record there and re-running the same single command shows that record served by the app.

3. **The user can trust that nothing seeds by accident.** Running the seed entry point without
   `RUN_SEED=true` refuses and writes nothing — including with `NODE_ENV=development` set and
   against an empty database — and starting only the `app` service leaves the data store empty,
   because the app never calls the seeder.

4. **The user can hand the run contract to someone with no astro-code and they can follow it.**
   The generated project contains `RUN-CONTRACT.md` and a "Run contract" section in its
   `.astrocode/CONVENTIONS.md`; reading those alone tells you the service name, the healthcheck,
   the port, how the seed is invoked and what grants it consent — and every value stated there
   matches the shipped compose file. Deleting `.astrocode/` does not stop the app coming up.

5. **The user can adopt an existing app that already seeds itself, without losing that.** Run
   `/astro-adopt` against it, then the single documented start command: `app` is healthy, the
   project's **own pre-existing fixtures** are in the running app, and the original
   `make seed` / `npm run seed` still works when typed by hand.

6. **The user can start a library or CLI project and get none of this.** `/astro-new-project`
   answered "library/CLI" produces no Dockerfile, no compose file, no seed and no run-contract
   canon; `/astro-adopt` against astro-code itself adds none of it and never stops to ask.

7. **The user can always tell whether the boot was actually observed.** With Docker
   unavailable, project creation still completes and the report says plainly the cold start was
   **not verified**. With a boot that genuinely fails, it retries a small bounded number of
   times and then names what is broken — it never reads like success. With a boot that worked,
   it says verified. The three read differently.
