---
description: Talk through a phase before planning — adaptive questions that surface decisions and edge cases, captured to CONTEXT.md
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Grep, Glob, Write, AskUserQuestion, ToolSearch
---

Discuss phase `$ARGUMENTS` with the developer before any plan is written. The goal is
to surface the decisions, scope boundaries, and edge cases they may not have thought
about — and to capture the answers so planning is grounded, not guessed.

1. **Get grounded.** Surface the live status (`ac activity '✎ discussing'`), then read
   `.astrocode/PROJECT.md`, the phase's roadmap entry/goal, the canon (`ac canon`), and
   skim the relevant code (Grep/Glob/Read) so your questions are specific to THIS
   project, not generic. Then run ONE `ac principles ask "<question built from the phase
   goal>"` — one call, weigh what it returns alongside the rest, don't relitigate it.
1b. **Check the debt register for the ground this phase will touch.** Run `ac debt list`,
   and for each file/area the phase goal implicates, `ac debt list --file <path>`. Debt is
   paid cheaply when you are **already in the file with the context loaded**, and expensively
   as a standalone chore — this is the moment that difference is decidable.

   If anything relevant is open, raise it as **one** `AskUserQuestion` in round one: name
   the items, **one line each**, inside that single question — never a table — and ask
   whether to fold them into this phase's scope (options: **"Fold them in"** / **"Leave
   them"**). On "fold in", record them in CONTEXT.md as explicit in-scope items so the
   planner picks them up. Ask **once** — a second nudge is nagging, and debt that is
   genuinely not worth paying should be `ac debt drop`ped, not re-asked every phase.

   Say nothing at all when there is no relevant debt. Never let this displace the phase's
   own questions: the phase goal is the subject, and folded-in debt is at most a rider.

1c. **Check the backlog for ideas this phase would absorb.** Run `ac backlog list`, and
   for each open item that reads as relevant to this phase's goal, note it.

   If anything relevant is open, raise it as **one** `AskUserQuestion` **in round one, after
   the debt question** — never during this grounding step, and never ahead of the phase's own
   questions. Reading this file top to bottom is not the order the user experiences: steps 1b
   and 1c gather, step 3 asks. An idea you might fold in is a rider on the discussion, not its
   opening move. Name the items **one line each** inside that single question — never a table
   — offering **"Fold them in"** / **"Leave them"**. On "fold in", run
   `ac backlog link <id> --phase <n>` for each one and record them in CONTEXT.md as explicit
   in-scope items so the planner picks them up. Ask **once**.

   Say nothing at all when there is no relevant open item. Never let this displace the
   phase's own questions: the phase goal is the subject, and folded-in ideas are at most
   a rider. A linked item closes by itself when `/astro-accept` closes this phase — nobody
   ticks it off by hand.

2. **Map the gray areas.** Generate the decisions that are *specific to THIS phase* —
   real forks where more than one path is reasonable, not generic categories. Let the
   domain drive them (something users SEE / CALL / RUN / READ, or data being ORGANIZED).
   Good targets:
   - scope boundaries (what's explicitly in vs. out),
   - approach/trade-offs where more than one path is reasonable,
   - edge cases, failure modes, and data/permission concerns,
   - anything the goal leaves ambiguous or assumes.
   Skip anything the code or canon already answers — never re-ask a settled decision. If
   a personal principle already settled a fork, say so in one line ("a personal
   principle already settled X — not re-asking") and proceed instead of dropping it
   silently — the developer can override on the spot. A principle is never grounds to
   silently drop a question the code/canon do NOT already answer.
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
   the planner will obey. CONTEXT.md is a machine-read artifact, not a human message
   (D1) — it stays as dense as it needs to be. What you *report* about writing it is
   bounded to **one line** ("captured to CONTEXT.md"). The **first line MUST be** the
   provenance marker
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
5b. **Propose what the answers settled.** Run `ac phase context <N> --author` and proceed
   only when the output is exactly `human` (never a substring test — the ADR-037 trap:
   `captured` also matches the agent form). On `human`, apply
   `` `$(ac path templates)/principle-capture.md` `` in full: `--from-ref` is `phase <N>`,
   `--excerpt` is the user's answer with its reason. Report exactly one line, or say
   nothing when nothing was proposed.
6. Clear the live status (`ac activity clear`) and suggest, **in one line**, `/astro-plan
   <number>` next (reference the phase by its number, e.g. `/astro-plan 1`) — it will
   read CONTEXT.md and plan against it.

Keep it conversational and high-signal. A trivial phase may need no questions at all —
say so, **in one line**, and skip rather than manufacturing them.
