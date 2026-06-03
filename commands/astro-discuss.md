---
description: Talk through a phase before planning — adaptive questions that surface decisions and edge cases, captured to CONTEXT.md
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Grep, Glob, Write, AskUserQuestion
---

Discuss phase `$ARGUMENTS` with the developer before any plan is written. The goal is
to surface the decisions, scope boundaries, and edge cases they may not have thought
about — and to capture the answers so planning is grounded, not guessed.

1. **Get grounded.** Surface the live status (`ac activity '✎ discussing'`), then read
   `.astrocode/PROJECT.md`, the phase's roadmap entry/goal, the canon (`ac canon`), and
   skim the relevant code (Grep/Glob/Read) so your questions are specific to THIS
   project, not generic.
2. **Map the gray areas.** Generate the decisions that are *specific to THIS phase* —
   real forks where more than one path is reasonable, not generic categories. Let the
   domain drive them (something users SEE / CALL / RUN / READ, or data being ORGANIZED).
   Good targets:
   - scope boundaries (what's explicitly in vs. out),
   - approach/trade-offs where more than one path is reasonable,
   - edge cases, failure modes, and data/permission concerns,
   - anything the goal leaves ambiguous or assumes.
   Skip anything the code or canon already answers — never re-ask a settled decision.
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
   the planner will obey.
5. **Promote firm choices.** If a decision is architectural (affects more than this
   phase), record it with `ac decision add "<choice>" --why "<why>"` so it joins the
   shared canon.
6. Clear the live status (`ac activity clear`) and suggest `/astro-plan <number>` next
   (reference the phase by its number, e.g. `/astro-plan 1`) — it will read CONTEXT.md
   and plan against it.

Keep it conversational and high-signal. A trivial phase may need no questions at all —
say so and skip rather than manufacturing them.
