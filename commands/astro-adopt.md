---
description: Adopt astro-code into an EXISTING codebase — map it, draft PROJECT.md + CONVENTIONS.md from the real code, then plan what's next
argument-hint: [project name]
allowed-tools: Bash, Read, Write, Edit, Agent, AskUserQuestion
---

Bootstrap astro-code on a project that already has code. Goal: capture the codebase's
**existing** stack, patterns, and decisions into the canon so future agents match what's
already there — then plan only what's *next*, not what already exists.

1. **Init (non-destructive).** If `.astrocode/` already exists, ask whether to refresh
   the canon or stop. Otherwise run `ac init --name "$ARGUMENTS"` (omit `--name` to use
   the repo name). This only adds `.astrocode/`; it touches nothing else.
2. **Map the repo.** Spawn the **astro-mapper** agent to produce a structured read of
   the codebase: stack & entry points, architecture, naming/file conventions, test
   approach, and risks. (Read-only, conclusions not file dumps.)
3. **Draft the canon from reality.** From the map, fill `.astrocode/CONVENTIONS.md`
   with the project's *actual* stack, naming, patterns, and testing style — not
   aspirations. Draft `.astrocode/PROJECT.md` (vision + the main requirements you can
   infer). Use `AskUserQuestion` to confirm anything genuinely ambiguous (e.g. the
   intended direction, non-obvious conventions). Keep both tight.
4. **Record load-bearing decisions.** Capture the big existing choices as ADRs so they
   aren't relitigated: `ac decision add "<choice>" --why "<why>"` (e.g. the web
   framework, auth provider, data layer). These go to the shared canon.
5. **Share it.** If the repo has a remote, `ac canon push` so the team gets the same
   conventions/decisions immediately.
6. **Plan what's next.** Propose a short roadmap of upcoming work (NOT a re-description
   of existing code). On the user's OK, create each with `ac phase add "<name>"`.
7. Show `ac status` and point to `/astro-plan <number>` for the first phase — always
   reference a phase by its **number** (e.g. `/astro-plan 1`), never its name.

This is the one place a codebase *map* is worth it (onboarding existing code). It's a
one-time bootstrap — the always-on consistency comes from the canon it produces, not
from a map kept in sync.
