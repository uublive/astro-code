# Phase 52 — Success criteria (pre-registered, plan-blind)

> Derived from the phase goal, CONTEXT.md (D1-D7) and the canon only. Scenarios below use a
> throwaway project under a temp dir (`mkdtemp`, `git init`, `ac init`, one phase with a
> CRITERIA.md of several criteria whose Observe lines name distinct files/commands, at least one
> suite criterion whose evidence is the project's full test run, and one `[mutation]` criterion),
> with verdicts written through `ac verdict record` and decisions read through `ac verdict plan
> <phase> --json` (or whichever ac verb the finished system uses to decide the next verify's
> scope — ADR-079 names `ac verdict plan` as the single decider). "Full PASS" = a recorded PASS
> in which every criterion was observed.

### C1 — After a recorded full PASS, a small follow-up diff yields a targeted verify whose floor is exactly the criteria that diff can affect, and the decision is deterministic
- **Observe:** In the fixture, record a full PASS at commit A. Commit a change touching only a file/command named by criterion C2 (and nothing a suite or `[mutation]` criterion depends on). Run the scope decision (`ac verdict plan <phase> --json`) twice. Both runs print identical output; mode is targeted; the floor set contains C2 and does not contain the criteria whose named files/commands the diff did not touch; every criterion outside the floor is listed as carryable with A's run id and commit A. The human-readable form states the mode and the reason (e.g. "targeted: N of M criteria affected since full PASS at <A>").
- **Fails if:** the run is full despite a one-file follow-up after a full PASS; the floor omits the criterion whose named file changed; the floor includes every criterion (no narrowing); two runs on the same tree disagree; or the output does not name the mode and why.

### C2 — A phase's first verify, a broad diff, a moved base, and `--full` each run full, and each says so with its own reason
- **Observe:** In fresh fixtures, run the scope decision (a) with no recorded verdict at all, (b) with only a recorded FAIL or a targeted PASS and no full PASS, (c) after a full PASS followed by a commit touching files named by more criteria/files than the broad-diff threshold, (d) after a full PASS whose commit is no longer an ancestor of HEAD (e.g. HEAD reset to a sibling branch), and (e) after a full PASS plus a one-file change but with `--full`. Each reports mode full with a reason distinguishing the case. `--fulll` (typo) is refused with a non-zero exit rather than silently running targeted.
- **Fails if:** any of (a)-(e) yields a targeted mode or carryable criteria; the reason is missing or identical across cases so the human cannot tell why; or an unknown flag degrades into a narrowed run.

### C3 — The verifier may widen the floor but never shrink it: a targeted verdict that leaves a floor criterion unobserved cannot mark the phase verified
- **Observe:** From the C1 state (floor = {C2, plus any never-carry criteria}), record (i) a targeted PASS that observes the floor plus one extra criterion and carries the rest — accepted, phase becomes verified; (ii) a targeted PASS that marks a floor criterion as carried (or omits it) — refused with a non-zero exit or recorded without changing the phase to verified, and the message names the missing floor criterion. Check `ac phase show <phase>` status after each.
- **Fails if:** (ii) marks the phase verified; (i) is refused because it observed more than the floor; or the refusal does not name which floor criterion was skipped.

### C4 — Every carry cites the phase's most recent full PASS (run and commit) at an ancestor of HEAD — one hop, never a carry of a carry
- **Observe:** Record full PASS F1 at commit A; commit a small change; record targeted PASS T1 at commit B (valid per C3). Commit another small change at C and run the scope decision: carryable criteria cite F1/commit A, never T1/commit B. Then attempt to record a targeted PASS at C whose carried criteria cite T1 — refused / not verified. Record a second full PASS F2 at D, change, and re-plan: carries now cite F2/D, never F1. Also attempt a carry citing a full PASS whose commit is not an ancestor of HEAD — refused / not verified.
- **Fails if:** any carry is allowed to cite a targeted run; carries cite an older full PASS when a newer one exists; a carry citing a non-ancestor commit is accepted; or successive targeted verifies compare against the previous targeted run instead of the same full PASS.

### C5 — A criterion whose files the diff since the full PASS touched is never carried
- **Observe:** After full PASS at A, commit changes touching files named by C2 and C3. Attempt to record a targeted PASS that observes C2 but carries C3. It is refused or leaves the phase not verified, naming C3. The scope decision for the same tree lists both C2 and C3 in the floor.
- **Fails if:** a criterion whose named file/command changed since the cited full PASS can be recorded as carried and the phase still reaches verified.

### C6 — A suite criterion is re-checked on every targeted verify unless a passing suite receipt covers the exact clean tree being verified
- **Observe:** After a full PASS at A, commit a change touching only a file unrelated to the suite criterion's named paths. With no receipt for HEAD, the scope decision lists the suite criterion in the floor, and a targeted verdict that carries it is refused / not verified. Then record a passing suite receipt (the project's suite command, exit 0) on HEAD with a clean tree: the suite criterion may now be satisfied by citing that receipt, and the verdict records it as such (citing the receipt, not the full PASS).
- **Fails if:** a suite criterion is carried from the full PASS on any diff; or a receipt is not accepted as evidence on the exact clean tree it was taken on.

