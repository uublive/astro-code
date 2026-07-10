# ACCEPTANCE — Phase 04: GitFlow PRs, release and hotfix flows

> User-facing UAT checklist. A human confirms each item before the phase closes.
> These are acceptance criteria (the user can …), not unit tests.

- [ ] The user can run `ac flow pr` on a milestone `feature/m<N>-…` branch to push it and
      get a ready-to-click compare/PR URL targeting `develop` (default `pr:none`, pure git,
      any GitHub/GitLab remote).
- [ ] The user can run `ac flow release` from `develop` to push it and get the develop→main
      compare/PR URL — and it does NOT create a tag yet.
- [ ] After the develop→main PR merges, the user can run `ac flow tag` to tag `main` as
      `v<N>` (the project-global milestone number) and push the tag; it refuses if `main`
      does not yet contain the merge.
- [ ] The user can run `ac flow hotfix start <name>` to branch `hotfix/<name>` off `main`
      (works fully offline) and is warned the name is user-supplied.
- [ ] The user can run `ac flow hotfix finish` to land the hotfix on BOTH `main` and
      `develop` and tag the patch `v<N>.<k>` (first hotfix → `v<N>.1`, next → `v<N>.2`).
- [ ] When `gitflow.pr` is `gh`/`glab` but the CLI is not installed, the command still
      succeeds and degrades to the compare URL with a `⚠` advisory (never fails for that).
- [ ] When the repo has no remote, push-requiring flow commands fail fast with a clear
      `✖ no remote …` message and leave no half-applied state.
- [ ] When gitflow is disabled, every new `ac flow` subcommand refuses with the
      `gitflow.enabled` hint, and none of them ever read, write, or push the orphan
      `astro-registry` branch.
- [ ] `ac help` lists `ac flow pr`, `ac flow release`, `ac flow tag`,
      `ac flow hotfix start`, and `ac flow hotfix finish`.
