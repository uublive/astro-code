<!-- pre-registered before any plan existed; plan-blind by contract -->
# Success criteria — Phase 15: opportunistic forge knowledge-graph read and write

Derived from the phase goal + CONTEXT.md decisions + project canon. Each criterion is an
observable claim about the finished system; any valid implementation of the goal must
satisfy all of them.

### C1 — With the forge tools absent, the whole framework still runs end to end and never mentions forge
- **Observe:** In a scratch dir, drive a real project lifecycle against the repo CLI with a
  temp home (no MCP server anywhere):
  `H=$(mktemp -d); cd "$H" && git init -q . && git commit -q --allow-empty -m base` then run,
  capturing combined stdout+stderr and exit codes,
  `HOME=$H CLAUDE_CONFIG_DIR=$H/.claude node /Users/buu/Development/astro-code/bin/ac.mjs <cmd>`
  for a representative lifecycle: `init`, `milestone add …`, `phase add …`, `phase claim`,
  `decision add "T" --why "w" --rejected "r"`, `roadmap render`, `status`, `state`.
  PASS requires: every invocation exits 0 (or its documented non-zero for a genuinely
  invalid input), the ADR lands in `.astrocode/DECISIONS.md`, and the captured output
  matches nothing for `grep -inE 'mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge graph|the brain'`.
- **Fails if:** any lifecycle command errors, hangs, or degrades because a forge tool is
  missing; or any user-facing line references the knowledge graph / a skipped query /
  an unreachable brain when the tools were never present (absence must be invisible).

### C2 — No executable code path can reference the knowledge graph (ADR-030 holds structurally)
- **Observe:** `cd /Users/buu/Development/astro-code && git diff --stat $(git merge-base main HEAD)..HEAD -- lib bin workflows`
  prints nothing, and
  `grep -rinE 'mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph' lib bin workflows`
  returns no matches (baseline today: 0 matches), and `node --test` is green.
- **Fails if:** the integration reached the engine at all — a helper, a config key, an env
  probe, a subprocess or a network call in `lib/`, `bin/` or `workflows/` — i.e. anything
  that could throw, warn, or change behavior when forge is absent.

### C3 — Installing the framework registers no phantom slash command or subagent
- **Observe:** Install into a throwaway home and enumerate what got registered:
  `H=$(mktemp -d); HOME=$H CLAUDE_CONFIG_DIR=$H/.claude node -e "import('/Users/buu/Development/astro-code/lib/install.mjs').then(m=>m.installClaude('/Users/buu/Development/astro-code'))"`
  then `ls $H/.claude/commands $H/.claude/agents`. The registered names must equal exactly
  the pre-phase set (`git show $(git merge-base main HEAD):`-era listing of `commands/*.md`
  and `agents/*.md`), and every registered file must carry real command/agent frontmatter
  (`description:` and, for agents, `name:`/`tools:`). The shared knowledge guidance must be
  readable under `$H/.astro/code/templates/`.
- **Fails if:** the shared guidance (or any other non-command doc) appears in the installed
  `commands/` or `agents/` dirs and thereby becomes an invocable `/…` command or a
  selectable subagent; or the guidance never ships to the installed tree at all (installed
  users would hold pointers to a file they do not have).

### C4 — The shipped guidance alone fully determines the read/write/degrade behavior
- **Observe:** Resolve the guidance path from a pointer inside one of the touched command
  files (do not assume the path), `Read` that file, and confirm a reader could answer all
  four without consulting any other file: (a) both exact tool identifiers
  `mcp__forge__forge_knowledge` and `mcp__forge__forge_capture_knowledge`; (b) the detection
  order — check the live toolset, then exactly one `ToolSearch` probe before concluding
  absence; (c) the two distinct degradation paths — tools absent → skip with no output at
  all, tools present but the call fails/times out/returns garbage → never block or fail the
  command but emit exactly one short line that the brain was unreachable; (d) the capture
  contract: the `node_type` enum {Principle, Pattern, AntiPattern, Preference}, the
  project-agnostic `node_body` vs concrete `signal_body` split, distinct kebab-case slugs,
  the matching `edge_type`, a `source` string, `third_party_content: false`.
