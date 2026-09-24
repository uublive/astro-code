# Phase 23 — Capture at the moments of intent: success criteria

> Pre-registered, plan-blind. Derived from the phase goal, CONTEXT.md (D1–D6) and canon
> (ADR-029, ADR-030, ADR-033, ADR-037, ADR-055, ADR-057, ADR-058) only.
> Most of this phase lives in the prose layer (commands/templates). Where a criterion says
> "read the command", the verifier inspects what the command tells an agent to DO at that
> moment and checks it against the actual CLI and on-disk state. Any gate or helper the
> implementation made mechanical must be DRIVEN, not just read.
> Store isolation for every command below: `export HOME=$(mktemp -d)` (the store lives under
> `~/.astro/principles/`, ADR-057), run from a scratch project made with `mktemp -d` + `git init` + `ac init`.

### C1 — Every capture moment lands its proposals in the personal store as `proposed` (never accepted), with the ADR, phase or milestone ref, the user's own words and the project name as evidence
- **Observe:** For each of the four moments (`/astro-decision` after the ADR is recorded,
  `/astro-discuss` after CONTEXT.md is captured, `/astro-accept` on a rejection,
  `/astro-complete-milestone` sweep), read the capture step and take the exact propose
  invocation it prescribes, or the helper or verb it calls. Fill it in with sample values: a ref
  suited to the moment (ADR id / phase / milestone), a quoted excerpt, and a project name.
  Leave out the session id. Run it under an isolated HOME. Then run `ac principles list --proposed`
  (same HOME). It must show each entry as proposed, with one of the four kinds
  (Principle/Pattern/AntiPattern/Preference), a why, the ref, the excerpt and the project. The
  full `ac principles list` must show no accepted/active entry that capture created.
- **Fails if:** Any prescribed invocation exits non-zero. Likely causes: an unknown or misspelled flag (ADR-029 dies on
  these), a hard dependency on a session id that is unavailable, or a flag phase 22's propose path
  does not have. Also fails if an entry is created accepted/active, if the ref, excerpt or project
  is missing, or if the ref names the wrong thing (e.g. a discuss capture citing an ADR
  instead of the phase).

### C2 — Capture goes only through the propose path, so a human-decided entry is never changed by a capture
- **Observe:** Using the phase-22 CLI in an isolated HOME, pre-seed three entries with the same text: one
  accepted, one rejected with a reason, and one edited by the user. Run each moment's prescribed propose invocation
  (from C1) with that same text. Afterwards `ac principles list` (all statuses) shows all three
  entries unchanged in status, text and rejection reason. No duplicate of them is promoted to
  accepted.
- **Fails if:** A capture path writes the store files directly, calls an accept/edit verb,
  or otherwise bypasses ADR-058. Examples: a rejected entry flips back to `proposed`, an accepted
  entry's text is overwritten, or a rejection reason is lost. (Plain duplicate *proposals* are
  the accepted known gap and do not fail this criterion.)

### C3 — Moments answered by an agent propose nothing: agent-captured discussions, agent-signed accept/reject, and their use as milestone-sweep input
- **Observe:** (a) Read the `/astro-discuss` capture step. It must be skipped before any propose call when
  CONTEXT.md carries `<!-- astro-discuss: captured by agent: … -->`, and it may run only for the
  human `<!-- astro-discuss: captured -->` marker. If the check is mechanized (e.g. through
  `contextAuthor()` or an `ac` verb), drive it with two scratch CONTEXT.md files, one per marker.
  Only the human one may be judged eligible.
  (b) In a scratch project, reject a phase the way `/astro-accept` tells an agent stand-in
  to. The command must accept the flags it is given (no unknown-flag death). The recorded
  rejection must be distinguishable on disk from a human rejection, and the capture step must
  skip it.
  (c) Read the milestone-close sweep. It must exclude agent-captured CONTEXT files and
  agent-signed rejections from the material it proposes from.
- **Fails if:** The discuss gate tests only for the substring `astro-discuss: captured`,
  which also matches the agent marker (the ADR-037 trap), so agent discussions propose. Also fails if
  the gate sits after the propose call. Also fails if an agent rejection cannot be declared (e.g. `ac phase reject` dies on the
  flag the command prescribes) or is recorded identically to a human one, so the gate has
  nothing to key on. Also fails if headless (astro-fleet-style) discussions or agent rejections still reach
  the store directly or through the sweep.

### C4 — `/astro-accept` proposes only on a rejection, from the user's own reject reason; a plain acceptance proposes and prints nothing extra
- **Observe:** Read `/astro-accept`. The capture step must be reachable only on the rejection path.
  Its excerpt must be the reject reason the human gave, not an agent paraphrase or the
  verifier's evidence. Nothing on the acceptance path proposes a principle or adds a
  capture output line.
- **Fails if:** A plain acceptance proposes anything or prints a "proposed …" line. Also fails if the
  rejection capture sources its excerpt from something other than the human's reason. Also fails if the
  rejection path has no capture step at all.

