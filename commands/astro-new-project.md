---
description: Initialize an astro-code project — scaffold .planning/ and shape PROJECT.md + the initial roadmap
argument-hint: [project name]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

You are starting a new astro-code project in the current repository.

1. Run `ac init --name "$ARGUMENTS"` (omit `--name` to use the directory name). If
   `.planning/` already exists, tell the user and stop.
2. Interview the user briefly to fill in **vision**, **requirements** (stable
   `REQ-001` ids), and **constraints**. Use `AskUserQuestion` only for genuine
   forks. Write the result into `.planning/PROJECT.md`.
   Then seed `.planning/CONVENTIONS.md` with the agreed **stack, naming, patterns,
   and testing style** — this canon is injected into every future planning and
   execution agent, so getting it right now keeps the whole team consistent. Record
   any notable up-front choices with `ac decision add`.
3. Propose an initial set of phases (small, sequenced, each a vertical slice).
   Confirm with the user, then create each with `ac phase add "<name>"`. Each call
   claims the next phase number from the shared registry (collision-proof across
   the team).
4. Show `ac status` and tell the user the next step is `/astro-plan <phase>`.

Keep PROJECT.md tight — vision + requirements + constraints, no fluff.
