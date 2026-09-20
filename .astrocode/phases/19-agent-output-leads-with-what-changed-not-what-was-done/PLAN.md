# Plan — Phase 19: Agent output leads with what changed, not what was done

Design is settled (CONTEXT.md D1–D7, ADR-055) and is **not** open here. This plan decides
*how*, *in what order*, and the wordings CONTEXT.md left to the planner.

The work is prose + guard tests. No `lib/` change, no new dependency: the canon pins
"zero runtime deps, zero dev deps", and there is no prose linter in the toolchain — the
enforcement mechanism is the static-string technique `tests/commands.test.mjs` already uses
(phase 16's t8, line 371: read the `.md` source, assert a required stem is present).

## What the audit actually found (read before touching a command)

The researchers verified CONTEXT.md's open assumption. The ~eleven existing per-slot
instructions **do** clear D4's bar (`astro-discuss.md:29,41`, `astro-plan.md:31`,
`astro-execute.md:134,181-183,223-225`, `astro-verify.md:33,48-50`, `astro-debt.md:23,34,37`,
`astro-status.md:26-28`) — they need no rework, only the guard around them.

The gap is elsewhere, and it is the important half: **the primary verdict slots have no
stated shape at all.** `astro-execute.md` step 5 (the PASS/FAIL report — the highest-traffic
human output in the whole framework), `astro-verify.md` step 3 (both the PASS line and the
uncapped "list exactly what's missing"), `astro-accept.md` step 4 ("Summarize the gap"),
`astro-plan.md` step 4 ("summarize the plan"), and both canon-refusal relays ("report it in
the run summary"). So the work is **fill the gaps + Voice section + guard test**, not
"rewrite eleven instructions".

## Values fixed by this plan (parallel tasks MUST use these verbatim — they are what keeps two files from drifting)

**P1 — the human-facing rule's load-bearing sentence**, byte-identical in
`.astrocode/CONVENTIONS.md` and `templates/CONVENTIONS.md` (t11 asserts it in both):

> A report to a human **leads with the change or the decision** and keeps the evidence short
> and beneath it.

**P2 — the unenforced label**, the exact phrase **`nothing checks it`**, appearing wherever
the free-form-narration rule is stated (all four files of t2/t1/t3). Greppable, and it is
what C7 keys on.

**P3 — the machine-read exemption**, naming the artifacts explicitly: `PLAN.md`,
`CRITERIA.md`, and a verifier's structured return/log stay **as dense as they need to be**.

**P4 — the guard's bound vocabulary.** A slot satisfies the guard by matching:

```js
const BOUND_RE = /\b(?:in|at most|no more than|to)\s+(?:exactly\s+)?(?:one|two|three|\d+)\s+(?:short\s+)?(?:line|lines|sentence|sentences)\b|\bone[- ]liner\b|\bone line\b|\bsay nothing\b|\bnothing at all\b|\bno output\b|\bsilence means\b|\bskip (?:this|it) (?:silently|in silence)\b/i
```

Every command task MUST phrase its new bounds so they match this regex (the existing eleven
already do). It is a **concept-level** regex, not pinned prose — a copyedit of a slot must
not go red (C3), only deleting the bound may (C2).

**P5 — what the guard is allowed to claim, anywhere in shipped text:** it asserts that a
reporting slot in the **seven loop commands** states a bound. Nothing else. Never quality,
never free-form prose, never the other 19 commands. Any sentence that implies more fails C7.

## Test posture (declared per ADR-018)

**Test-after, serialized, deliberately.** The guards (t11, t12) `depends_on` the prose tasks.
A guard written first would be RED at its own wave boundary, which ADR-020 forbids — and the
thing under test is text in files that already exist, so there is no missing symbol and no
reproduction to preserve. No task introduces a new export, so ADR-018's dynamic-import rule
has nothing to bite on here; **static imports are fine in t11/t12** (they import only
`node:fs` and the already-exported `initPlanning`/`writeAgentsMd`).

Every task is additive prose or additive assertions: no file is deleted, no symbol renamed,
so each task leaves `npm test` green on its own (ADR-020).

**Do not touch, in any task:** `agents/astro-verifier.md`, `workflows/execute-phase.mjs`, or
any verifier prompt. The verifier keeps writing full per-criterion evidence (D2/C5); a
brevity instruction landing there fails C5 outright. The command summarises — the verifier
does not shrink.

---

## Tasks

### t1 — Split `## Voice` in astro-code's own canon: comments stay dense, human messages lead with the change
- **file:** `.astrocode/CONVENTIONS.md`
- **depends_on:** —
- Restructure `## Voice` (lines 63–67) into two named subsections so neither rule can be
  applied to the other audience (C4):
  - `### Comments` — the existing paragraph **byte-for-byte unchanged**, including the exact
    phrase `high, explanatory density`. Adding the heading above it is the only edit
    permitted. t11 asserts the phrase survives.
  - `### Writing to a human` — new. Must contain, in this order: **P1**; the slot rule
    ("every reporting slot in a command states **how much it may emit** — 'in one line,
    naming the count' — or **when it emits nothing** — 'say nothing when there is nothing to
    report'"); the split that makes it decidable (*things that change what the reader does*
    vs *evidence that work happened* — cut the second, and say where the full version lives
    rather than pasting it); **P3**, naming `PLAN.md` / `CRITERIA.md` / the verifier's
    structured return and log as exempt; and the narration paragraph carrying **P2**
    verbatim.
  - State the guard's reach exactly as **P5**: `tests/commands.test.mjs` asserts each
    reporting slot in the seven loop commands states a bound — shape only, never quality,
    never free prose. Nothing stronger, because a word-count gate produces worse writing.
- One worked example beats an adjective — lift the real one already in the repo rather than
  inventing it: `astro-debt.md`'s "keep each item to its title plus one line of why; use
  `ac debt show <id>` for detail" is exactly the short-line-plus-pointer shape.
- Keep the file short (its own preamble says so). Target ≤ 25 added lines.

### t2 — A pre-filled `## Voice` section ships to every generated project
- **file:** `templates/CONVENTIONS.md`
- **depends_on:** —
- Append a `## Voice` section after `## File layout`. Unlike every other section in this
  template, it is **pre-filled prose, not a `- Field:` stem** — C6 fails a bare heading, a
  blank body or a `{{…}}` placeholder, because a rule the project must supply is not an
  inherited rule.
- Contents: **P1** (byte-identical to t1's), the slot rule, **P3**, and the narration rule
  carrying **P2**. Written so it is obeyable with astro-code's repository absent: no
  reference to astro-code, no pointer to another file, no mention of `tests/commands.test.mjs`
  or of any guard — **the generated project has no such test, so claiming one fails C7.** In
  this file both halves are convention; say so.
- No `### Comments` counterpart here: the comment-density rule is astro-code's own house
  style (D1/scope), and this template must not push a generated project's comments either way.
- `lib/canon.mjs`'s `isUntouchedScaffold()` reads this template at runtime, so it adapts on
  its own — but run `node --test tests/canon.test.mjs tests/cli.test.mjs tests/planning.test.mjs`
  before committing to prove the scaffold-detection path still passes.

### t3 — The narration rule lands in both `AGENTS.md` files, labelled unenforced
- **file:** `AGENTS.md`, `templates/AGENTS.md`
- **depends_on:** —
- Both files, because a generated project inheriting the Voice section but not this rule is
  the asymmetry D3 exists to close. Two files, **one task** — they are the same paragraph and
  must not drift.
- Add one bullet to `### Rules that matter` in each (root: inside the `<!-- astro-code -->`
  block; template: the whole file is that block's body). Keep the existing five bullets and
  their order; the new one goes last.
- Both copies state **P1**'s shape in one sentence, point at `CONVENTIONS.md` §Voice for the
  rule itself, and carry **P2** verbatim for the narration half.
- **The two copies differ in exactly one respect and nowhere else:** root `AGENTS.md` may
  name the guard using **P5**'s wording (the seven loop commands' slots, shape only);
  `templates/AGENTS.md` must claim **no** enforcement at all, since the generated project
  ships no such test.
- Root `AGENTS.md`'s managed block is stale relative to `templates/AGENTS.md` (it predates
  the fix/debt paragraphs). Do **not** resync it here — that is a different change and would
  bury this one. Edit the bullet list only.

### t4 — Bound every reporting slot in `/astro-discuss`
- **file:** `commands/astro-discuss.md`
- **depends_on:** —
- Slots, and what each needs (keep all existing wording; add the bound where it is missing):
  - **1b, debt fold-in** — the silence rule is already there ("Say nothing at all when there
    is no relevant debt"); add what it emits when there *is* debt: the items named **one line
    each**, inside the single `AskUserQuestion`, never a table.
  - **2, brain-settled fork** — "say so in one line" ✓ unchanged.
  - **4, capture** — writing CONTEXT.md is an artifact, not a human message (D1): say so, and
    bound what is *reported* about it to one line.
  - **6, hand-off** — currently unbounded. One line: the next command, by number.
  - **closing paragraph** — "a trivial phase may need no questions at all — say so and skip":
    add "in one line" so the skip is observable but not a report.
- Match **P4**'s vocabulary. Do not weaken the debt step's "ask **once**" rule.

### t5 — Bound every reporting slot in `/astro-plan`
- **file:** `commands/astro-plan.md`
- **depends_on:** —
  - **2, canon refusal relay** — "report it in the run summary and continue" → **in one
    line**, naming the file and the two escapes, never the diff.
  - **2, forge result** — "surface it instead as one line" ✓ unchanged.
  - **3, workflow launched** — one line: it runs in the background, watch `/workflows`.
  - **3b, commit of the plan artifacts** — one line, or nothing when the commit is a no-op.
  - **4, the plan summary** — the gap that matters here. Bound it to **at most three lines**:
    task count + wave shape, the single next command, and where the detail lives
    (`PLAN.md` / `CRITERIA.md`). Say explicitly that the task list is **not** restated in
    chat — `PLAN.md` is the artifact and it stays dense (D1). This slot is the one the
    `astro-planner` agent's own return already satisfies; make the command's obligation match.

### t6 — Bound every reporting slot in `/astro-execute`, including the verdict and the assembled summary
- **file:** `commands/astro-execute.md`
- **depends_on:** —
- The highest-traffic human output in the framework, and today the least bounded.
  - **2b, preflight advisory** — "relay it and suggest `git push`" → **one line**; `ac preflight`
    prints nothing when in sync, so say silence means in-sync.
  - **3, canon refusal relay** — same one-line bound as t5's (same sentence, two files: keep
    the two readings equivalent but do not attempt to share text).
  - **4, `integrationFailed`** — "surface its conflict/cleanup hint and stop" → one line plus
    the hint verbatim.
  - **4b pipeline gate** ✓, **4d debt count** ✓, **4e fixtures verbatim + "silence means
    clean"** ✓, **step-5 capture** ✓ — unchanged, and t11 will guard them.
  - **4c, leaked-ref sweep** — add the missing silence rule: **say nothing when the sweep is
    clean**, and one line per surviving worktree/branch plus its `git rev-list` count. The
    "do not delete anything automatically" rule stays.
  - **5, the verdict** — new, and the point of the phase. Lead with **one line**: PASS/FAIL
    plus the one-line cause from `verdict.summary`. Then the next command, one line. On FAIL,
    **at most one line per unmet criterion** and a pointer to where the full per-criterion
    evidence lives (the workflow log — `/workflows`), never the evidence itself. Say plainly
    that `verdict.summary` is *summarised, not relayed*: the verifier's long-form evidence
    was never the bug (D2/C5).
  - **5, the assembled summary** — one composite shape rule, because five individually-terse
    fold-ins still read as a wall: **verdict first**, then each fold-in at exactly the one
    line or silence it already promises (4c, 4d, 4e, capture), then the next command. Nothing
    else. This is a shape spec, not a length gate (D5).
- Do not remove or reword "say so in exactly one line", "Do not skip silently", "ordering
  trap", or the ADR-008 sequential-fallback prose — `tests/commands.test.mjs` asserts all of
  them today and the wave boundary must stay green.

### t7 — Bound every reporting slot in `/astro-verify`
- **file:** `commands/astro-verify.md`
- **depends_on:** —
  - **3, PASS** — one line: verified + the next command by number. The optional `/clear` nudge
    stays optional and is one line.
  - **3, FAIL** — "list exactly what's missing and stop" is uncapped today. Bound it: **one
    line per unmet criterion** (what is missing, not how it was observed), then where the
    verifier's full evidence is (its returned per-criterion report — available on request),
    then stop. C5 requires the pointer: a bounded summary that leaves the reader no route to
    the detail is its own failure.
  - **3b, debt count** ✓ and **4, capture** ✓ — unchanged.
  - Step 2 spawns the verifier: **add nothing about brevity to the contract restated there.**
    The verifier's instructions ("cite the exact command you ran and its actual output") are
    what C5 protects; the command summarises what the verifier returns.

### t8 — Bound every reporting slot in `/astro-accept`
- **file:** `commands/astro-accept.md`
- **depends_on:** —
  - **1, not verified** — one line plus the override, then stop.
  - **3, the walkthrough** — per checklist item: its statement plus **one line** on how to try
    it (the command to run / URL to open). Not a re-explanation of what was built.
  - **4, accept** — one line: complete + the next suggestion. The ADR-033 signer paragraph is
    instruction to the agent, not output — leave it exactly as it is.
  - **4, reject** — "Summarize the gap" is uncapped today: **at most three lines** — what
    failed, what it blocks, the next command — matching the `--reason` that was just recorded.
  - **5, the `/clear` nudge** — one line, optional, and skipped in silence when it does not apply.

### t9 — Bound every reporting slot in `/astro-status`
- **file:** `commands/astro-status.md`
- **depends_on:** —
  - **1, no `.astrocode/`** — one line pointing at `/astro-new-project`, then stop.
  - **2, `ac registry show`** — add the silence rule: say nothing when no remote is configured;
    one line when it is live.
  - **3, the recommendation** — "In one short paragraph" is a soft bound a reader can argue
    with. Tighten to **at most three lines**: where the project stands, the single best next
    action (by number), and why. Keep the discuss-state fork and the always-reference-by-number
    rule intact.
  - **3b, pipeline nudge** — one line.
  - **4, resting-point nudge** ✓ ("optional one-liner" + "Skip this nudge mid-phase") unchanged.

### t10 — Bound every reporting slot in `/astro-debt`
- **file:** `commands/astro-debt.md`
- **depends_on:** —
  - **1, no open debt** ✓, **2, per item** ✓, **3, assessment** ✓ — the three that already
    clear the bar; leave them and let t11 guard them.
  - **2, the pressure line** — unbounded today: **one line** for the number, its band and what
    it means, before the grouped items.
  - **2, grouping** — the per-file grouping itself needs a shape: file name, then its items,
    one line each. No table.
  - **4, the exits** — a single `AskUserQuestion`; the drop/dismiss distinction is stated in
    **one line** when one is actually run, not explained up front every time.
- Keep step 5's "never file debt from this command" rule untouched.

### t11 — The guard: every slot in the seven loop commands states a bound, and the canon keeps both audiences
- **file:** `tests/commands.test.mjs`
- **depends_on:** t1, t2, t3, t4, t5, t6, t7, t8, t9, t10
- Extends the existing file (reuse its `cmd(name)` reader and the `extractFallbackTier`
  slicing idiom; add nothing to `package.json`). Four groups:
  1. **The slot table (C1/C2).** A `const SLOTS = [...]` of `{ command, slot, start, end }`
     where `start`/`end` are literal anchors from the command source (the numbered-step
     markers `1b.`, `3b.`, `4c.`, `5.` … are stable and already unique per file, or a quoted
     stem from the step). For each entry, slice the source and assert **P4**'s `BOUND_RE`
     matches inside the slice, with a failure message naming **the command file and the slot**
     ("astro-verify.md, step 3 FAIL path: no line budget and no silence rule — a reporting
     slot must say how much it may emit or when it emits nothing"). Also assert each anchor is
     found, so a renamed step fails loudly instead of silently skipping.
     **The table must be built by reading all seven files end to end after t4–t10 land** —
     every human-facing slot, not only the ones this plan names. C2 deletes a bound from *a*
     slot, of the verifier's choosing, in each of the seven; a table that covers a subset
     leaves the suite green and fails the criterion.
  2. **The canon keeps both audiences (C4).** `.astrocode/CONVENTIONS.md` still contains the
     exact phrase `high, explanatory density` (the must-not-weaken guard), AND contains **P1**,
     AND names `PLAN.md` and `CRITERIA.md` as exempt.
  3. **No drift between the two canons (C6).** **P1** is present in *both*
     `.astrocode/CONVENTIONS.md` and `templates/CONVENTIONS.md`; **P2**'s phrase
     `nothing checks it` is present in all four of
     `.astrocode/CONVENTIONS.md`, `templates/CONVENTIONS.md`, `AGENTS.md`,
     `templates/AGENTS.md`. Assert `templates/CONVENTIONS.md`'s Voice section contains no
     `{{` placeholder and no empty `- …:` stem (C6's "a fill-me-in field is not an inherited
     rule"), and that it never mentions `astro-code` or `tests/`.
  4. **The verifier was not silenced (C5).** `agents/astro-verifier.md` still demands cited
     commands and actual output per criterion, and `commands/astro-verify.md` step 3's FAIL
     path names where the full evidence can be found.
- **Assert concepts, not today's prose.** Use `BOUND_RE` and small semantic regexes; the only
  pinned literals are **P1**, **P2** and `high, explanatory density`, each of which is a
  load-bearing sentence this phase is protecting. C3 injects ~200 words of ordinary prose into
  a loop command and requires the suite to stay green: no assertion may count words, lines or
  characters anywhere.
- File header comment states **P5** verbatim: what this guard does and does not cover. A test
  file that implies more coverage than it has is the same dishonesty C7 fails the phase for.

### t12 — A project scaffolded by `ac init` carries the rule on its own
- **file:** `tests/planning.test.mjs`
- **depends_on:** t2, t3
- `initPlanning()` in a `mkdtempSync` root (the file's existing `scaffold()` helper does this
  already), then assert against the **generated** files, not the templates:
  - `.astrocode/CONVENTIONS.md` contains **P1** and **P3**'s exemption, has a `## Voice`
    heading with prose beneath it, and contains no `{{NAME}}` / `{{` residue anywhere;
  - the generated `AGENTS.md` (`initPlanning` writes it via `writeAgentsMd`) contains **P2**'s
    `nothing checks it`;
  - neither generated file mentions `astro-code`'s own repository paths (`tests/`,
    `.astrocode/phases/`) in the Voice text — C6 requires the rule to be readable with
    astro-code absent.
- This is the mechanical half of C6; the verifier still runs the real `node bin/ac.mjs init`
  rehearsal itself.

---

## Wave shape

| wave | tasks | files |
|---|---|---|
| 1 | t1, t2, t3, t4, t5, t6, t7, t8, t9, t10 | `.astrocode/CONVENTIONS.md` · `templates/CONVENTIONS.md` · `AGENTS.md`+`templates/AGENTS.md` · the seven `commands/astro-*.md`, one owner each |
| 2 | t11, t12 | `tests/commands.test.mjs` · `tests/planning.test.mjs` |

Ten independent tasks in wave 1: every task owns its file(s) outright and no two tasks touch
the same file, so nothing collides at integration. Both guards are serialized behind the prose
they guard — deliberately (see *Test posture*): a guard landing in the same wave as its subject
would be red at the boundary, and ADR-020 gates there.

## Criteria coverage

| criterion | tasks |
|---|---|
| C1 every slot states a bound or a silence rule | t4, t5, t6, t7, t8, t9, t10 |
| C2 deleting a bound turns the suite red, naming the command | t11 |
| C3 padded prose stays green (shape, not quality) | t11 |
| C4 both audiences answered; comment rule not weakened | t1, t11 |
| C5 verifier still verbose, command summarises, evidence reachable | t6, t7, t11 |
| C6 a scaffolded project inherits the rule, astro-code absent | t2, t3, t12 |
| C7 the unenforced half says so; no claimed coverage | t1, t2, t3, t11 |
