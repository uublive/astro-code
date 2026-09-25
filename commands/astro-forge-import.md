---
description: Bring principles over from a connected forge server (interim, until forge ships its own exporter — see FORGE-HANDOVER.md)
argument-hint: ""
allowed-tools: Bash, Read, Write, AskUserQuestion, ToolSearch, mcp__forge__forge_knowledge_list, mcp__forge__forge_knowledge
---

The only command in astro-code allowed to name a forge MCP tool (ADR-030). It pages
forge's knowledge graph into `templates/FORGE-EXPORT.md` v1 shape, then hands the file to
`ac principles import --from-forge` — this command never writes `~/.astro/principles/`
itself. Interim only: once forge ships the export verb from `FORGE-HANDOVER.md`, this
command retires in favour of running that verb directly.

## Steps

1. **Detect the tools.** Run a `ToolSearch` select probe for `mcp__forge__forge_knowledge_list`
   and `mcp__forge__forge_knowledge`. Absent → say so in ONE line — "forge tools are not
   connected — nothing to import" — and stop. A failing call on either tool → say so in ONE
   line naming the failure and stop; nothing is written.

2. **Page the graph.** Call `forge_knowledge_list` repeatedly, by type
   (Principle/Pattern/AntiPattern/Preference), until a page returns no new slugs. For each
   node, at most one `forge_knowledge` lookup by slug for its linked Signal evidence — none
   found means `signals: []`, never a second lookup.

3. **Map status.** This MCP surface does not expose forge's own approval, rejection or
   superseded state (verified while planning this phase) — only the graph as it stands now.
   `[low-confidence]` nodes always map to `pending`. For every other node, ONE
   `AskUserQuestion`: "import as proposed for review" (listed first — the default) or "I
   approved these in forge — import as accepted". Nothing is marked `accepted` without this
   explicit choice. Rejected and superseded nodes are not visible through this MCP surface
   at all — say so in one line and point at `FORGE-HANDOVER.md` task 1 (the real exporter,
   which does expose them).

4. **Write the export file.** Shape it exactly per `$(ac path templates)/FORGE-EXPORT.md`
   v1 — never restate the schema here, that document is the single source. Write it into a
   fresh `mktemp -d` path, NEVER under `~/.astro/principles/` (this command holds no write
   access there and must never gain any).

5. **Ask before the real import.** ONE `AskUserQuestion`: "import now" (writes the shared
   store) or "keep the file only" (prints the mktemp path and stops — nothing imported).
   On "import now", run `ac principles import --from-forge <file>` — that command is the
   only writer of `~/.astro/principles/` anywhere in this flow.

6. **Report.** "import now": the importer's own summary line(s), verbatim, nothing more.
   "keep the file only": one line with the file's path.

## Never

- Never write `~/.astro/principles/` directly — only `ac principles import --from-forge`
  writes the store, and only after step 5's explicit choice.
- Never call any forge WRITE or capture-side tool — this command only ever reads forge,
  through the two read tools its frontmatter grants.
- Never mark anything `accepted` without the user's explicit choice in step 3.
- Never post the export file, or anything derived from it, anywhere outside this flow.
