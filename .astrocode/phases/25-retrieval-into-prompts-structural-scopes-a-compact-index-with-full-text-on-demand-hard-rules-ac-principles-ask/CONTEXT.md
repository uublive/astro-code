<!-- astro-discuss: captured -->
# Phase 25 — Retrieval into prompts: context

Milestone 9 "Second Nature" (PROJECT.md: "Retrieval without a black box"). Builds on the
phase-22 store (`lib/principles.mjs` et al., `~/.astro/principles/`, ADR-057/059) — scopes
`stack` / `files` / `work`, `strength` rule|default. Phase 24 (planned alongside) adds
sightings/dedupe; phase 23 added capture. Canon injection today: `workflows/execute-phase.mjs`
`OBEY` points agents at `.astrocode/CONVENTIONS.md` + `DECISIONS.in-force.md` by path;
Claude main session gets context via hooks (`hooks/_astro-ctx.mjs`, `astro-precompact.mjs`);
other hosts via the managed AGENTS.md block (`lib/agentsmd.mjs`, `templates/AGENTS.md`).
Milestone rules that stand: structural shortlist, one line per principle, full text on
demand, hard rules always in full, agents do the semantic matching, `ask` ranks by keyword
and says why, usage logged, NO embeddings.

## Decisions

### D1 — Reach: astro agents AND the main session
- Workflow-spawned agents (planner, researchers, criteria-author? see D2, executors, heal
  executors) get a per-task shortlist alongside the canon, through the same OBEY-style
  channel (agent runs an `ac principles …` command with its stage/files — workflow scripts
  don't run shell themselves).
- Claude main session: hard rules in full + compact index via SessionStart / PreCompact hook
  context. Other hosts: via the managed AGENTS.md block (static — it tells the agent to run the
  `ac` command, since the store is per-user and outside the repo; never write personal
  principles INTO the repo's AGENTS.md/CLAUDE.md — ADR-057, they'd land in a teammate's clone).
- Out-of-scope entries (no match on stack/files/work) are not shown, except hard rules.

### D2 — Verifier: hard rules only, as non-blocking findings
- The verifier sees hard rules (strength=rule) only. A violation is reported as a finding
  (→ `findings[]` → filed as debt by /astro-execute 4d), NEVER a criterion failure.
  CRITERIA.md stays the sole pass/fail bar (ADR-021). Personal rules never gate a phase.
- The criteria-author stays plan-blind AND principle-blind (planner's call if it wants to
  confirm; default: criteria-author gets nothing).

### D3 — Forge reads: replace outright, now
- Remove every `mcp__forge__forge_knowledge` read (commands/astro-discuss.md, astro-plan.md,
  astro-new-project.md, agents/astro-researcher.md, agents/astro-planner.md) and the tool from
  their allowed-tools/tools lists; replace with the `ac principles` retrieval. Forge's graph is
  dark until phase 27 imports it — accepted by the user.
- `templates/forge-knowledge.md`: whatever phase 23 left of it goes (or becomes a stub
  pointing at phase 27) — no command references it after this phase. Update guard tests that
  pin forge wording.
- Forge WRITE removal was phase 23 (already landed).

### D4 — Usage: served + cited
- `ac` logs every time a principle is SERVED in a shortlist (who/stage/project/time).
- Agents CITE the ids they actually applied (one line in their summary/report); the command
  or workflow records citations to the same log.
- Review surfaces: served-often-never-cited (ignored) and never-served (unused). Surfacing
  them belongs with the phase-24 review command if it has landed — at minimum a
  `ac principles list` flag/section for them.

### D5 — Canon conflict: deterministic candidate, agent judges, canon wins
- `ac` finds candidate clashes by keyword overlap between a principle and the project's
  CONVENTIONS.md / in-force DECISIONS (same explainable matcher family as phase 24's
  dedupe — reuse it, don't fork a second one). The shortlist marks them
  `canon may override: ADR-xx / CONVENTIONS §…`.
- The agent follows canon and notes the clash; `ac principles list` shows the flag too.
  Nothing is resolved automatically. A principle promoted INTO this project (its promotions
  record) is not a clash with itself.

### D6 — Stack: detect from manifests + explicit override
- Infer stack tags from manifest files (package.json → node + key deps, go.mod → go,
  Cargo.toml → rust, pyproject/requirements → python, …), overridable per project with an
  explicit list in `.astrocode/` config. Lowercased like stored `stack` tags.
- The shortlist says which tags it used (explainability).

### D7 — `ac principles ask "<question>"`
- Keyword ranking over statement/why/scopes; each result says why it matched (terms,
  scope hits). No embeddings. Replaces the forge read call sites' role (D3).

## Scope
IN: the scope matcher (stack/files/work vs the task), the compact index + full-text-on-demand
(`ac principles show` exists), hard rules in full, delivery to astro agents / main session /
AGENTS.md hosts (D1), verifier hard-rule findings (D2), forge-read replacement (D3), usage
log served+cited (D4), canon-clash candidates (D5), stack detection (D6), `ask` (D7).
OUT: transcript mining (26), forge graph import + deleting forge entirely (27), embeddings,
the backlog item on committing DECISIONS.in-force.md (user: leave it), automatic conflict
resolution of any kind.

## Open for the planner
- Command shape for the shortlist (e.g. `ac principles brief --work code --files a,b`),
  the index line format (statement + id + kind/strength + scope hint, one line), and a size
  cap / truncation rule for the index (hard rules never truncated).
- Where the usage log lives (store dir vs per-machine) and whether it syncs; keep it
  append-only if it syncs (merge-safe like phase 24's sightings).
- How citations are collected from agents (schema field in workflow agent results vs a
  trailer line) without breaking `additionalProperties:false` result schemas.
- Mapping workflow stages → `work` values (plan→plan, execute→code/test, verify→review, …).
- Interplay with phases 23/24 landing concurrently: build on their merged state.
