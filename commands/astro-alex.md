---
description: Fast lane for long, unplanned "off the cuff" prompts — capture raw verbatim, distill a lean spec, then execute directly with atomic commits (no discuss/plan fan-out)
argument-hint: <your freehand prompt> [--model opus|sonnet|haiku]
allowed-tools: Bash, Read, Write, Grep, Glob, Workflow, AskUserQuestion
---

Handle a **long, unplanned, off-the-cuff** request end-to-end without the heavy
`discuss → plan → execute` loop. Built for the way some people work: a big freehand
prompt, dumped in one go, that shouldn't be lost and shouldn't need four commands to
land. `astro-alex` **captures** the raw request verbatim, **distills** a lean spec you
can eyeball, guards against scope it shouldn't fast-path, then goes **straight to
execution** — atomic commits + a single verify pass, no research/planning fan-out.

The whole request lives in `$ARGUMENTS`. If it's empty, ask the user to paste the
prompt (one `AskUserQuestion` or just prompt for it) — never invent one.

## The contract (why this command exists)

- **Nothing disappears.** The raw prompt is saved verbatim as the source of truth, and
  anything the distiller can't confidently turn into a change is parked in an explicit
  "To clarify / unclassified" list — never silently dropped.
- **Traceable.** Every spec item carries a pointer back to the raw prompt, and its id
  flows through to the commit that implements it.
- **Fast, not reckless.** It skips the parallel researchers and the planner, but a
  **scope guard** stops and escalates anything that looks systemic — big changes stay
  on the full flow, which is the owner's call, not this command's.

## Steps

1. **Resolve root.** Find the project root (where `.astrocode/` lives). If there is no
   `.astrocode/`, tell the user to run `/astro-new-project` (or `/astro-adopt` for an
   existing repo) first, and stop.

2. **Claim a tracked slot (nothing lost).** Distill a short (3–7 word) title from the
   prompt and run `ac phase add "<title>"`. This claims the next phase number from the
   shared registry (collision-proof) and creates `.astrocode/phases/<slug>/`. Resolve
   the slug from `ac roadmap list`. Mark it live:
   `ac state set active_phase <slug>` then `ac activity '✍ alex · capturing'`.
   - If `ac phase add` refuses (no `origin` / registry not initialized), relay its exact
     hint (`ac registry init` once, after adding an `origin`) and stop — `astro-alex`
     rides the same coordinated numbering as every other phase.

3. **Capture the raw prompt verbatim (source of truth).** Write the user's request,
   **unmodified**, to `.astrocode/phases/<slug>/PROMPT.md`. The **first line MUST be**
   the provenance marker `<!-- astro-alex: raw prompt -->`. Do not paraphrase, reorder,
   fix typos, or trim it — this file is the ground truth every later artifact traces to.

4. **Distill a lean SPEC.** Read `PROMPT.md`, skim the relevant code (Grep/Glob/Read)
   and the canon (`ac canon`), then write `.astrocode/phases/<slug>/SPEC.md` with the
   **first line** `<!-- astro-alex: spec -->` and exactly these sections:
   - `## Changes` — a numbered checklist of concrete edits. Each item is a task the
     executor can implement in one atomic commit, written as:
     ```
     ### t1 — <imperative one-line title>
     - **id:** t1
     - **file:** <best-guess path(s), or leave blank if genuinely unknown>
     - **depends_on:** [ ]            # ids that must land first
     - **what:** <what to change and why, tight>
     - **source:** "<short quote or line-ref from PROMPT.md this came from>"
     ```
     Use `t1, t2, …` ids in dependency order. The `source:` line is mandatory — every
     change must trace to the raw prompt.
   - `## To clarify / unclassified` — every part of the prompt that is ambiguous,
     contradictory, out of scope, or that you could NOT turn into a concrete change.
     Bullet each with the quote it came from. This is how nothing gets silently lost;
     an empty prompt-fragment must land here rather than vanish.
   - `## Scope guard` — one line: `verdict: PROCEED` or `verdict: ESCALATE`, plus a
     short reason (see step 5).