- **Fails if:** detection collapses to a bare toolset check (which would silently skip even
  when forge IS connected — indistinguishable from correct degradation); or absence and
  call-failure are given the same output treatment (either a visible skip line, or a broken
  server that stays silent forever); or any capture-contract field/enum is missing or
  contradicted, so a conforming call cannot be constructed from the document.

### C5 — Every pointer resolves in the shipped package, and the rules exist in exactly one place
- **Observe:** For each file under `commands/` and `agents/` that mentions either forge
  tool, extract the guidance path it points at and confirm it resolves to a readable file
  both in the repo and in the C3 temp install. Then confirm the rules are not duplicated:
  outside the single guidance file, no `commands/`or `agents/` file enumerates the
  `node_type` values, the edge types, or the ToolSearch detection procedure —
  `grep -rlE 'AntiPattern|EvidencedBySignal|ToolSearch\(' commands agents` yields at most
  files that merely reference the guidance, never a restatement of its rules.
- **Fails if:** a referring file points at a path that does not exist (dead reference for
  every installed user), or a second copy of the detection/capture rules lives in a command
  or agent (drift bait — the two copies will diverge and one will be wrong).

### C6 — Capability grants match the intended read/write split; nothing can write that shouldn't
- **Observe:** Parse the frontmatter tool grants of every file in `agents/` and `commands/`.
  Required: no file in `agents/` is granted `mcp__forge__forge_capture_knowledge` at all;
  `mcp__forge__forge_knowledge` appears in `agents/` only for `astro-researcher` and
  `astro-planner`; `agents/astro-executor.md` grants neither tool; in `commands/`, the write
  tool is granted only to the callers that actually capture (`astro-decision`,
  `astro-execute`, `astro-verify`) and the read tool only to the callers that actually query
  (`astro-discuss`, `astro-plan`, `astro-new-project`) — no command holds a tool it never
  uses.
- **Fails if:** N parallel executors (or any read-only role — researcher, planner, mapper,
  verifier, criteria-author) hold the capture tool, which would flood the approval queue
  with near-duplicate low-signal drafts; or a touched caller names a tool in its prose that
  it is not granted (the call would be refused at runtime).

### C7 — Capture is conditional by construction: an ordinary, to-plan run stages nothing
- **Observe:** `Read` each write-side caller and confirm each capture step is gated by an
  explicit, checkable precondition, with the negative outcome stated: `/astro-decision`
  captures only after `ac decision add` has succeeded AND the generator survives stripping
  every project noun, filename, number and proper name (unliftable → capture nothing, and
  say so); `/astro-execute` and `/astro-verify` capture only on a surprise that changed the
  approach (went to plan → capture nothing). Confirm no caller places the capture before or
  in the way of its primary effect, and that a failed capture is described as
  non-blocking / non-failing.
- **Fails if:** any caller instructs an unconditional capture on every run, or omits the
  "then nothing is captured" branch (a forced generalization gets staged, or every phase
  emits a draft); or the ADR/verdict recording is made dependent on the capture succeeding.

### C8 — The phase's own doc guards actually fail when the integration is removed
- **Observe:** `cd /Users/buu/Development/astro-code && node --test` is green on HEAD. Then,
  in a throwaway copy (`cp -R` to a scratch dir, or edit + `git checkout --` after), apply
  two mutations one at a time and re-run `node --test` in that copy: (1) delete the forge
  pointer/tool mention from one touched command, (2) truncate the shared guidance file to
  an empty document. Each mutation must produce at least one failing test; the working tree
  must be left clean afterwards (`git status --porcelain` empty).
- **Fails if:** the suite stays green under either mutation — the guards assert nothing and
  the integration can silently rot away — or if the suite is not green on HEAD.
