# Acceptance — phase 53: registry-claimed ADR numbers

Each item names the state the project must already hold before it can be checked. Build fixtures in
a scratch dir, never in this repo.

- [ ] **The user can add a decision from two clones at once and get two different numbers, each in both
  stores.**
  *Precondition:* a bare remote and two clones (`alice`, `bob`) on separate feature branches; the
  default branch holds `docs/adr/0001…0010` and a DECISIONS.md; `ac registry init` and
  `ac decision backfill --apply` have run.
  *Check:* run `ac decision add` in both at the same time → each gets one new `docs/adr/<N>-….md` and a
  matching `## ADR-<N>` heading, the two `<N>` differ and are above 0010.

- [ ] **The user can see which ADR folder was used and why, switch it, or turn it off — and a project
  without one is unchanged.**
  *Precondition:* (a) a project with `adr/` holding 3-digit files; (b) the same with
  `ac config set decisions.adr_dir <other>`; (c) with `decisions.adr_dir off`; (d) a project with no ADR
  folder whose DECISIONS.md uses `ADR-NNN`.
  *Check:* `ac decision add` reports "detected"/"configured" and writes a 3-digit file in (a), writes into
  `<other>` in (b), writes only the DECISIONS entry in (c), and in (d) writes today's entry with no folder.

- [ ] **The user (or an agent) is stopped from hand-writing an ADR under an unclaimed number, but can still
  edit claimed ones.**
  *Precondition:* a backfilled ADR project with `ac mods enable canon-guard` on.
  *Check:* an agent's attempt to create `docs/adr/0150-x.md` or add `## ADR-0150` to DECISIONS.md is
  refused with a message naming `ac decision add`; editing the text of an existing claimed ADR goes through.

- [ ] **The user can run `ac doctor` or `ac canon check` and see every bad ADR number with the command
  that fixes it, without anything being changed.**
  *Precondition:* a backfilled ADR project seeded by hand with an unclaimed file, two files sharing one
  number, a 3-digit `## ADR-0xx` heading, and a file whose DECISIONS entry has a different title.
  *Check:* each problem is its own line ending in an `ac decision renumber …` (or claim) command;
  `git status` and the registry tip are the same before and after.

- [ ] **The user can upgrade an existing project once: old log entries become `D-NNN`, folder ADRs keep
  their numbers, and a second run does nothing.**
  *Precondition:* a pre-phase project: `docs/adr/0001…0010` (two files numbered 0007), DECISIONS.md
  `ADR-001…006` (one entry with the same title as `docs/adr/0003`), a doc citing `ADR-002` and `ADR-0002`.
  *Check:* `ac decision backfill` shows the plan and writes nothing; `--apply` relabels the log to `D-…`,
  keeps the 0003 mirror as `ADR-0003`, turns `ADR-002` into `D-002` and leaves `ADR-0002`, reports 0007
  with a renumber command; the next `ac decision add` gets 0011; re-running changes nothing.

- [ ] **The user can move one colliding ADR to a fresh number and have only its own branch's references
  follow it.**
  *Precondition:* alice's and bob's branches each added a different `0042` ADR plus citations, both merged
  into the default branch, and one more `ADR-0042` citation committed on the default branch afterwards.
  *Check:* `ac decision renumber <bob's 0042 file> next` gives bob's file, heading and DECISIONS entry one
  new claimed number, rewrites bob's citations only, lists the post-merge citation for a human, and lists
  every file it changed.

- [ ] **The user gets a clear refusal, not a guessed number, when the registry cannot be reached.**
  *Precondition:* an ADR project whose registry remote points at a missing path.
  *Check:* `ac decision add "x" --why "y"` exits non-zero naming the registry, and `git status` shows no new
  DECISIONS entry or ADR file.
