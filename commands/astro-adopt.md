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
4. **Give it a one-command boot, adapting to what's already there.** Decide from the
   **astro-mapper** report, never a question: app-shaped (a server entry point / HTTP
   framework dependency / a start script that serves / an existing container image
   exposing a port) or library/CLI-only. Library/CLI → add nothing, say so in one
   line, and skip to the next step — no `AskUserQuestion` for an unambiguous shape.
   Ask only when genuinely ambiguous: no entry point suggesting a long-running
   process; several plausible services with no obvious primary; or an existing
   compose file with no clearly web-facing service.

   If app-shaped, bring it up to `` `$(ac path templates)/RUN-CONTRACT.md` `` —
   `Dockerfile` + `docker-compose.yml`, service `app`, healthchecks, the pinned port
   expression, `seed` wired as `app.depends_on.seed: service_completed_successfully`
   — but **adapt, never replace**: keep any existing healthcheck, port mapping or
   Dockerfile that already conforms as-is, and if the project already seeds itself
   (a `make seed` / `npm run seed` / similar loading its own fixtures), the `seed`
   service **delegates to that existing command unchanged** — never rewrite,
   duplicate or bypass it. If that entry point has no consent guard of its own, add
   the `RUN_SEED === 'true'` assertion in a small committed wrapper script the
   compose service calls, leaving the project's own seed command working exactly as
   before for a human who types it directly, and note the residual gap in the report
   rather than silently changing their entry point's contract.

   If an existing compose file already names its web service something other than
   `app`, the fleet requires that exact name — but silently renaming a service the
   project's CI may refer to is a breaking change. `AskUserQuestion` before renaming;
   if the user agrees, update every in-repo reference to the old name (CI config,
   scripts, docs) in the same change. If they decline, say plainly in the report that
   the contract does not hold.

   Then attempt the cold start **once**: probe Docker (`docker compose version`);
   absent → skip and report `Cold start NOT verified — Docker unavailable …` without
   blocking adoption. Present → `docker compose up -d`, then check what actually
   came up (`docker compose ps` shows `app` healthy and `seed` exited 0, and the
   published port serves) — never claim the contract holds because it merely saw a
   compose file. On failure, diagnose and retry up to **2 repair attempts** (3 boots
   maximum), then report `Cold start FAILED after N attempt(s) — <what is still
   broken>` naming the defect; on success report `Cold start verified — …` and state
   plainly whether the project's **pre-existing fixtures** loaded into the running
   app. Always tear down (`docker compose down -v`) afterward.

   Copy `RUN-CONTRACT.md` verbatim to the project root and distil a "Run contract"
   section into `.astrocode/CONVENTIONS.md` carrying this project's real values
   (including its own seed command, not a generic one) — before the canon-push step
   below.
5. **Record load-bearing decisions.** Capture the big existing choices as ADRs so they
   aren't relitigated: `ac decision add "<choice>" --why "<why>"` (e.g. the web
   framework, auth provider, data layer). These go to the shared canon.
6. **Share it.** If the repo has a remote, `ac canon push` so the team gets the same
   conventions/decisions immediately.
7. **Plan what's next.** Propose a short roadmap of upcoming work (NOT a re-description
   of existing code). On the user's OK, create each with `ac phase add "<name>"`.
8. Show `ac status` and point to `/astro-discuss <number>` for the first phase (then
   `/astro-plan <number>`; a trivial phase can skip straight to plan) — always
   reference a phase by its **number** (e.g. `/astro-discuss 1`), never its name.

This is the one place a codebase *map* is worth it (onboarding existing code). It's a
one-time bootstrap — the always-on consistency comes from the canon it produces, not
from a map kept in sync.
