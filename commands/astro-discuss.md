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
2. **Ask adaptively.** Use `AskUserQuestion` to ask the **2–4 questions that actually
   matter** for this phase — real forks, not box-ticking. Good targets:
   - scope boundaries (what's explicitly in vs. out),
   - approach/trade-offs where more than one path is reasonable,
   - edge cases, failure modes, and data/permission concerns,
   - anything the goal leaves ambiguous or assumes.
   Offer concrete pickable options (with a recommended one first). Ask follow-ups in a
   second round if an answer opens a new fork. Don't ask what the code/canon already
   answers.
3. **Capture.** Write `.astrocode/phases/<slug>/CONTEXT.md`: the decisions reached,
   the chosen scope, and any open questions/assumptions. Keep it tight — it's the brief
   the planner will obey.
4. **Promote firm choices.** If a decision is architectural (affects more than this
   phase), record it with `ac decision add "<choice>" --why "<why>"` so it joins the
   shared canon.
5. Clear the live status (`ac activity clear`) and suggest `/astro-plan <number>` next
   (reference the phase by its number, e.g. `/astro-plan 1`) — it will read CONTEXT.md
   and plan against it.

Keep it conversational and high-signal. A trivial phase may need no questions at all —
say so and skip rather than manufacturing them.
