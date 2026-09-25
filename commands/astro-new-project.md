---
description: Initialize an astro-code project — scaffold .astrocode/ and shape PROJECT.md + the initial roadmap
argument-hint: [project name]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, ToolSearch
---

You are starting a new astro-code project in the current repository.

1. Run `ac init --name "$ARGUMENTS"` (omit `--name` to use the directory name). If
   `.astrocode/` already exists, tell the user and stop.
2. Interview the user for a first **vision** draft — what they're building and why.
   This is the seam: run it before anything else in the interview, because the next
   step needs something to query from.
3. Make ONE call to surface standing personal preferences: `ac principles ask "<question
   built from the vision draft>"` if it gives you enough to search on, otherwise
   `ac principles brief --stage session` to browse whatever is already in scope with no
   query. Pick whichever fits the draft — one call, never both. The placement is fixed
   here, between the vision draft and the requirements/constraints interview: earlier the
   query has nothing to be built from; later it cannot inform the interview it exists to
   shape. Use the result the same way `/astro-discuss` does — if a personal principle
   already settled something relevant (e.g. a stack/pattern preference), state it in one
   line ("a personal principle already settled X — not re-asking") and let it inform the
   rest of the interview rather than dropping it silently; the developer can override on
   the spot.
4. Continue the interview to fill in **requirements** (stable `REQ-001` ids) and
   **constraints**. Use `AskUserQuestion` only for genuine forks. Along the way, ask
   **one** `AskUserQuestion` fork that decides whether this step also scaffolds a
   container contract: is this a **runnable app**, or a **library/CLI**? Library/CLI
   is a hard stop for everything container-shaped — no Dockerfile, no compose, no
   seed, no contract copy, no run-contract canon section (astro-code itself would
   answer "library"; a Dockerfile in a library is noise). If app-shaped, ask two more
   questions the scaffold needs: does it **persist data** (a `db` service only
   then — no dead service in a stateless app), and **which third parties** it talks
   to (each gets a fake, so a preview never needs a real credential). Write the
   result (vision + requirements + constraints) into `.astrocode/PROJECT.md`.
   Then seed `.astrocode/CONVENTIONS.md` with the agreed **stack, naming, patterns,
   and testing style** — this canon is injected into every future planning and
   execution agent, so getting it right now keeps the whole team consistent. Share it
   with `ac canon push`, and record any notable up-front choices with `ac decision add`
   (these go to the shared orphan branch so the whole team sees them immediately).
4a. **If app-shaped, scaffold the container contract.** The contract lives at
   `` `$(ac path templates)/RUN-CONTRACT.md` `` — read it for the pinned service
   names, healthchecks, port expression, seed wiring and dependency edges; never
   restate its contents here, a restatement drifts out of sync with the source of
   truth. Author, for the actual stack the interview settled on, exactly the
   artifacts it requires: `Dockerfile`, `docker-compose.yml`,
   `docker-compose.preview.yml`, the stack-native seed script (wired, a no-op at
   birth, guarded by the `RUN_SEED` consent variable, accepting `--reset`, with the
   fixture seam clearly marked), the stack-native task entry it delegates to
   (`npm run seed` / `make seed` / …), and `.env.example` (filled dev values, not
   blank keys — a fresh clone needs no `.env` at all). Use the contract's pinned
   values verbatim; do not invent your own service names or variables. This
   scaffolding is written by **you, the agent**, never by `ac`/`lib/` — `lib/` must
   not write outside `.astrocode/` (even a single `.gitignore` line was pushed out of
   `lib/` for this reason, because it once made `ac flow branch` refuse right after a
   scaffold) — so the Dockerfile, compose files and seed script are authored here the
   same way `PROJECT.md` and `CONVENTIONS.md` already are. Library/CLI-shaped
   projects skip this sub-step entirely — no container or seed scaffolding, no
   run-contract canon.
