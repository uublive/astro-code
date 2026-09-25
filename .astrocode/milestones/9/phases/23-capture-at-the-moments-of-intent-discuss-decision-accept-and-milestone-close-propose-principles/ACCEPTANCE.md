# Phase 23 — Acceptance (UAT)

Run each item in a scratch project (`mktemp -d`, `git init`, `ac init`) with an isolated store:
`export HOME=$(mktemp -d)`. That leaves your real `~/.astro/principles/` alone.

- [ ] **The user can record a decision and see its principle waiting for review.**
  *Precondition:* an initialised project, an empty personal store.
  Run `/astro-decision` with a decision that holds as a general rule (e.g. "validate input at
  the boundary, never deep inside"). The command ends with exactly one line
  `proposed N principle(s) — ac principles list --proposed`. That command lists the entry as
  *proposed* with the ADR id, your own words and the project name. Now record a decision that
  only makes sense for this project (e.g. a specific model or file name). Nothing is proposed
  and no extra line is printed.

- [ ] **The user can finish a discussion and find their stated preferences proposed, but not
  an agent's.**
  *Precondition:* a pending phase on the roadmap with no CONTEXT.md yet.
  Answer `/astro-discuss` yourself. You get at most 3 proposals citing `phase <N>`, and one
  line. Then write a CONTEXT.md whose first line is
  `<!-- astro-discuss: captured by agent: bot -->`. `ac phase context <N> --author` prints
  `agent bot`, and nothing is proposed from it.

- [ ] **The user can reject a phase and see the reason proposed as an antipattern. Accepting
  proposes nothing.**
  *Precondition:* two phases in `verified` status, each with an ACCEPTANCE.md.
  Reject one through `/astro-accept`, giving a reason in your own words. You get one
  `proposed …` line, and the proposal's excerpt is your reason word for word. Accept the other
  one: no `proposed` line appears. `ac phase reject <p> --reason "x" --agent bot` is accepted,
  prints an AGENT marker and proposes nothing.

- [ ] **The user can see execute surprises recorded silently in the phase.**
  *Precondition:* a phase on the roadmap with its phase directory.
  `ac phase surprise <N> --healed 0 --remediation-cycles 0 --stopped-reason passed` prints
  nothing and creates no file. `ac phase surprise <N> --healed 2 --note "heal hit a stale
  base"` prints nothing and adds one line to `.astrocode/phases/<slug>/SURPRISES.jsonl`.
  Nothing appears in `ac principles list --proposed`.

- [ ] **The user can close a milestone and get proposals only for what recurred.**
  *Precondition:* a milestone whose phases are all complete. Two of its phases carry a similar
  surprise note or rejection reason, one phase was rejected and later accepted, and one phase
  has an agent-captured CONTEXT.md.
  `/astro-complete-milestone` archives the milestone. `ac milestone harvest` still lists the
  rejected-then-accepted reason, the surprises, the human CONTEXT files and the milestone's
  ADRs. It leaves out the agent CONTEXT and agent rejections, and says how many it skipped.
  The sweep proposes at most 3 recurring themes and ends with one line. A one-off surprise is
  not proposed.

- [ ] **The user can confirm that astro-code no longer writes to forge and that capture never
  overrides their own decisions.**
  *Precondition:* a store with one accepted and one rejected entry (with its reason), both
  with the same text a capture will propose.
  No command's `allowed-tools` grants `mcp__forge__forge_capture_knowledge`.
  `/astro-discuss` and `/astro-plan` still do their forge read, and it stays silent when forge
  is absent. After any capture, `ac principles list --all` shows the accepted and rejected
  entries unchanged, and nothing new is accepted.
