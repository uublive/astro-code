<!-- astro-discuss: captured -->
# Phase 23 — Capture at the moments of intent: context

Milestone 9 "Second Nature". Builds on phase 22's store: proposals are created through its
propose path (`ac principles add --propose` / `proposePrinciple`, with `--from-session`,
`--from-project`, `--from-ref`, `--excerpt` — the excerpt redacted by phase 22). By ADR-058
a proposal never accepts itself; re-proposing only ever refreshes still-proposed entries.

Prior art in this repo, to reuse rather than reinvent: the forge WRITE protocol in
`templates/forge-knowledge.md` — the same four kinds (Principle, Pattern, AntiPattern,
Preference) and the "lift the generator" rule (strip every project noun, filename, number
and proper name; if what survives is vacuous or untrue as a general rule, capture
NOTHING). `/astro-decision` and `/astro-execute` already run that protocol against forge.

## Decisions

### D1 — astro-code only, from now: forge capture is removed
- Every capture point proposes into astro-code's store. The existing
  `mcp__forge__forge_capture_knowledge` WRITE calls (`/astro-decision`, `/astro-execute`
  step 5) are REMOVED, along with the tool from those commands' `allowed-tools`.
- Forge READS (`mcp__forge__forge_knowledge` before discuss/plan/new-project) are NOT
  touched here — retrieval (phase 25) replaces them; the forge graph's import is phase 27.
- `templates/forge-knowledge.md` must stop describing astro-code as a forge writer (the
  WRITE protocol section goes or is marked historical); the "lift the generator" rule it
  holds moves to wherever capture is now specified (single source of truth — no copies in
  each command).

### D2 — The four moments
1. **`/astro-decision`** — right after the ADR is recorded: lift the generator from the ADR.
2. **`/astro-discuss`** — after CONTEXT.md is captured: the user's answers, with their
   reasons, are stated preferences.
3. **`/astro-accept` — REJECTIONS only.** The reject reason is often an antipattern
   ("never do X"). A plain acceptance carries little signal and proposes nothing.
4. **Milestone close** (`/astro-complete-milestone`) — a retrospective sweep over the
   milestone's ADRs, CONTEXT files, rejections AND the execute surprises recorded under D3;
   catches what the per-moment captures missed. Recurrence is the signal here: one surprise
   is an accident, the same one across phases is a pattern.
- Evidence per moment: `--from-ref` names the ADR / phase / milestone; `--excerpt` quotes
  the user's own words (answer, reject reason, ADR why); `--from-project` the project name.

### D3 — /astro-execute records surprises, it does not propose
When a run hits a surprise (the signals step 5 already gates on: `healed` non-empty,
`remediationCycles > 0`, `stoppedReason` no-progress/max-cycles), execute RECORDS a short
note in the phase (a small file in the phase directory — planner picks the format) and
proposes nothing. The milestone-close sweep (D2.4) reads these notes and proposes the
recurring ones. Execute prints nothing extra for it.

### D4 — Volume: at most 3 per moment, only if they lift
Up to 3 proposals per moment, each must (a) survive the lift rule and (b) carry its why.
Nothing qualifies → propose nothing and print nothing.

### D5 — What the user sees: queue + one line
Proposals go to the queue; the command ends with exactly one line, e.g.
`proposed 2 principles — ac principles list --proposed`. No interruption, no inline
accept prompt; review is batched (phase 24's workflow). Zero proposals → no line.

### D6 — Human-answered moments only
A moment answered by an agent proposes nothing: a CONTEXT.md whose provenance marker is
`<!-- astro-discuss: captured by agent: … -->` (headless runs such as astro-fleet), and an
`--agent`-signed accept/reject (ADR-033). An agent's answers are not how the user works
(ADR-058). Only `captured` (human) provenance and human sign-offs propose.

## Scope
IN: the four capture points (D2), the execute surprise note (D3), removal of the forge
writes (D1), and the lift/volume/one-line rules written ONCE and referenced by the
commands (the forge-knowledge.md single-source discipline).
OUT: dedupe of any kind (phase 24 — see known gap), the review command (24), retrieval and
the forge reads (25), transcript mining (26), importing forge's existing graph (27).

## Known gap (accepted)
No duplicate check in this phase (the user chose to wait for phase 24): until 24 lands, a
capture may re-propose something already accepted, already proposed, or previously
REJECTED. Phase 24 must close this — including never re-proposing a rejection (ADR-058).

## Open for the planner
- The exact propose invocation each command makes (CLI vs a small helper), and how a
  command obtains the session id for `--from-session` (omit it if unavailable).
- The surprise-note format and filename (D3), and how the milestone-close sweep reads them.
- Where the single capture spec lives (a template next to forge-knowledge.md, e.g.
  `templates/principle-capture.md`, referenced via `$(ac path templates)`).
