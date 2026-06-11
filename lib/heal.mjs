// astro-code · wave-conflict heal list resolver.
//
// WHY THIS MODULE EXISTS — the phase-04 wave-2 trap:
//   During phase 04 the integrator ran cherry-pick against a stale tip.  Git
//   auto-merged stacked duplicate helper copies with *no conflict marker*, so
//   the tree looked clean and tests passed — but the code was semantically
//   broken.  That failure mode is exactly why ADR-014 mandates:
//
//     drop-and-rerun at the integrated tip — NEVER rebase.
//
//   Re-running the task sequentially on-branch at the current integrated tip is
//   always semantically fresh and cannot produce that phantom-merge class of
//   bug.  This module re-exports resolveHealList from lib/waves.mjs, where it
//   now lives alongside the other wave helper functions so the MIRROR drift
//   guard in tests/workflows.test.mjs keeps the Workflow sandbox copy in sync.
//
// ADR-014: Wave-conflict healing is drop-and-rerun at the integrated tip — never rebase.

export { resolveHealList } from './waves.mjs';
