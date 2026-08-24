# Forge knowledge graph — read/write/degradation spec

astro-code is standalone by default. The FORGEMASTER knowledge graph ("the brain") is an
**opportunistic bonus**, never a requirement: with no forge MCP server connected, every
step below is a silent no-op and the command runs exactly as if this file did not exist.
Callers reference this file — `` `$(ac path templates)/forge-knowledge.md` `` — they never
copy its rules. A command or agent that restates the detection order, the degradation
paths, or the capture contract inline instead of pointing here is a defect (drift bait):
the two copies will diverge and one of them will be wrong. This is the single source of
truth for read, write, and degradation; a reader must be able to answer everything below
without opening any other file.

## The three tools

- **Read — search:** `mcp__forge__forge_knowledge` — a natural-language question or phrase.
  Returns matching nodes. **This is the default read.**
- **Read — browse:** `mcp__forge__forge_knowledge_list` — enumerate what EXISTS by
  `type` / `tag` / `recency`. Use it when there is no specific question yet, only a
  category worth sweeping (see the READ protocol below).
- **Write:** `mcp__forge__forge_capture_knowledge`

All three ids are confirmed against a live connection — the server slug is `forge`, and
these three are the only ones astro-code ever names. If forge ever renames one, the
integration degrades to a silent no-op by design; that is not a bug to route around here,
it is the same "absence is invisible" path described below.

A caller only ever invokes the tools its own frontmatter grants: read-only callers hold
the two read tools, write-only callers hold `mcp__forge__forge_capture_knowledge`, and a
role that has no business writing to the queue (every parallel executor, every read-only
judgement role) holds neither. No caller holds both a read tool and the write tool by
accident — the split is the point.

## Detection order (load-bearing)

Detection is two steps, in this exact order, and the second step runs **at most once per
command run**:

1. **Check the live toolset** for `mcp__forge__forge_knowledge`. If it is there, forge is
   connected — proceed.
2. **If it is not there, run exactly one probe** — one identical probe string for every
   caller, naming **all three** tools so there is a single form to keep correct:
   `ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_knowledge_list,mcp__forge__forge_capture_knowledge")`
   before concluding the tools are absent. Omitting a tool from the probe leaves it
   deferred and uncallable even though forge is connected — the same silent failure this
   step exists to prevent, just narrowed to one tool.

This second step is not optional and not a nicety. In this harness an MCP tool can be
**connected but deferred** — visible only as a bare name in a system-reminder until
`ToolSearch` loads its schema. A bare toolset check alone would skip the integration even
when forge genuinely IS connected, and that failure looks identical to correct
degradation from the outside — there is no other signal that would catch it. An empty or
no-match `ToolSearch` result is the signal for "absent"; it is not itself an error and
must not be reported as one. Never probe more than once per run — a second `ToolSearch`
buys nothing once the first has already resolved the question.

## The two degradation paths

These are deliberately asymmetric, and the asymmetry is the point:

- **Tools absent → skip with NO output at all.** No warning, no "forge not available"
  line, no dead reference of any kind. Absence is the expected, default case and must be
  completely invisible — a standalone user should never see evidence that an optional
  integration exists and isn't running.
- **Tools present but the call fails** (error, timeout, malformed response) **→ degrade
  identically in behavior** (never block, never fail the calling command) **but emit
  exactly one short line** that the brain was unreachable. Reuse the project's existing
  best-effort idiom rather than inventing new voice — see `Refresh the team canon
  best-effort (ac canon pull)` in `commands/astro-execute.md` for the register to match.
  A configured-but-broken server that degrades as silently as a genuinely absent one could
  stay broken indefinitely while every run still looks normal — that is a real problem and
  must be visible, even if only as one line.

## READ protocol

- **One scoped read per caller**, built from the phase goal (or the project vision, for
  `/astro-new-project` before a phase exists). Fold in only what is relevant to that
  specific decision point.
- **Search or browse — pick ONE, not both.** The budget is one read call per caller
  regardless of which tool serves it:
  - `mcp__forge__forge_knowledge` (search) is the **default**, and the right choice
    whenever there is an actual question — a phase goal, a fork being weighed, a decision
    about to be made. `/astro-discuss`, `/astro-plan` and the research agents all use this.
  - `mcp__forge__forge_knowledge_list` (browse) fits the one case where there is no
    question yet, only a category worth sweeping: `/astro-new-project` shaping a scaffold
    from the owner's standing `Preference` and `Principle` nodes, before any phase or goal
    exists to search against. Filter by `type`; do not page through the whole graph.
- **No multi-query fan-out.** Three parallel researchers already means three calls; a
  per-angle split, or a search-then-browse pair per caller, would multiply call volume for
  no proportional gain.
- **Using the result:** state in ONE line what the brain already settled — the shape is
  "the brain already settled X — not re-asking" — then proceed. The developer can override
  on the spot. **Never silently drop a question or a fork just because the brain has an
  opinion on it** — a stale graph entry would then invisibly shape the phase, and that
  phase can itself become the next captured signal, so the error compounds across runs
  instead of staying contained to one.

## WRITE protocol

Capture is **conditional by construction**, never automatic:

- **Lift the generator.** Strip every project noun, filename, number and proper name from
  what is being captured. If what survives is vacuous or untrue as a general rule, **the
  caller captures nothing, and says so in one line.** ADR-027 ("the wave integrator is the
  single documented exception to the opus→sonnet-only rule…") is the worked example of an
  ADR that does not lift: its content is inseparable from this project's specific model
  ladder. A graph filled with forced generalizations is worse than a smaller, honest one —
  and the ADR itself is preserved either way, in `.astrocode/DECISIONS.md`, regardless of
  whether it was liftable.
- **No confirmation prompt before writing.** `forge_capture_knowledge` writes to a
  human-approval **queue**, not directly into the graph — a human gate already exists
  downstream of every capture. A second gate here would add exactly the friction that
  stops people from recording ADRs in the first place.
- **The capture never precedes or gates the caller's primary effect.** It runs strictly
  after the ADR is recorded / the verdict is reported / the run has otherwise already
  succeeded on its own terms, and a failed capture never fails or changes that outcome.

## Capture contract (owned by forge — conform exactly, invent no fields)

Every `forge_capture_knowledge` call must supply:

- `node_type` — one of exactly `Principle`, `Pattern`, `AntiPattern`, `Preference`.
- `node_body` — the lifted, **project-agnostic** generator (see "Lift the generator"
  above).
- `signal_body` — the concrete evidence: the ADR text and id, or the specific observation
  that grounded the capture.
- `node_slug` / `signal_slug` — distinct from each other, kebab-case, no whitespace.
- `edge_type` — matches the node type, e.g. `PrincipleEvidencedBySignal` for a `Principle`
  node.
- `source` — a short provenance string, e.g. `"astro-code ← /astro-decision"`.
- `third_party_content` — `false`.

## Verification note

Connected mode (reads returning real content, captures actually reaching the queue) is a
**documented manual check**, not an automated test. Every touched command and agent here
is prose interpreted by Claude, not code executed by a runtime — a harness that simulated
a connected MCP toolset would only be testing a simulation of Claude's behavior, never
Claude's actual behavior. The standalone (tools-absent) path is exactly the opposite: it
is real code (`bin/ac.mjs`, the engine under `lib/`) exercised by an automated test that
proves nothing forge-related ever leaks into it.
