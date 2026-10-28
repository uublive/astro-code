# Criteria — Phase 54: Verify in fewer, cheaper rounds

<!-- Pre-registered plan-blind from the goal, CONTEXT.md (D1-D9, folded-in backlog + debt) and canon.
     The core/edge tag syntax is an open item for this phase's planner, so no criterion here carries one:
     every criterion below is core by D2's fail-closed rule (untagged = core) and none is deferrable.
     Scratch fixtures mean a throwaway project under mkdtemp (real git, as tests/registry.test.mjs does),
     never this repo's own .astrocode state. -->

### C1 — A FAIL verdict reports every unmet criterion the run observed, including on a narrowed re-verify
- **Observe:** In a scratch project with a phase whose CRITERIA.md holds C1-C5, record (`ac verdict record`, `lib/verdict.mjs`, `bin/ac.mjs`) a FAIL verdict in which C2 and C4 are unmet; the FAIL output, `ac verdict show <phase>` (or the equivalent read-back) and the saved verdict all name both C2 and C4. Then record a narrowed re-verify (ADR-079 path) whose previously unmet C2 is still unmet and which also observed C3 failing: the recorded FAIL lists C2 and C3, not just C2. Read the verifier contract (`agents/astro-verifier.md`, `commands/astro-verify.md`) and confirm it instructs a stop-early run to return every unmet criterion it observed, not the first one.
- **Fails if:** any observed unmet id is dropped from the recorded verdict or its report; the narrowed path keeps only the carried-over unmet ids; or the verifier contract still lets a run stop at the first failure without listing the others it saw.

### C2 — A verify runs a cheap first pass and, when it finds a failure, stops with a FAIL before any expensive scenario runs
- **Observe:** Drive `workflows/execute-phase.mjs` (and the `/astro-verify` path in `commands/astro-verify.md` / `lib/verifyrun.mjs`) with stubbed `agent()`/`phase()` hooks, as the existing workflow tests do, so the first verify stage reports an unmet criterion: the run ends that verify with a FAIL listing every unmet id from the cheap stage, and no expensive/adversarial verifier stage is spawned in that round. With a clean cheap stage, the expensive stage does run. Confirm the cheap stage's suite check accepts a valid suite receipt (`lib/receipts.mjs`, ADR-089) instead of re-running the suite on an identical clean tree.
- **Fails if:** the expensive stage is spawned after a cheap-stage failure; the cheap-stage FAIL lists fewer unmet ids than the stage observed; a clean cheap stage skips the expensive stage; or the cheap stage always re-runs the suite even when a matching receipt exists.

### C3 — A phase can never reach verified on cheap-pass evidence or with a core or suite criterion unmet, unobserved or deferred
- **Observe:** In a scratch project, try each of these and confirm `ac verdict record` / `ac phase verify` (`lib/verdict.mjs`, `bin/ac.mjs`) refuse with a non-zero exit and leave the phase state not `verified`: (a) a PASS whose evidence comes only from the cheap first stage; (b) a verdict with an untagged or core criterion unmet; (c) a verdict with a `[suite]` criterion unmet; (d) a hand-written verdict that marks a core, untagged or suite criterion `deferred`. Existing guarantees still hold: `node scripts/test.mjs` keeps the ADR-079/ADR-089 verdict tests passing.
- **Fails if:** any of (a)-(d) yields `verified`; or the change loosens an existing carry/narrowing rule so a previously refused verdict is now accepted.

### C4 — Only a human-chosen deferral of an edge criterion is accepted, and it opens a tracked fix pre-filled with the failure
- **Observe:** In a scratch project whose CRITERIA.md tags C2 edge (using the syntax the criteria-author contract prescribes), C3 core, leaves C4 untagged and has a `[suite]` C5, record a FAIL with C2-C5 unmet. Then: the FAIL report lists C2 (only) as deferrable; the deferral command (`ac verdict defer <phase> C2` or the name `ac help` lists) succeeds, a new fix appears in `ac fix list` whose reproduction contains the verifier's failing command and its output for C2, and the verdict now shows C2 as `deferred` with that fix id. Deferring C3, C4 or C5 exits non-zero with a reason and changes neither the verdict nor the fix register (`lib/fixes.mjs`). A verdict submitted through the verifier's record path that already marks C2 `deferred` does not produce a deferral (the verifier cannot defer).
- **Fails if:** a core, untagged or suite criterion can be deferred; the fix is opened without the failing command and output; the verdict does not link the fix id; the FAIL report omits or over-lists deferrable ids; or any path defers without the human naming the criterion (automatic or verifier-made deferral).

