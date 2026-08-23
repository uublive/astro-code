---
description: Initialize an astro-code project — scaffold .astrocode/ and shape PROJECT.md + the initial roadmap
argument-hint: [project name]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, mcp__forge__forge_knowledge
---

You are starting a new astro-code project in the current repository.

1. Run `ac init --name "$ARGUMENTS"` (omit `--name` to use the directory name). If
   `.astrocode/` already exists, tell the user and stop.
2. Interview the user for a first **vision** draft — what they're building and why.
   This is the seam: run it before anything else in the interview, because the next
   step needs something to query from.
3. Opportunistically, run ONE scoped `mcp__forge__forge_knowledge` query built from
   that vision draft — see `` `$(ac path templates)/forge-knowledge.md` `` for the
   full detection/degradation rules (tools absent → skip silently, no output). The
   placement is fixed here, between the vision draft and the requirements/constraints
   interview: earlier the query has nothing to be built from; later it cannot inform
   the interview it exists to shape. Use the result the same way `/astro-discuss`
   does — if the brain already settled something relevant (e.g. a stack/pattern
   preference), state it in one line ("the brain already settled X — not re-asking")
   and let it inform the rest of the interview rather than dropping it silently; the
   developer can override on the spot.
4. Continue the interview to fill in **requirements** (stable `REQ-001` ids) and
   **constraints**. Use `AskUserQuestion` only for genuine forks. Write the result
   (vision + requirements + constraints) into `.astrocode/PROJECT.md`.
   Then seed `.astrocode/CONVENTIONS.md` with the agreed **stack, naming, patterns,
   and testing style** — this canon is injected into every future planning and
   execution agent, so getting it right now keeps the whole team consistent. Share it
   with `ac canon push`, and record any notable up-front choices with `ac decision add`
   (these go to the shared orphan branch so the whole team sees them immediately).
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
