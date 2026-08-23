# PLAN — Phase 15: opportunistic forge knowledge-graph read and write

Everything here lives in the **prose layer** (`templates/`, `commands/`, `agents/`, docs)
plus `tests/`. `lib/`, `bin/ac.mjs` and `workflows/*.mjs` are **not touched by any task**
(ADR-030, CRITERIA C2) — a task that edits them is a defect, not a shortcut.

**Testing strategy (declared, per ADR-018):** **test-after serialization**, not RED-first.
The behavior added here is prose interpreted by Claude, so the automated bar is
*doc guards* (the `tests/commands.test.mjs` / phase-14-t8 pattern) which by construction
assert on text that must already exist. The two guard tasks therefore `depends_on` the
doc tasks (t12, t13). The one test that is genuinely green both before and after —
the standalone-lifecycle / engine-purity guard (t11) — runs in wave 1 with no deps.
No task statically imports a symbol that does not yet exist; the only dynamic import is
`await import('../lib/install.mjs?…')`, already the house pattern in `tests/install.test.mjs`.

**Wave-green:** no task deletes or renames anything. Every task is additive to a file that
already compiles/parses, so every wave boundary is green on its own.

**Two placement decisions the researcher forced (do not "fix" them back):**
- `workflows/plan-phase.mjs:75` spawns the research fan-out as the built-in `Explore`
  agent, **not** `astro-researcher` — so a grant on `agents/astro-researcher.md` alone
  would be a dead grant on the preferred Workflow path. The `/astro-plan` read query is
  therefore anchored in **the command itself** (t4), which fires in every tier; the agent
  grants (t8, t9) are additive, for the Agent-tool fallback tier and the Synthesize stage.
- `/astro-new-project` has no phase goal at init time, so the query is anchored **after the
  first vision draft and before requirements/constraints are finalized** (t5).

---

## t1 — Write the single shared knowledge spec `templates/forge-knowledge.md`

- **file:** `templates/forge-knowledge.md` (new)
- **depends_on:** —

The one source of truth for read/write/degradation. It ships via `copyTree`
(`lib/install.mjs:259`) to `~/.astro/code/templates/` and is **never auto-registered** —
this is exactly why it is not in `commands/` or `agents/` (`symlinkInto`/`copyDir` filter
only on the `.md` extension and would turn it into a phantom slash command / subagent).
Write it in CONVENTIONS.md Voice: say *why*, not just *what*. It MUST let a reader answer
all of CRITERIA C4 **without opening any other file**:

1. **Purpose + how it is reached.** One opening paragraph: callers reference it as
   `` `$(ac path templates)/forge-knowledge.md` `` (same phrasing shape as
   `commands/astro-kit-new.md:16`), never copy its rules — a restatement in a command is a
   defect (drift bait). Say plainly: astro-code is standalone by default; forge is an
   opportunistic bonus, never a requirement.
2. **The two exact tool ids**, verbatim: `mcp__forge__forge_knowledge` (read) and
   `mcp__forge__forge_capture_knowledge` (write). Note they were recovered from local
   history — if forge renames them the integration degrades to a silent no-op by design.
3. **Detection order (load-bearing, decision 2).** (a) Check the live toolset for
   `mcp__forge__forge_knowledge`. (b) If it is not there, run **exactly one**
   `ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_capture_knowledge")`
   probe — in this harness MCP tools can be *connected but deferred*, visible only as a
   name until ToolSearch loads the schema, so a bare toolset check would skip even when
   forge IS connected and that failure is indistinguishable from correct degradation.
   (c) An empty / no-match ToolSearch result is the signal for "absent" — it is not an
   error to report. Never probe more than once per command run.
4. **The two distinct degradation paths (decision 3).** Tools **absent** → skip the step
   with **no output at all**: no warning, no "skipped" line, no dead reference. Tools
   **present but the call fails** (error, timeout, malformed response) → never block and
   never fail the command, but emit **exactly one short line** that the brain was
   unreachable — a configured-but-broken server that stays silent could stay broken
   indefinitely while every run looks normal. Reuse the existing best-effort idiom
   (`Refresh the team canon best-effort (ac canon pull)`) rather than inventing new voice.
5. **READ protocol (decisions 4 + 5).** One scoped query per caller, built from the phase
   goal (or the project vision for `/astro-new-project`), folding in only what is relevant.
   **No multi-query fan-out.** Using the result: state in ONE line what the brain already
   settled ("the brain already settled X — not re-asking") and proceed; **never silently
   drop a question** — a stale entry would invisibly shape a phase, and that phase can
   become the next captured signal, so the error compounds. The developer can override.
