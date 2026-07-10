# Acceptance — Phase 2: Harden the parallel-execution fallback path

UAT checklist (human-confirmable before the phase closes):

- [ ] In `commands/astro-execute.md`, the "No Workflow tool, but the Agent tool is
      available" tier now says tasks run **sequentially** (one at a time, in dependency
      order, one atomic commit each) and explicitly forbids spawning parallel executors
      that commit to the same working tree — citing ADR-008.
- [ ] The unsafe wording ("spawn the ready tasks as parallel `astro-executor` calls in a
      single message") is gone.
- [ ] The Workflow tier (worktree + integrator) and the inline "No subagents" tier are
      unchanged and still present — only the middle fallback tier changed.
- [ ] `npm test` passes, including a new guard suite that **fails** if the fallback tier
      is ever reverted to parallel-without-isolation (verify by temporarily re-adding the
      old wording and watching the test go red).
- [ ] The reader's takeaway is unambiguous: no Workflow tool ⇒ sequential execution, so
      the integration-conflict scenario cannot recur on the fallback path.