### C7 — Suite receipts are reused only on the identical clean tree, the same command and a passing exit — and refused otherwise
- **Observe:** Record a passing suite receipt at commit X with command K on a clean tree. Then query reuse (via whatever ac surface the verifier uses to look up a reusable receipt, or by attempting to cite it in a verdict) in each of: (a) same X, clean, K — reused; (b) X with an uncommitted modification to a tracked file — refused; (c) X with a new untracked file in the source tree — refused or explicitly accounted for as not affecting the tree; (d) a later commit Y — refused; (e) same X, different command K' — refused; (f) a receipt whose exit was non-zero — never reused as a pass. Also write a receipt while the tree is dirty and confirm it is never offered for reuse. The receipt records command, commit, clean-tree result, exit status and time.
- **Fails if:** any of (b)-(f) reuses the receipt; a receipt taken on a dirty tree is later reused; or a reused receipt is not cited (the verdict cannot show which receipt stood in for a run).

### C8 — A test-strength criterion is re-checked whenever any file in its mutate scope changed, and only then may it be carried
- **Observe:** With a `[mutation]` criterion and, separately, an untagged criterion previously marked `test_strength` in a recorded verdict (ADR-085), record a full PASS at A. Commit a change to a file inside the phase's mutate scope (the phase's changed files that `ac mutate` would target) but not named in either criterion's Observe line: the scope decision puts both test-strength criteria in the floor and a verdict carrying either is refused / not verified. Repeat with a change only to a file outside the mutate scope: both may be carried.
- **Fails if:** a test-strength criterion is carried after a change inside its mutate scope; the sticky `test_strength` mark is ignored for untagged criteria; or test-strength criteria are forced into the floor on every diff regardless of scope (no narrowing at all for them).

### C9 — A targeted PASS meeting every carry condition marks the phase verified, and a targeted FAIL does not
- **Observe:** From the C1 state, record a valid targeted PASS (floor observed, every other criterion carried with a valid full-PASS citation, suite/test-strength rules satisfied). `ac phase show <phase>` reports the phase verified and the roadmap lifecycle moved to verified. In a separate copy, record a targeted verdict where a floor criterion failed: the phase is not verified and the FAIL is saved so a later re-verify can narrow on it.
- **Fails if:** a valid targeted PASS is refused because not every criterion was observed in one run (the pre-amendment ADR-079 rule still blocking); or a targeted FAIL, or a targeted PASS breaking any carry condition, reaches verified.

### C10 — The re-verify after a FAIL keeps ADR-079's behaviour unchanged
- **Observe:** In a fixture whose latest recorded verdict is a FAIL with one or two unmet criteria (and no later full PASS), run the scope decision: it still reports the narrowed-after-FAIL behaviour (unmet criteria checked first) and still requires a run that checks every criterion before the phase can be verified — no criterion is offered as carryable from an earlier full PASS across that FAIL unless the goal's own carry conditions are met by a full PASS later than the FAIL. The existing ADR-079 tests in the repo's suite still pass.
- **Fails if:** a FAIL re-verify now carries criteria that ADR-079 required to be re-observed, or the existing narrowed-after-FAIL tests are deleted/weakened to make the new behaviour pass.

### C11 — The verdict record names, per criterion, whether it was observed or carried, and carried ones cite their source run and commit
- **Observe:** After the valid targeted PASS of C9, read the phase's saved VERDICT.json: every criterion id from CRITERIA.md appears exactly once with a status of observed or carried; each carried entry names the full PASS run and its commit (or, for a suite criterion, the receipt it cited); the verdict records the mode (targeted/full) and its reason. A full PASS records every criterion as observed.
- **Fails if:** any criterion is missing, appears twice, or has neither status; a carried entry lacks its source run/commit; or the mode is not recorded.

### C12 — `ac phase show` and the `/astro-accept` flow show the human which criteria were carried rather than re-observed
- **Observe:** On the C9 fixture run `ac phase show <phase>`: it lists each carried criterion with the run and commit it came from (and says when none were carried, or stays silent per the Voice rule, on a full PASS). Read `commands/astro-accept.md` and run the ac command(s) its display step invokes against the same fixture: the output the human sees before signing lists the carried criteria and their sources.
- **Fails if:** `ac phase show` gives no way to see which criteria were carried; or the accept flow presents a targeted PASS indistinguishably from a full one.

### C13 — The canon and the docs state the new rule, and the whole suite stays green
- **Observe:** Read `.astrocode/DECISIONS.in-force.md` (regenerated as the project does): an in-force decision states that a targeted pass may mark a phase verified only under the D2/D4/D5 conditions (most recent full PASS at an ancestor, untouched files, never-carry suite/test-strength criteria, one hop) and says it amends ADR-079; ADR-079 itself remains in force for the after-FAIL case. MANUAL and CHANGELOG describe targeted verify, `--full`, the stated mode, and suite receipts consistently with that decision. Run the repo's full test suite (`node --test` as the project runs it, via `host` if services are needed): exit 0.
- **Fails if:** no in-force decision records the amendment, or it contradicts the behaviour observed in C3-C9; docs describe a different rule (e.g. that a targeted run never verifies); or the suite fails.