6. **WRITE protocol (decisions 6 + 7 + 9).** Capture is *conditional by construction*:
   - Lift the **generator** — strip every project noun, filename, number and proper name.
     If what survives is vacuous or untrue as a general rule, **capture nothing and say so
     in one line** (ADR-027, "the wave integrator is the exception to our model ladder", is
     the worked example of an unliftable ADR). A graph of forced generalizations is worse
     than a smaller honest one, and the ADR is preserved in the canon either way.
   - No confirmation prompt: the tool writes to a human-approval **queue**, not the graph,
     so a human gate already exists downstream; a second gate here adds exactly the
     friction that stops people recording ADRs at all.
   - The capture never precedes or gates the caller's primary effect, and a failed capture
     never fails the command.
7. **Capture contract (decision 10, owned by forge — conform exactly, invent no fields):**
   `node_type` ∈ {`Principle`, `Pattern`, `AntiPattern`, `Preference`}; `node_body` = the
   lifted, PROJECT-AGNOSTIC generator; `signal_body` = the concrete evidence (ADR text +
   id, or the observation); `node_slug` / `signal_slug` distinct, kebab-case, no
   whitespace; `edge_type` matching the node type (`PrincipleEvidencedBySignal` etc.);
   `source` e.g. `"astro-code ← /astro-decision"`; `third_party_content: false`.
8. **Grants stay split.** The detection probe may name both ids in one `ToolSearch` call,
   but a caller only ever *invokes* the tool its frontmatter grants: read callers hold only
   `mcp__forge__forge_knowledge`, write callers only `mcp__forge__forge_capture_knowledge`,
   and `astro-executor` holds neither (N parallel executors lifting a generator each would
   flood the queue with near-duplicate low-signal drafts).
9. **Verification note.** Connected mode is a **documented manual check** — commands are
   prose interpreted by Claude, so a simulated-toolset harness would test a simulation of
   Claude's behavior, not Claude's.

---

## t2 — `/astro-decision`: the primary capture hook

- **file:** `commands/astro-decision.md`
- **depends_on:** —

1. Frontmatter: `allowed-tools: Bash, AskUserQuestion, mcp__forge__forge_capture_knowledge`
   (append only — **not** the read tool; C6).
2. Add a new **step 5**, after the existing step 4 (confirm the ADR id) so the ADR
   recording is never dependent on the capture: after `ac decision add` **succeeded**,
   lift the generator and call `mcp__forge__forge_capture_knowledge`, then print ONE line
   summarizing what was staged to the human-approval queue. No confirmation prompt
   (decision 6). State the negative branch explicitly: if the generator does not survive
   stripping every project noun, filename, number and proper name, **capture nothing and
   say so** (decision 7).
3. Exactly one pointer line naming the file — `` `$(ac path templates)/forge-knowledge.md` ``
   — plus the skip rule ("tools absent → skip silently, no output"). Do **not** restate the
   detection procedure or the capture-contract fields here (DRY; C5 fails on a second copy).

---

## t3 — `/astro-discuss`: query before deciding, and never silently drop a question

- **file:** `commands/astro-discuss.md`
- **depends_on:** —

1. Frontmatter: append `mcp__forge__forge_knowledge` to `allowed-tools` (read only).
2. In **step 1 (Get grounded)**: after reading PROJECT.md / roadmap / canon, run ONE scoped
   `mcp__forge__forge_knowledge` query built from the phase goal.
3. In **step 2 (Map the gray areas)**, extend the existing "Skip anything the code or canon
   already answers" rule: when the brain settled a fork, say so in one line ("the brain
   already settled X — not re-asking") and proceed — never drop the question silently; the
   developer can override on the spot (decision 5).
4. One pointer line at `` `$(ac path templates)/forge-knowledge.md` `` + the skip rule.

---

## t4 — `/astro-plan`: one scoped query before the fan-out (fires in every tier)

- **file:** `commands/astro-plan.md`
- **depends_on:** —

1. Frontmatter: append `mcp__forge__forge_knowledge` to `allowed-tools`.
2. Anchor the query in **step 2**, right beside the existing
   `Refresh the team canon best-effort (ac canon pull)` sentence — i.e. in the command
   body, which runs in the Workflow, Agent-fallback and inline tiers alike. (Do NOT rely on
   `agents/astro-researcher.md`: the Workflow path spawns `Explore`, so an agent-only grant
   would be a dead grant.)
3. State explicitly that the result is **not** passed as a workflow arg — `args` stay small
   JSON scalars (existing canon in step 3); surface it as one line to the user instead, so
   the plan does not relitigate what the brain already settled.
4. One pointer line + the skip rule. Do not disturb the existing "best available
   (graceful fallback)" tier bullets — `tests/commands.test.mjs` guards that wording.

---

## t5 — `/astro-new-project`: query from the vision draft, before requirements harden

- **file:** `commands/astro-new-project.md`
- **depends_on:** —