### C5 — With its failed edge criteria deferred, a phase verifies once every non-deferred criterion passes, and not before
- **Observe:** Continue the C4 fixture: after deferring C2, a verdict where C1, C3, C4, C5 pass lets `ac phase verify` mark the phase `verified` and the phase can then be accepted (`ac phase accept`). A second fixture where a non-deferred criterion is still unmet keeps the phase short of `verified`.
- **Fails if:** a deferral leaves the phase unable to verify though all non-deferred criteria pass; or the phase verifies while any non-deferred criterion is unmet.

### C6 — Open deferred fixes are shown at acceptance and in status, and block closing their milestone
- **Observe:** With the C5 fixture verified and its deferred fix open: `ac phase show <phase>`, `ac status` and the status band (`lib/statuslinegauges.mjs` or wherever the band is rendered) each name the open deferred fix; the output `/astro-accept` (`commands/astro-accept.md`) presents to the human names it; `ac milestone complete` (`lib/milestone.mjs`) exits non-zero naming the fix. After the fix is accepted/closed through `ac fix`, `ac milestone complete` no longer refuses on that account.
- **Fails if:** any of those surfaces omits an open deferred fix; milestone close succeeds while one is open; or it still refuses after the fix is closed.

### C7 — A "broad fix" claim is accepted only when it names files the criteria file map supports; otherwise the run stays narrowed and says why
- **Observe:** In a scratch project with a FAIL verdict on file, feed `ac verdict plan` and `ac verdict record` (`lib/verdict.mjs`, `lib/impact.mjs`) a re-verify that claims the fix is broad: (a) naming no files; (b) naming only files no criterion's file map refers to; (c) naming files the file map ties to criteria. (a) and (b) are refused as broad: the run is planned/recorded as narrowed and the output states the claim was unsupported and why; (c) is accepted and the run is full.
- **Fails if:** a bare "broad" assertion with no files, or one naming unmapped files, still forces a full run; a supported claim is refused; or a refusal gives no reason.

### C8 — When failures are known mid-verify, remediation starts in its own worktree while the verifier keeps checking an unchanged tree, and the fix lands only after the verdict
- **Observe:** Drive `workflows/execute-phase.mjs` with stubbed hooks recording each spawn's order, isolation and arguments, with `use_worktrees` on: once a verify stage reports failures, the remediation executor is spawned with worktree isolation before the verifier's remaining work returns; the verifier's spawn is not on that worktree; the integrator folding the fix branch runs only after the verdict is in. With `use_worktrees` off (or no worktree support), the executor is spawned only after the verify completes. The executor contract (`agents/astro-executor.md`) states it works on its own branch during an overlapped verify.
- **Fails if:** the fix is integrated (or committed to the verified tree) before the verdict; the verifier runs on the fixing worktree; with worktrees on, remediation still waits for the whole verify; or with worktrees off, remediation runs in parallel with verification on the same tree.

