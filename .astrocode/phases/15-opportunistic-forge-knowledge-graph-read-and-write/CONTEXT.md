<!-- astro-discuss: captured -->
# Phase 15 — Opportunistic forge knowledge-graph read and write

## Goal
Let astro-code read from and write to the FORGEMASTER knowledge graph ("the brain")
through the `forge_*` MCP tools — query-before-deciding, capture-the-generator — but ONLY
when those tools are actually connected. astro-code MUST stay fully functional standalone:
no forge server, tools absent → every knowledge step is skipped, silently. The MCP tools
are the ONLY bridge: no importing forge code, no shelling to it, no assuming a server.

## Grounding (verified, not assumed)
- **Exact tool identifiers** (recovered from Claude Code's local history, not guessed):
  `mcp__forge__forge_knowledge` (read) and `mcp__forge__forge_capture_knowledge` (write).
  Server slug is `forge`; it exposes 76 tools in total.
- **Neither tool is reachable from the session that built this phase.** The absent path is
  therefore genuinely testable here; the connected path is not.
- **Installer landmine:** `symlinkInto` (`lib/install.mjs:88`) symlinks EVERY `.md` in
  `commands/` into each Claude config dir, and `copyDir` does the same for `agents/`,
  filtering only on extension. A shared partial placed in either directory would register
  as a phantom slash command / subagent.
- `templates/` is copied wholesale by `copyTree` (`lib/install.mjs:259`) and nothing in it
  is auto-registered.

## Decisions (settled with the developer)

1. **Shared guidance lives at `templates/forge-knowledge.md`** — one source of truth,
   shipped to `~/.astro/code/templates/`, never auto-registered. Each touched command and
   agent carries ONE line pointing at it, not a copy of the rules. Rejected: `commands/`
   or `agents/` (phantom registration, above); CONVENTIONS.md canon (that is per-PROJECT
   canon shared on the team registry branch — wrong layer for framework behavior that must
   ship to every installed copy); a new top-level `docs/` dir (needs new installer +
   `package.json` `files[]` wiring for no gain over `templates/`).

2. **Detection: toolset check, then exactly ONE ToolSearch probe.** Look for
   `mcp__forge__forge_knowledge` in the live toolset; if absent, run one
   `ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_capture_knowledge")`
   before concluding it is not there. **This is load-bearing:** in this harness MCP tools
   can be connected but DEFERRED — visible only as a name in a system-reminder until
   ToolSearch loads the schema. A plain toolset check would skip even when forge IS
   connected, and that failure is indistinguishable from correct degradation.

3. **Absence is invisible; a broken server is not.** Tools absent → skip with NO output,
   no error, no dead reference. Tools present but the call fails (error, timeout,
   malformed response) → degrade identically (never block, never fail the command) but
   emit ONE short line that the brain was unreachable. A configured-but-broken server that
   stays silent could stay broken indefinitely while every run looks normal.

4. **READ — one scoped query per caller**, built from the phase goal (or the project
   vision for `/astro-new-project`). Fold in only what is relevant. No multi-query
   fan-out: 3 researchers already means 3 calls, and per-angle splitting would triple that
   on every run.

5. **`/astro-discuss` states what the brain settled — it never silently drops a question.**
   One line ("the brain already settled X — not re-asking"), then proceed; the developer
   can override on the spot. Silent suppression would let a stale entry invisibly shape a
   phase — and that phase can become the next captured signal, so the error compounds.

6. **WRITE — `/astro-decision` is the primary hook, auto-propose, no confirmation.** After
   `ac decision add` succeeds, lift the generator and call `forge_capture_knowledge`,
   then print one line summarizing what was staged. The tool writes to a human-approval
   QUEUE, not the graph, so a human gate already exists downstream; a second gate here
   would add exactly the friction that stops people recording ADRs at all.

7. **An unliftable ADR captures NOTHING, and says so.** If what survives stripping every
   project noun, filename, number and proper name is vacuous or untrue as a general rule,
   skip the capture (ADR-027 — "the wave integrator is the exception to our model ladder" —
   is the worked example). A graph of forced generalizations is worse than a smaller honest
   one, and the ADR itself is preserved in the canon either way.

8. **Agent scope: read for `astro-researcher` + `astro-planner`; NO write for
   `astro-executor`.** N parallel executors each lifting a generator from their own task
   would flood the queue with near-duplicate low-signal drafts. Execution-time lessons are
   captured once, by the `/astro-execute` command after the run.

9. **`/astro-execute` + `/astro-verify` capture only on a SURPRISE that changed the
   approach** — a verify FAIL that revealed a wrong assumption, a heal that exposed a
   structural trap, an approach abandoned mid-phase. A phase that simply went to plan
   teaches nothing and captures nothing. Rare by construction, and checkable.

10. **Capture contract is fixed by the forge side** and must be obeyed exactly:
    `node_type` ∈ {Principle, Pattern, AntiPattern, Preference}; `node_body` = the lifted,
    PROJECT-AGNOSTIC generator; `signal_body` = the concrete evidence (ADR text + id, or
    the observation); `node_slug` / `signal_slug` distinct, kebab-case, no whitespace;
    `edge_type` matching the node type (`PrincipleEvidencedBySignal` etc.);
    `source` e.g. `"astro-code ← /astro-decision"`; `third_party_content: false`.

11. **Testing means source guards + a real standalone run.** Automated doc guards (the
    `tests/commands.test.mjs` pattern from phase 14 t8) assert every touched file names the
    tools, points at `templates/forge-knowledge.md`, and carries the skip rule. Plus a
    genuine end-to-end standalone run with forge absent, proving nothing breaks and nothing
    leaks into user-facing output. Connected mode is a DOCUMENTED MANUAL CHECK — commands
    are prose interpreted by Claude, so a simulated-toolset harness would test a simulation
    of Claude's behavior, not Claude's.

## Scope

In:
- `templates/forge-knowledge.md` — the single shared read/capture/degradation spec.
- `commands/`: `astro-discuss`, `astro-plan`, `astro-new-project` (read);
  `astro-decision` (write, primary), `astro-execute`, `astro-verify` (write, rare).
  Each gets the tools in `allowed-tools` frontmatter + one pointer line.
- `agents/`: `astro-researcher`, `astro-planner` — `mcp__forge__forge_knowledge` in
  `tools:` frontmatter + one pointer line. `astro-executor` is NOT touched.
- `tests/` — doc guards for every touched file.
- `README.md` / `AGENTS.md` — a short OPTIONAL-integration note that degrades to a no-op.

Out (untouched):
- `lib/`, `bin/ac.mjs`, `workflows/*.mjs`. The `ac` CLI never learns about forge — the
  integration is entirely in the prose layer that Claude executes. This keeps REQ-001
  (dependency-free substrate) and the standalone guarantee structurally true rather than
  merely intended.
- `astro-executor` (decision 8).
- Any forge import, subprocess, network call, or config key.

## Invariants to preserve
- **Standalone is the default, not the fallback.** No step may fail, warn, or leave a dead
  reference when the tools are absent.
- **REQ-001 / REQ-004** — no runtime deps, no build step; commands degrade gracefully.
- **DRY** — the rules exist once, in `templates/forge-knowledge.md`. A command that
  restates them instead of pointing at them is a defect (drift bait).
- The capture contract (decision 10) is owned by the forge side; astro-code conforms.

## Verification (what phase CRITERIA should assert, behaviorally)
- With the forge tools ABSENT, every touched command runs to completion with no error and
  no forge-related text in user-facing output.
- Every touched command/agent names both tools where relevant, points at
  `templates/forge-knowledge.md`, and states the skip rule — none restates the rules inline.
- `templates/forge-knowledge.md` specifies: the two exact tool ids, the toolset→ToolSearch
  detection order, silent-on-absent vs one-line-on-error, and the full capture contract.
- `astro-executor` gained no forge tools; `astro-researcher`/`astro-planner` gained only
  the read tool.
- No `.md` was added to `commands/` or `agents/` that is not a real command/agent
  (no phantom registration).
- `lib/`, `bin/`, and `workflows/` are untouched by the phase diff.
- The full suite stays green.

## Open questions / assumptions
- The two tool identifiers were recovered from local history rather than a live connection;
  if forge ever renames them, the integration degrades to a silent no-op — which is the
  designed behavior, but would need a bump here.
- Whether an `allowed-tools` entry naming an unavailable MCP tool is harmless in Claude
  Code is assumed true and MUST be proven by the standalone run (decision 11), not asserted.
- Connected-mode behavior (reads returning content, captures reaching the queue) is
  unverified from this session and is explicitly a manual check.