1. Frontmatter: append `mcp__forge__forge_knowledge` to `allowed-tools`.
2. Split step 2's single block at the exact seam: after the **first vision draft** exists
   and **before** requirements/constraints are finalized and PROJECT.md is written, run ONE
   scoped `mcp__forge__forge_knowledge` query built from that vision draft. Say why the
   placement is fixed: earlier the query has nothing to be built from; later it cannot
   inform the interview it exists to shape.
3. Use the result the same way `/astro-discuss` does — state in one line what the brain
   already settled (e.g. a stack/pattern preference) so the interview does not re-ask it.
4. One pointer line + the skip rule.

---

## t6 — `/astro-execute`: capture only on a surprise that changed the approach

- **file:** `commands/astro-execute.md`
- **depends_on:** —

1. Frontmatter: `allowed-tools: Bash, Read, Write, Workflow, mcp__forge__forge_capture_knowledge`
   (write only — **not** the read tool).
2. Add the capture to **step 5**, after the verdict is reported, gated on the signals the
   workflow **already returns** (use these exact field names — no workflow change is
   permitted or needed): `healed` (non-empty → a heal exposed a structural trap),
   `remediationCycles > 0` (a verify FAIL revealed a wrong assumption), `stoppedReason`
   (`'no-progress' | 'max-cycles'` → an approach abandoned mid-phase). A run that simply
   went **to plan captures nothing** — state that negative branch explicitly (decision 9;
   C7). Same liftability test as `/astro-decision`: unliftable → capture nothing.
3. The capture must come after `ac phase verify` / the verdict report and must never
   change or gate them; a failed capture is non-blocking.
4. One pointer line + the skip rule. Leave the ADR-008 fallback-tier wording untouched.

---

## t7 — `/astro-verify`: capture only when the FAIL revealed a wrong assumption

- **file:** `commands/astro-verify.md`
- **depends_on:** —

1. Frontmatter: `allowed-tools: Bash, Read, Agent, mcp__forge__forge_capture_knowledge`.
2. In **step 3**, after the verdict is delivered (`ac phase verify` on PASS / the missing
   list on FAIL): capture ONLY on a surprise that changed the approach — a FAIL that
   revealed a wrong assumption. A clean PASS, or a FAIL that is merely unfinished work,
   **captures nothing** — state that. Unliftable → capture nothing.
3. The capture never gates the verdict, and never turns a PASS into a FAIL.
4. One pointer line + the skip rule.

---

## t8 — `agents/astro-researcher.md`: read grant + one bullet

- **file:** `agents/astro-researcher.md`
- **depends_on:** —

1. Frontmatter: `tools: Read, Bash, Grep, Glob, WebSearch, WebFetch, mcp__forge__forge_knowledge`
   (read only; never the capture tool — C6).
2. Add ONE bullet in the existing terse principle-style register (bullets, not numbered
   steps): when the tool is available, one scoped query for the assigned angle; pointer to
   `` `$(ac path templates)/forge-knowledge.md` ``; absent → skip silently.
3. Note in the bullet's phrasing that this fires on the Agent-tool fallback tier (the
   Workflow path spawns `Explore`) so the grant is honest about when it applies.

---

## t9 — `agents/astro-planner.md`: read grant + one bullet

- **file:** `agents/astro-planner.md`
- **depends_on:** —

1. Frontmatter: `tools: Read, Write, Bash, Grep, Glob, mcp__forge__forge_knowledge`.
2. Add ONE bullet under **Principles**: before synthesizing, optionally run one scoped
   query so the plan reuses a known generator instead of rediscovering it; pointer to
   `` `$(ac path templates)/forge-knowledge.md` ``; absent → skip silently. This agent IS
   spawned by name in both tiers (Synthesize stage), so the grant is live.

---

## t10 — Docs: a short OPTIONAL-integration note that cannot read as reversing "no MCP server"

- **file:** `README.md`, `AGENTS.md`
- **depends_on:** —

1. `README.md`: 2–3 lines near the canon/architecture paragraph (~L170–181). Frame it as
   *consuming*: "if a FORGEMASTER knowledge-graph MCP server happens to be connected,
   astro-code will opportunistically query it before deciding and stage a lifted generator
   after `/astro-decision`; with no server connected nothing changes and nothing is
   printed." Explicitly do **not** touch or contradict the existing "no MCP server" pillar
   (`README.md:181` / `ARCHITECTURE.md:185-192`) — that is about astro-code not *hosting*
   a server, a different axis. Point at `templates/forge-knowledge.md`.
2. `AGENTS.md`: one short section **outside** the `<!-- lean-ctx -->` … `<!-- /lean-ctx -->`
   markers (that block is externally managed — do not edit inside it): the same
   optional/no-op framing in one or two lines, pointing at `templates/forge-knowledge.md`.
3. `ARCHITECTURE.md` is intentionally NOT edited — no scope creep.