4b. **If app-shaped, prove the cold start, repair it, report honestly, then seed the
   canon.** An unrun Dockerfile is worse than none — it looks like a contract and
   isn't one, and this step exists to prevent exactly that.
   - **Probe Docker first:** run `docker compose version` via Bash. A non-zero exit
     or "command not found" means it's absent — **skip the boot check, never block
     project creation**, and print `Cold start NOT verified — Docker unavailable,
     skipping the boot check` (still copy the contract and seed the canon below;
     only the boot attempt is skipped). If present, attempt `docker compose up -d`
     once.
   - **Check what actually came up, never that files exist:** `docker compose ps`
     must show `app` **healthy** and `seed` **exited 0**, and a request to the
     published port (read off `docker-compose.yml`, never guessed) must return the
     app's response.
   - **Bounded repair on failure:** diagnose, fix, retry — **at most 2 repair
     attempts** (3 boots maximum). If it's still broken after that, stop and print
     `Cold start FAILED after N attempt(s) — <what is still broken>`, naming the
     defect plainly; the final summary must not read as success.
   - If the boot succeeds, print `Cold start verified — app healthy, seed exited 0,
     served on <port>`. The three report stems above must appear verbatim so the
     three outcomes stay distinguishable at a glance.
   - **Always tear down afterward** with `docker compose down -v`, whichever
     outcome, so the scaffold leaves no running containers behind.
   - **Copy `` `$(ac path templates)/RUN-CONTRACT.md` `` verbatim to the project
     root** — not into `.astrocode/`: a later `rm -rf .astrocode/` must not remove
     the contract a human or non-astro agent still needs. Then **fill in the declaration
     block** (§10, `<!-- astro-code: fixtures-declaration -->`) with
     this project's real paths: `data-model:` gets the migrations dir, schema
     file or model/entity dir the stack it just scaffolded actually uses, and
     `seed:` gets the seed script plus any fixture data files it reads (comma-
     separated, repo-relative, a trailing `/` for "this directory and everything
     under it" — the same semantics §10 documents). At birth there may be no data
     model yet — then leave `data-model:` empty and say so in one line in the
     summary this step reports, so the first data-model phase knows to fill it.
     Never invent a placeholder path: an unfilled-but-plausible-looking entry
     would read as declared when it isn't.
   - **Distil it into `.astrocode/CONVENTIONS.md`** as a "Run contract" section,
     carrying the concrete values this project actually shipped — service names,
     the healthcheck, the published port, the stack-native seed command, the
     `RUN_SEED=true` consent variable, the reset fork
     (`docker-compose.preview.yml` override), and "fixtures are plain source,
     never a binary database". These values must agree with the shipped
     `docker-compose.yml` value for value — a canon that drifts from what actually
     boots is worse than no canon. Carry the fixture-currency rule itself as the
     state outcome it is, not a file-edit obligation: when a later phase adds a
     table, a column or any new persisted shape, the one-command cold start comes up
     holding the state that phase's acceptance items assume — fixtures
     extended at the `RUN-CONTRACT.md` §8 seam — and add one line pointing at
     where the declaration lives (`RUN-CONTRACT.md` §10, filled in above) so
     nobody has to rediscover the format. Then `ac canon push` again to share the
     updated canon (the earlier push in step 4 predates this section).
   - Library/CLI-shaped projects skip this entire step, including the canon
     section, the declaration and the distilled rule — no cold-start probe, no
     `RUN-CONTRACT.md` copy, no run-contract canon.
5. Initialize the numbering registry: run `ac registry init`. This creates the
   orphan registry branch on `origin` and seeds milestone 1, so numbering is
   team-coordinated from day one (and can never drift the way local-then-remote
   numbering does). It needs an `origin` remote — if there isn't one yet, tell the
   user to add it (`git remote add origin <url>`) and run `ac registry init` before
   the first `ac phase add`. (Phase/milestone claims fail fast until this is done.)
6. Propose an initial set of phases (small, sequenced, each a vertical slice).
   Confirm with the user, then create each with `ac phase add "<name>"`. Each call
   claims the next phase number from the shared registry (collision-proof across
   the team; phases number from 1).
7. Show `ac status` and tell the user the next step is `/astro-discuss <number>` for the
   first phase (then `/astro-plan <number>`; a trivial phase can skip straight to plan) —
   always reference a phase by its **number** (e.g. `/astro-discuss 1`), never its name.

Keep PROJECT.md tight — vision + requirements + constraints, no fluff.
