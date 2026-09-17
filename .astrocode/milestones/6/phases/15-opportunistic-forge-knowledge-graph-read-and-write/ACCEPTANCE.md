# ACCEPTANCE — Phase 15: opportunistic forge knowledge-graph read and write

User-facing UAT. A human confirms these before the phase closes (`/astro-accept`).
Items 1–5 are checkable **with no forge server anywhere** (the default world);
items 6–7 are the documented **manual connected-mode** check.

## Standalone (forge absent) — must be indistinguishable from before

1. **The user can run `/astro-decision "…"` with no forge server connected and get the ADR
   recorded exactly as before** — same steps, same `[shared]`/`[local]` confirmation — with
   **no** mention of forge, the knowledge graph, "the brain", a skipped query, or a tool
   error anywhere in the output.
2. **The user can run `/astro-discuss <n>`, `/astro-plan <n>` and `/astro-execute <n>` on a
   real phase with no forge server** and see them complete normally: questions asked,
   CONTEXT.md/PLAN.md written, waves executed, verdict reported — nothing new printed,
   nothing failed, nothing hung.
3. **The user can run `npm test` and see the full suite green**, and can confirm from
   `git diff --stat main..HEAD -- lib bin workflows` that the engine was never touched.

## Shipping and safety

4. **The user can install the framework into a fresh home and read the whole contract in one
   file** — `~/.astro/code/templates/forge-knowledge.md` — and from it alone answer: which
   two MCP tools are used, how their presence is detected, what happens when they are
   absent vs. when a call fails, and exactly which fields a capture must carry.
5. **The user can confirm nothing phantom got registered**: after install, `/forge-knowledge`
   is **not** an invocable slash command and no new subagent appears in the agent picker —
   the registered command/agent lists are the same ones as before the phase.

## Connected mode (manual, requires the forge MCP server)

6. **The user can run `/astro-discuss <n>` with forge connected and see one short line
   stating what the brain already settled** ("the brain already settled X — not re-asking"),
   with the question still visible to override rather than silently dropped.
7. **The user can run `/astro-decision "…"` with forge connected and see one short line
   naming what was staged to the approval queue** — no extra confirmation prompt — and can
   confirm that an ADR whose generator is unliftable stages **nothing** and says so, while
   the ADR itself is recorded in the canon either way.

## Rot protection

8. **The user can delete the forge pointer line from any one touched command (or empty
   `templates/forge-knowledge.md`) and see `npm test` go red** — then restore the file and
   see it go green again.
