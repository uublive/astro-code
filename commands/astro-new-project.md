---
description: Initialize an astro-code project — scaffold .astrocode/ and shape PROJECT.md + the initial roadmap
argument-hint: [project name]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, ToolSearch, mcp__forge__forge_knowledge, mcp__forge__forge_knowledge_list
---

You are starting a new astro-code project in the current repository.

1. Run `ac init --name "$ARGUMENTS"` (omit `--name` to use the directory name). If
   `.astrocode/` already exists, tell the user and stop.
2. Interview the user for a first **vision** draft — what they're building and why.
   This is the seam: run it before anything else in the interview, because the next
   step needs something to query from.
3. Opportunistically, make ONE scoped read built from that vision draft — see
   `` `$(ac path templates)/forge-knowledge.md` `` for the full detection/degradation
   rules (tools absent → skip silently, no output). This is the one caller where
   **browse** may beat search: `mcp__forge__forge_knowledge_list` filtered by `type`
   (`Preference`, `Principle`) surfaces the owner's standing stack and working
   preferences when there is no phase goal yet to search against, where
   `mcp__forge__forge_knowledge` needs a question to answer. Pick whichever fits the
   draft — one call, never both. The
   placement is fixed here, between the vision draft and the requirements/constraints
   interview: earlier the query has nothing to be built from; later it cannot inform
   the interview it exists to shape. Use the result the same way `/astro-discuss`
   does — if the brain already settled something relevant (e.g. a stack/pattern
   preference), state it in one line ("the brain already settled X — not re-asking")
   and let it inform the rest of the interview rather than dropping it silently; the
   developer can override on the spot.
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