### C9 — A declared expensive setup step is reused only when both its exact command and its commit match, stored locally under a size cap
- **Observe:** In a scratch git project, declare a setup step whose command appends a line to a counter file and produces an output (declaration format per the phase's docs/`MANUAL.md`), and run it through the phase's setup runner twice at the same commit: the counter shows one execution and the second run reports a reuse. Change one character of the command, or point it at a different commit: it executes again. A step that exits non-zero is not reused. The cached results live under `.astrocode/.local/` and `git status` shows nothing new to commit. With the size cap set low, adding entries evicts the oldest first and the total stays under the cap.
- **Fails if:** a cached result is reused for a different command or commit; a matching step re-executes; a failed step is reused; the cache is written to a tracked path; or eviction removes newer entries before older ones or lets the cache exceed the cap.

### C10 — Every recorded verdict is appended to a history that `ac verdict history <phase>` reads back in order
- **Observe:** In a scratch project, record three verdicts for one phase (FAIL, FAIL, PASS) with `ac verdict record`; the phase folder holds an append-only `VERDICTS.jsonl` beside `VERDICT.json` with three lines, the first two byte-identical to what they were after their own run; `ac verdict history <phase>` lists the three runs oldest-first with each run's status, commit and unmet ids (`lib/verdict.mjs`, `bin/ac.mjs`).
- **Fails if:** a run is missing from the history; an earlier line is rewritten or reordered; or the history command omits status, commit or unmet ids.

### C11 — A criterion that passed earlier in the phase and now fails is flagged as flapping, with whether its files changed since, and the flag never changes the verdict
- **Observe:** In a scratch project: run 1 PASS with C2 at commit A; run 2 FAIL with C2 unmet at commit B where no file C2's file map names changed — the FAIL report marks C2 as previously passing with its files unchanged (inconsistent verifier). Variant: one of C2's mapped files changed between A and B — the report marks C2 previously passing with its files changed (regression). In both, the recorded status and the set of unmet ids are exactly what they would be without the flag (`lib/verdict.mjs`, `lib/impact.mjs`).
- **Fails if:** a pass-then-fail criterion is not flagged; a criterion that never passed is flagged; the changed/unchanged distinction is wrong; or flagging alters the verdict's status, unmet list or verifiability.

### C12 — After a carried PASS is withdrawn, the execute loop neither spends a remediation cycle on zero unmet criteria nor reports the round as 'ok'
- **Observe:** Drive `workflows/execute-phase.mjs` with stubbed hooks where the verifier returns a targeted PASS whose carry `ac verdict record` withdraws, leaving zero unmet criteria: no executor remediation is spawned with an empty unmet list, the loop proceeds to the verify it actually needs, and the round's FAIL/withdrawal summary states the withdrawal instead of reading `ok`.
- **Fails if:** an executor is spawned to remediate an empty unmet list; or a non-PASS round's summary reads `ok`.

### C13 — The core/edge tag the criteria author is told to write is exactly the one the code reads, and absence or a misplaced tag means core
- **Observe:** Take the tag syntax `agents/astro-criteria-author.md` instructs and write a CRITERIA.md with one criterion tagged edge, one tagged core, one untagged and one with the edge marker misplaced (e.g. in the claim text rather than where the contract puts it); the code that decides deferrability (`ac verdict defer` or its equivalent, `lib/verdict.mjs`) treats only the correctly tagged one as edge. The contract tells the author to fix the tag before any plan exists.
- **Fails if:** the syntax the contract prescribes is not recognised by the code; an untagged or misplaced-tag criterion is treated as edge; or the contract never asks the author to tag.

### C14 — The deferral rule is recorded as in-force canon and the documented commands are the real ones
- **Observe:** `.astrocode/DECISIONS.in-force.md` holds an in-force ADR stating that deferral is human-chosen at a FAIL, that core and suite criteria are never deferrable, and that open deferred fixes block milestone close (amending what verified means). Every deferral, verdict-history and setup-cache command named in `MANUAL.md` and `CHANGELOG.md` runs as documented in a scratch project (no "unknown command" from `bin/ac.mjs`, flags accepted).
- **Fails if:** no in-force ADR covers D1-D3, or it contradicts them; or a documented command or flag does not exist or behaves differently from the docs.

### C15 [suite] — The whole test suite passes, with the phase's new behavior covered by tests
- **Observe:** `node scripts/test.mjs` (`npm test`) exits 0 on a clean tree; the run includes tests that exercise deferral refusal for core/suite/untagged, milestone-close refusal, broad-claim refusal, setup-cache hit/miss, one-pass FAIL listing, the flapping flag and history append.
- **Fails if:** any test fails or the suite exits non-zero; or one of those behaviors has no test that would fail if it regressed.