### C5 — Each moment proposes at most 3 principles and only ones that survive the lift rule, each carrying its why. It ends with exactly one line naming the count and a review command that works. When nothing qualifies it proposes nothing and prints nothing
- **Observe:** Read the capture rules every moment follows. They must state: the cap of 3 per moment; the
  lift rule (strip every project noun, filename, number and proper name; if what remains is
  vacuous or untrue as a general rule, capture nothing); a why required on every proposal;
  a single closing line of the form `proposed N principle(s) — <review command>`; and no line
  at all for zero. No inline accept prompt is allowed. Then, in the isolated HOME populated in C1, run the
  review command that line names verbatim. It must exit 0 and list those proposals. Confirm
  each of the four commands' reporting slot for capture states this one-line/silence bound
  (ADR-055).
- **Fails if:** Any moment has no cap, or a cap other than 3. Also fails if a zero-proposal run prints a line
  (e.g. "proposed 0 principles"), if the command stops to ask the user to accept inline, if a
  proposal can be made without a why, or if the named review command errors or uses a flag the
  CLI rejects.

### C6 — The capture rules (lift, volume, one-line, human-only) are written in one place that every capture command points to, and that pointer resolves in an installed copy
- **Observe:** Read the four capture commands and the templates. Find the one place the capture rules
  are stated in full. Each command must point to it rather than restating the rules. Resolve each pointer
  exactly as the command does (e.g. run the `$(ac path templates)`-style expression it uses)
  from the repo, and also from an install made with `ac install` into a scratch target (isolated HOME). The
  referenced file must exist there and hold the rules. `templates/forge-knowledge.md` must no
  longer hold a live copy of the lift rule or the WRITE protocol that could diverge from it.
- **Fails if:** A pointer dangles in the installed copy (the spec was not shipped, or the path
  expression is wrong). Also fails if two commands carry their own, differing wording of the lift or cap rules,
  or if forge-knowledge.md keeps a second live statement of the rule.

### C7 — astro-code no longer writes to the forge graph, while its forge reads keep working as before
- **Observe:** Read every command, agent, template and workflow, both in the repo and in the scratch
  install from C6. No step tells an agent to call a forge capture/write tool, and no
  `allowed-tools` still grants one (in particular `/astro-decision` and `/astro-execute`).
  `templates/forge-knowledge.md` no longer describes astro-code as a forge writer. It may keep the
  protocol only if clearly marked historical/inactive. The forge READ before
  discuss/plan/new-project is still present, with its absent-is-silent degradation intact
  (ADR-030).
- **Fails if:** A write tool is still grantable anywhere, even where the instruction to call it was deleted.
  Also fails if a live instruction to capture into forge survives in any command, or if the forge reads were removed or
  changed along with the writes (out of scope, D1).

### C8 — `/astro-execute` writes a short surprise note in the phase directory only when a run actually hit a surprise. It proposes nothing, prints nothing extra, and writes in the form the milestone sweep reads
- **Observe:** Read `/astro-execute`'s end-of-run step. It must write a note when `healed` is non-empty,
  `remediationCycles > 0`, or `stoppedReason` is no-progress/max-cycles. The note records which signal
  fired and for which phase. It is written inside that phase's directory. A clean run (none of those signals) writes nothing. No
  propose call and no added output line appear anywhere in execute. Cross-check that the location and format execute
  writes are exactly what the milestone-close sweep reads. If note-writing is mechanized, drive it
  with one synthetic result carrying a signal and one clean result, then inspect the phase directory.
- **Fails if:** Execute proposes a principle, prints a capture/surprise line, or writes a note
  on a clean run. Also fails if it writes outside the phase directory (e.g. into `~/.astro`), or if it writes a
  filename or format the sweep never reads. In that case the notes pile up unused, which is the silent integration hole.

### C9 — The milestone-close sweep proposes from the milestone's own ADRs, CONTEXT files, rejection reasons and surprise notes, treating recurrence across phases as the signal
- **Observe:** Read `/astro-complete-milestone`'s sweep. It must read all four sources, scoped to
  the milestone being closed. It must state that a single surprise proposes nothing and that a
  pattern recurring across phases is what qualifies. It follows the cap/lift/one-line rules (C5).
  Check that rejection reasons actually survive to close time: in a scratch project,
  `ac phase reject <p> --reason "<text>"`, then accept the same phase, then perform the exact
  read the sweep prescribes. The reason text must still come back.
- **Fails if:** A source the sweep depends on does not persist to milestone close. For example,
  rejection reasons printed only at reject time, or cleared when the phase is later accepted, so the
  sweep reads nothing. Also fails if the sweep ranges over the whole project history rather than the milestone,
  proposes one-off surprises, or omits one of the four sources.

### C10 — The full test suite passes, including the reporting-slot guard, and never touches the real user's store
- **Observe:** Record a listing of the real `~/.astro/principles/` (or its absence). Run
  `node --test tests/` from the repo root and confirm exit 0 with 0 failures. Then confirm the real store
  listing is byte-identical to before.
- **Fails if:** Any test fails, including `tests/commands.test.mjs` rejecting a capture
  reporting slot that states no bound. Also fails if running the suite creates or modifies anything in the
  real user's principle store.
