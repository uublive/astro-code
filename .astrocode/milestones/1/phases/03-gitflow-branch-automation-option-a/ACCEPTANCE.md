# Acceptance — Phase 03: GitFlow branch automation (Option A)

User-facing UAT checklist. A human confirms each before the phase closes. These are
acceptance criteria (real `ac flow` usage), not unit tests.

- [ ] The user can run `ac flow init` in a repo with only `main` and end up with a
      `develop` branch created off `main`; running it again is a clean no-op.
- [ ] The user can enable GitFlow with `ac config set gitflow.enabled true` and a fresh
      `ac init` project already contains a disabled `gitflow` block in `config.json`.
- [ ] The user can run `ac flow` with an active milestone and be created+switched onto
      `feature/m<N>-<theme>` off `develop`, where `<theme>` is the slugified milestone
      name (`git branch --show-current` confirms the new branch).
- [ ] The user can re-run `ac flow` and be switched onto the existing milestone feature
      branch without an error (idempotent).
- [ ] The user sees a clear refusal (non-zero, with a hint) when `gitflow.enabled` is
      false, when `develop` is missing (suggests `ac flow init`), when there is no active
      milestone, or when the working tree is dirty.
- [ ] The user confirms `ac flow` / `ac flow init` never create or modify the
      `astro-registry` orphan branch, and that lifecycle commands (`ac milestone new`,
      `ac phase add`) behave exactly as before (no auto-branching).
- [ ] The user sees, after `ac flow`, a reminder that they are now on the feature branch
      and should run `/astro-execute` from there (so worktrees fork from it).
