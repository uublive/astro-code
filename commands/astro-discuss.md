---
description: Talk through a phase before planning — adaptive questions that surface decisions and edge cases, captured to CONTEXT.md
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Grep, Glob, Write, AskUserQuestion, ToolSearch, mcp__forge__forge_knowledge
---

Discuss phase `$ARGUMENTS` with the developer before any plan is written. The goal is
to surface the decisions, scope boundaries, and edge cases they may not have thought
about — and to capture the answers so planning is grounded, not guessed.

1. **Get grounded.** Surface the live status (`ac activity '✎ discussing'`), then read
   `.astrocode/PROJECT.md`, the phase's roadmap entry/goal, the canon (`ac canon`), and
   skim the relevant code (Grep/Glob/Read) so your questions are specific to THIS
   project, not generic. Then, opportunistically, run ONE scoped
   `mcp__forge__forge_knowledge` query built from the phase goal — see
   `` `$(ac path templates)/forge-knowledge.md` `` for the full detection/degradation
   rules (tools absent → skip silently, no output).
2. **Map the gray areas.** Generate the decisions that are *specific to THIS phase* —
   real forks where more than one path is reasonable, not generic categories. Let the
   domain drive them (something users SEE / CALL / RUN / READ, or data being ORGANIZED).
   Good targets:
   - scope boundaries (what's explicitly in vs. out),
   - approach/trade-offs where more than one path is reasonable,
   - edge cases, failure modes, and data/permission concerns,
   - anything the goal leaves ambiguous or assumes.
   Skip anything the code or canon already answers — never re-ask a settled decision. If
   the forge brain already settled a fork, say so in one line ("the brain already
   settled X — not re-asking") and proceed instead of dropping it silently — the
   developer can override on the spot. A brain opinion is never grounds to silently
   drop a question the code/canon do NOT already answer.
3. **Discuss in rounds, and let the user steer.** Ask the **2–4 questions that actually
   matter** with `AskUserQuestion` — concrete pickable options, the recommended one
   first. Then, after **every** round, explicitly ask whether to keep going:
   - `AskUserQuestion` — header `Discuss`, question *"Dig into more, or capture what we
     have?"*, options: **"More questions"** (recommend this while real forks remain) /
     **"Ready to capture"**.
   - On **"More questions"**, generate a *fresh* round shaped by what was just decided —
     the latest answers usually open new forks (an approach choice surfaces edge cases; a
     scope cut surfaces a fallback). This is how the user steers: each round builds on the
     last. Loop until they pick "Ready to capture".
   - If an answer references a doc/decision, read it and let it inform the next round.
   - Treat scope-creep ideas as deferred notes and steer back — don't grow the phase.
4. **Capture.** Write `.astrocode/phases/<slug>/CONTEXT.md`: the decisions reached,
   the chosen scope, and any open questions/assumptions. Keep it tight — it's the brief
   the planner will obey. The **first line MUST be** the provenance marker
   `<!-- astro-discuss: captured -->` — or, when an agent answered the questions on the
   operator's behalf rather than relaying a human's answers,
   `<!-- astro-discuss: captured by agent: <name> -->`. Same gate either way; the
   provenance is recorded, not hidden (ADR-035, mirroring ADR-033 one step upstream).
   A plan-blind bar derived from an agent-written brief is less independent than one
   derived from a human's, and `ac phase context` cannot tell them apart — so the file
   has to say. This is an invisible HTML comment — it is how
   `/astro-plan` knows the phase was actually discussed, not just that a file exists.
   Do not omit it; do not add it to a file you didn't genuinely discuss.
5. **Promote firm choices.** If a decision is architectural (affects more than this
   phase), record it with `ac decision add "<choice>" --why "<why>"` so it joins the
   shared canon.
6. Clear the live status (`ac activity clear`) and suggest `/astro-plan <number>` next
   (reference the phase by its number, e.g. `/astro-plan 1`) — it will read CONTEXT.md
   and plan against it.

Keep it conversational and high-signal. A trivial phase may need no questions at all —
say so and skip rather than manufacturing them.
