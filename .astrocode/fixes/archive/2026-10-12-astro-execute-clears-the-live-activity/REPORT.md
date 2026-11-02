# /astro-execute clears the live activity on an early stop even when a workflow is already running

**Cause:** `commands/astro-execute.md` step 5 said to clear the activity "on any early stop", so a run
that stopped because a workflow for the phase was already in flight wiped the status that workflow
still owned. Nothing told a resumed workflow (`resumeFromRunId`) to set the activity again.

**Fix:** step 2 sets the activity on every launch or resume of the workflow; step 5 clears it on an
early stop or `integrationFailed`, except a stop because a workflow for this phase is already running.

**Check:** prose-only change in the command; `tests/commands.test.mjs` and `tests/workflows.test.mjs` pass.
