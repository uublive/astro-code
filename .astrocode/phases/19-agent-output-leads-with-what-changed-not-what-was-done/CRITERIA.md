# Criteria — Phase 19: Agent output leads with what changed, not what was done

> Pre-registered before any plan exists. Derived from the phase goal, CONTEXT.md and the
> project canon (ADR-055) only. The verifier checks these against the finished system with
> its own evidence — never against PLAN.md or a task summary.
>
> `<repo>` below is the astro-code repository root. The loop commands are
> `commands/astro-{discuss,plan,execute,verify,accept,status,debt}.md` (D7).

### C1 — Every human-facing reporting slot in the seven loop commands tells the agent how much it may emit, or when to emit nothing at all

- **Observe:** Read each of `commands/astro-discuss.md`, `astro-plan.md`, `astro-execute.md`,
  `astro-verify.md`, `astro-accept.md`, `astro-status.md`, `astro-debt.md` end to end and
  enumerate every instruction that produces output for the human (report the verdict, print
  the summary, tell the user what happened, surface debt, surface the fixture check, surface
  the preflight/pipeline advisory, …). For each enumerated slot, the surrounding instruction
  must state either an emission bound the agent can obey without judgement (a line/item
  count, "in exactly one line", "at most N lines", a fixed short shape naming what goes in
  it) or a silence rule ("say nothing when there is nothing to report"). The roughly eleven
  brevity instructions that already existed must clear the same bar, not merely be present.
  Grep is useful for locating slots but must not be the evidence: the evidence is that every
  slot found by reading has a bound.
- **Fails if:** any human-facing reporting slot in those seven commands leaves the emission
  open-ended — "report the results", "summarise the findings", "explain what changed" with
  no count, no shape and no silence rule; or a pre-existing negative-only instruction ("do
  not list them in full") is left standing without saying what the agent emits instead; or
  slots were counted as covered by the presence of a `## Report` heading rather than by a
  stated bound.

### C2 — Deleting a slot's bound from any one of the seven loop commands turns the suite red, naming that command

- **Observe:** In a clean checkout run `cd <repo> && npm test` → exit 0 (baseline). Then, for
  each of the seven loop commands in turn, use Bash (`perl -0pi -e` / `sed -i`) to delete the
  budget-or-silence wording from one human-facing reporting slot in that file, run `npm test`
  again, record the exit code and the failure message, then `git checkout -- commands/<f>.md`.
  Expected: seven mutations, seven non-zero exits, each failure message identifying the
  command (and ideally the slot) whose bound went missing.
- **Fails if:** the suite stays green after any of the seven bounds is deleted (the guard
  covers one or two files and the rest are convention-only, or it asserts something that
  survives the deletion — e.g. it matches a heading, a step number, or a word that also
  appears elsewhere in the file); or the baseline suite is not green; or a mutation's failure
  message does not say which command regressed.

### C3 — Enforcement stops at slot shape: prose that gets longer while its bound stays stated does not fail anything

- **Observe:** With the working tree clean and `npm test` green, use Bash to inject roughly
  200 extra words of ordinary explanatory prose into a loop command — some inside a reporting
  step's rationale, some in surrounding narrative — while leaving every slot's stated bound
  textually intact. Run `npm test` → still exit 0. Restore with `git checkout --`.
- **Fails if:** the suite goes red on the padded file (a word-count, line-count or
  prose-length gate crept in — the thing the phase explicitly rejected, because it produces
  worse writing rather than shorter reports); or the guard passes only because it inspects
  nothing at all, which C2 must independently have ruled out.

### C4 — The canon gives opposite, unambiguous answers for the two audiences, and the code-comment rule is not weakened

- **Observe:** Read `<repo>/.astrocode/CONVENTIONS.md` and answer both questions from it
  alone: (a) "how dense should a code comment be?" → still high, explanatory density, module
  headers saying *why* and which bug a choice prevents; (b) "how should I write a report to a
  human?" → lead with the decision or the change, keep evidence short and beneath it. Each
  answer must name the audience it governs, so neither can be applied to the other. The
  human-facing rule must also state that machine-read artifacts (`PLAN.md`, `CRITERIA.md`)
  are exempt and stay as dense as they need to be.
- **Fails if:** the existing comment-density rule was deleted, softened, or folded into a
  single "be concise" rule covering both audiences (an agent reading canon would then thin
  code comments); or the human-facing rule is stated without an audience, so a planner
  reading it would trim `PLAN.md`/`CRITERIA.md` — the detail that caught bugs a green suite
  missed; or the two rules contradict each other with no scoping to tell them apart.

### C5 — The full evidence is still produced; only the channel to the human is bounded

- **Observe:** Read the verifier agent definition (`agents/astro-verifier*.md`) together with
  `commands/astro-verify.md` and `commands/astro-execute.md`. The verifier's instructions for
  its structured return and its log must still demand complete per-criterion evidence —
  reproductions, commands run, observed output — with no brevity budget applied to them. The
  command that reports to the human must lead with the verdict plus a one-line cause, carry a
  bound (C1), and say where the full evidence can be found. Confirm by reading what each
  audience is told, not by counting words.
- **Fails if:** the noise was "fixed" by telling the verifier to write less — a line budget,
  "keep it brief", or a dropped evidence field anywhere in the verifier's structured
  return/log instructions; or the human-facing verdict slot relays the verifier's full
  evidence unbounded; or the human summary is bounded but leaves the reader no way to reach
  the detail it dropped.

### C6 — A project scaffolded by astro-code carries the human-facing voice rule in its own canon, with astro-code nowhere in sight

- **Observe:** `d=$(mktemp -d) && cd "$d" && git init -q && node <repo>/bin/ac.mjs init --name probe`,
  then read `"$d"/.astrocode/CONVENTIONS.md` (and the generated `AGENTS.md`). The generated
  canon must state, as directly usable guidance for that project's own agents, that
  human-facing output leads with the decision or the change and keeps evidence short beneath
  it — readable and obeyable with astro-code's repository absent.
- **Fails if:** the generated canon has no guidance on writing to a human; or it carries only
  a bare `## Voice` heading with a blank or `{{…}}`-placeholder body, or a fill-me-in field
  like the Stack entries (a rule the project must supply is not an inherited rule); or the
  guidance exists only in astro-code's own `.astrocode/CONVENTIONS.md`; or it is a pointer
  ("see astro-code's conventions") rather than the rule itself.

### C7 — The unenforced half says so: the narration rule is stated as convention, and nothing claims coverage it does not have

- **Observe:** Read the free-form-narration rule (prose between tool calls) wherever it lands
  in `<repo>/.astrocode/CONVENTIONS.md`, `templates/CONVENTIONS.md` and `AGENTS.md` / the
  `AGENTS.md` generated in C6's temp project. Each statement of it must be plainly labelled
  as convention that nothing checks. Then cross-check every claim the phase's shipped text
  makes about enforcement against C2/C3's observed behaviour: the guard's reach is slot shape
  in the loop commands, nothing more.
- **Fails if:** the narration rule appears anywhere without the unenforced label, so a reader
  assumes it is checked; or any shipped text claims or implies the guard test covers
  free-form prose, output quality, or the commands outside the audited seven — the same class
  of dishonesty as a success line reporting intent instead of outcome.