5. **Scope guard — stop the systemic stuff.** Before executing, judge the distilled
   spec. Set `verdict: ESCALATE` and **do NOT write PLAN.md or execute** when the work
   is big or systemic, e.g. it would:
   - introduce or change an **architecture / data model / schema / public API**,
   - be a **cross-cutting migration** or touch many modules at once,
   - add a **new external dependency, service, or auth/security surface**,
   - **contradict a recorded decision** in the canon (`ac decision list` / DECISIONS.md), or
   - otherwise be something you'd normally `/astro-discuss` before planning.

   On **ESCALATE**: clear the status (`ac activity clear`), leave `PROMPT.md` + `SPEC.md`
   in place (nothing lost), and report to the user: the phase number, *why* it's out of
   the fast lane, and the recommended path — `/astro-discuss <number>` → `/astro-plan
   <number>` → `/astro-execute <number>`. Then stop. Small, contained, well-understood
   changes get `verdict: PROCEED` and continue.

6. **Write the execution contract (no planner).** On PROCEED, mechanically turn the
   `## Changes` checklist into `.astrocode/phases/<slug>/PLAN.md` — the **same ids**,
   in the exact task shape `/astro-execute` reads (`### tK — title`, then `- **id:**`,
   `- **file:**`, `- **depends_on:**`, `- **what:**`). This is a transcription of the
   spec, **not** a research/planning pass — no researchers, no planner agent.

7. **Resolve the model tier.** The executor writes the code here (there is no upstream
   Opus plan feeding it), so it defaults to **Opus**. Build the models map:
   - start from `ac config get models` (the project default),
   - set `executor` to the `--model` value if the user passed one (`opus` | `sonnet` |
     `haiku`), else **`opus`**,
   - keep `verifier` at its configured tier, defaulting to **`opus`** (speed must never
     silently cost correctness — the verify gate stays sharp),
   - keep `discover` at its configured tier, defaulting to `sonnet` (mechanical).

8. **Execute straight through — sequential, no fan-out.** Run the execution workflow
   (its verifier runs at the end, so you do not verify separately):
   ```
   Workflow({
     scriptPath: "<ac path workflows>/execute-phase.mjs",   // from `ac path workflows`
     args: { root: "<project root>", phase: "<phase slug>",
             strategy: "sequential", useWorktrees: false,
             models: <the models map from step 7> }
   })
   ```
   `strategy:"sequential"` + `useWorktrees:false` is the **no-fan-out** guarantee: tasks
   run one at a time on the working branch, each an atomic commit stamped `(phase NN
   tK)` (so a re-run of `astro-alex`/`/astro-execute` skips what already landed), then a
   single goal-backward verify pass over the SPEC + the test suite. Tell the user to
   watch **`/workflows`** for progress; you'll be notified on completion. If the result
   has `integrationFailed`, surface the hint and stop (leave the phase unverified).
   - **No Workflow tool available?** Fall back to the same shape as `/astro-execute`'s
     Agent-tool tier: read the PLAN tasks, produce a topological order, then spawn one
     `astro-executor` at a time (NOT parallel, NOT batched in a single message) — each
     one atomic commit ending its subject with `(phase NN tK)` — and after all tasks
     spawn `astro-verifier`. Tell each agent to read the canon + this phase's SPEC.md.

9. **Report — and surface what's unresolved.** Clear the status (`ac activity clear`).
   - **PASS** → run `ac phase verify <slug>` (marks it **verified** — the AI gate). Then
     tell the user: the phase is done and waiting on human UAT (`/astro-accept
     <number>`), **and re-print the `## To clarify / unclassified` items** so the open
     questions are addressed rather than forgotten. `astro-alex` never auto-accepts its
     own work.
   - **FAIL / integration conflict** → surface the reasons, leave the phase unverified,
     and stop.

## Guardrails

- **Raw prompt is immutable.** `PROMPT.md` is written once, verbatim, and never edited.
- **Nothing silently dropped.** Anything not turned into a change lives in
  "To clarify / unclassified" — surfaced at capture time and again on completion.
- **Scope guard is not optional.** Systemic work escalates to the full flow; the fast
  lane is for contained changes only.
- **Verified, never complete.** The pipeline produces a **verified** phase at best; only
  human `/astro-accept` closes it.
- Clear the live status (`ac activity clear`) on every stop — success, escalation, or failure.