---

## t11 — Standalone + engine-purity guard (green before and after)

- **file:** `tests/forge_standalone.test.mjs` (new)
- **depends_on:** —

Two `node:test` tests, real filesystem + real git, matching the house style
(`mkdtempSync`, `node:assert/strict`, no mocks). Green on today's HEAD *and* after the
phase — that is the point: it fails the day someone lets forge leak into the engine or
into standalone CLI output.

1. **Lifecycle stays silent with forge absent (C1).** In a `mkdtempSync` temp dir: `git
   init` + `git config user.*` + an empty commit; then drive `bin/ac.mjs` via
   `child_process.spawnSync(process.execPath, [AC, …])` with `HOME`/`CLAUDE_CONFIG_DIR`
   pointed at a throwaway home, over a representative lifecycle: `init`, `milestone add`,
   `phase add`, `decision add "T" --why w --rejected r`, `roadmap render`, `status`,
   `state`. Assert each exits 0, the ADR text lands in `.astrocode/DECISIONS.md`, and the
   concatenated stdout+stderr matches **nothing** for
   `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge graph|the brain/i`.
   If a step needs a remote for the orphan-branch `transact`, create a bare remote first —
   copy the bare-remote setup already in `tests/registry.test.mjs`.
2. **The engine never learns about forge (C2 / ADR-030).** Walk `lib/`, `bin/` and
   `workflows/` with `readdirSync(..., { recursive: true })` and assert zero files match
   `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`. The assertion
   message must list the offending file paths.

---

## t12 — Doc guards for every touched file

- **file:** `tests/forge.test.mjs` (new)
- **depends_on:** t1, t2, t3, t4, t5, t6, t7, t8, t9, t10

Follow `tests/commands.test.mjs` exactly: `readFileSync`, scoped slices where useful,
case-insensitive regex assertions, and messages that quote the missing/offending text.
Key the guards on the tokens a copy-edit cannot silently reword: the two literal tool ids
and the literal path `templates/forge-knowledge.md` (C8).

1. **The spec is complete (C4).** `templates/forge-knowledge.md` contains: both exact tool
   ids; `ToolSearch(`; all four `node_type` values (`Principle`, `Pattern`, `AntiPattern`,
   `Preference`); an `…EvidencedBySignal` edge type; `node_body`, `signal_body`,
   `node_slug`, `signal_slug`, `source`, `third_party_content`; kebab-case; and both
   degradation paths (an "absent → no output/silently" assertion **and** a distinct
   "one line / unreachable" assertion). Truncating the file to empty must go red.
2. **Every touched file points at the spec and states the skip rule (C5).** Table-driven
   over the six commands + two agents: each names `templates/forge-knowledge.md` and its
   relevant tool id in prose, and carries a skip-on-absence phrase. Deleting the pointer
   from any one file must go red.
3. **Grant split (C6).** Parse the `allowed-tools:` / `tools:` frontmatter line of **every**
   file in `commands/` and `agents/`: no `agents/` file grants
   `mcp__forge__forge_capture_knowledge`; `mcp__forge__forge_knowledge` appears in
   `agents/` only for `astro-researcher` and `astro-planner`; `agents/astro-executor.md`
   grants neither; in `commands/`, the capture tool appears only in
   `astro-decision`/`astro-execute`/`astro-verify` and the read tool only in
   `astro-discuss`/`astro-plan`/`astro-new-project`.
4. **DRY / single source (C5).** Outside `templates/forge-knowledge.md`, no file under
   `commands/` or `agents/` matches `/AntiPattern|EvidencedBySignal|ToolSearch\(/` — a
   second copy of the rules is drift bait.
5. **Capture is conditional (C7).** Each of the three write callers contains an explicit
   negative branch near its capture step (e.g. `captures? nothing` / `capture nothing`)
   and a non-blocking phrasing; and the pointer/capture step appears **after** the primary
   effect marker in the file (`ac decision add` / the verdict report / `ac phase verify`) —
   assert by index comparison.

---

## t13 — Install guards: the spec ships, and nothing phantom registers

- **file:** `tests/install.test.mjs`
- **depends_on:** t1

Extend the existing suite (same `withEnv` + `await import('../lib/install.mjs?d=…')`
pattern — do not restructure it):

1. After `installClaude(FRAMEWORK)` into a throwaway home, assert
   `$HOME/.astro/code/templates/forge-knowledge.md` exists and is non-empty — installed
   users must not hold a pointer to a file they do not have (C3).
2. Assert the registered sets are exactly the real commands/agents: the basenames in
   `$CLAUDE_CONFIG_DIR/commands` equal the `.md` basenames of the repo's `commands/`, and
   likewise for `agents/`; and specifically that `forge-knowledge.md` appears in **neither**
   registered dir (no phantom slash command / subagent — C3).
