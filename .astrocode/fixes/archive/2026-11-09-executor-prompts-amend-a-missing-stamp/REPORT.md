## Summary

`workflows/execute-phase.mjs` tells an executor to repair a missing `(phase NN tK)` stamp with `git commit --amend`. In a repository where a post-commit hook pushes every commit, the commit is already on the remote when the executor amends it, so the amend rewrites a pushed commit and the branch diverges from its remote. Nothing in the prompt says to check first.

## Where (v0.54.3, same text since v0.52.0)

- `workflows/execute-phase.mjs:712`, `stampSelfCheck`: "fix it with `git commit --amend -m "<subject> (phase N tK)"`"
- `workflows/execute-phase.mjs:1307`: "AMEND that commit to add the stamp (`git commit --amend`)"
- `workflows/execute-phase.mjs:2053`: "if the change IS present but unstamped, amend the stamp"
- `agents/astro-executor.md:20`: "if not, amend your …"

## Reproduction (clean fixture, git only)

    git init --bare origin.git; git init -b main work; cd work; git remote add origin ../origin.git
    printf '#!/bin/sh\ngit push -q origin HEAD:main\n' > .git/hooks/post-commit; chmod +x .git/hooks/post-commit
    echo a > a; git add a; git commit -m "add a"
    echo b > b; git add b; git commit -m "task one"        # the hook pushes it
    git rev-list --left-right --count origin/main...HEAD   # 0 0
    git commit --amend -m "task one (phase 1 t1)"          # the executor's repair; the hook's push is rejected (non-fast-forward)
    git rev-list --left-right --count origin/main...HEAD   # 1 1: diverged

In our projects the executors run in the working repository with such a hook, and `main` was left ahead 20 / behind 1 (one project) and ahead 6 / behind 1 (another) on 2026-10-25.

## Proposal

Never amend a commit that may already be pushed. Either tell the executor to add a new commit for the stamp (or to leave the commit and report it unstamped, since the integrator's heal step already repairs that case), or allow the amend only when `git branch -r --contains HEAD` is empty.

Related: #24 (closed), which introduced the executor's own stamp self-check.

---
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
🤖 Generated with [Claude Code](https://claude.com/claude-code)


(GitHub #180 by @luigi-lauro, verbatim above.)

## Diagnosis

- **Symptom:** where a post-commit hook pushes every commit, an executor's stamp repair (`git commit --amend`)
  rewrites a pushed commit and the branch diverges from its remote (seen 20/1 and 6/1 ahead/behind).
- **Cause:** four instructions said to amend unconditionally: the workflow's `stampSelfCheck` (exec, heal,
  batch and remediate prompts), the batch stamp check, the completeness-audit note, and step 6 of
  `agents/astro-executor.md`.
- **Chosen fix (the issue's second proposal):** amend only when `git branch -r --contains HEAD` prints nothing;
  a pushed commit is left as it is and reported unstamped with its hash. The heal step and the completeness
  audit already repair an unstamped commit, so nothing new is needed downstream. An empty stamp-only commit
  was rejected: in parallel runs the integrator cherry-picks by stamp and would pick the empty commit, not the
  work.

## Fix

One shared `NO_AMEND_PUSHED` rule in `workflows/execute-phase.mjs`, interpolated at all three workflow sites,
and the same rule in `agents/astro-executor.md` step 6.

## Verification

- `tests/fix_no_amend_pushed_stamp.test.mjs`: fails before, passes after; with the workflow and agent tests: 206 pass.
- Full suite: 2,854 pass, 0 fail.
