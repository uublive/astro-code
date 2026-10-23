# Contributing to astro-code

## Branching: git-flow

astro-code uses **git-flow**. `main` always holds exactly what was last released; all work
lands on `develop` first.

| Branch | Branches off | PR into | For |
|---|---|---|---|
| `feature/<name>` | `develop` | `develop` | new behaviour, docs, refactors |
| `fix/<name>` | `develop` | `develop` | a bug in unreleased or released code that can wait for the next release |
| `release/x.y.z` | `develop` | `main` | version bump (`package.json` and `mods/astro-mods/.claude-plugin/plugin.json`, kept equal by a test) + changelog; maintainers only |
| `hotfix/<name>` | `main` | `main` **and** `develop` | an urgent fix to the released version; maintainers only |

**Open your PR against `develop`.** GitHub pre-selects `main` because it is the default
branch (so fresh clones get released code) — change the base before you create the PR. A
check fails any PR into `main` whose head is not `develop`, `release/*` or `hotfix/*`, and
`main` is protected: nothing is pushed to it directly.

If you work from a fork, fetch `upstream/develop` and branch from it, not from `main`.

The `ac flow` commands drive this for milestone work (`ac flow`, `ac flow pr`,
`ac flow release`, `ac flow tag`, `ac flow hotfix start|finish`) — `ac help` lists them.

## Before you open a PR

- `npm test` passes (it is `node --test` in a temp folder it removes afterwards; no install step, no services needed).
- A bug fix comes with a test that fails without the fix.
- Commits follow Conventional Commits: `fix(statusline): …`, `feat(config): …`,
  `docs: …`, `chore(release): …`. One logical change per commit.
- Read `.astrocode/CONVENTIONS.md` and `.astrocode/DECISIONS.md` before proposing an
  approach — conventions are binding, recorded decisions are not re-litigated in a PR.
- Never hand-edit `.astrocode/roadmap.json`, `.astrocode/state.json` or the registry
  branch, and don't edit `ROADMAP.md` (it is generated). See `AGENTS.md`.

## Writing the PR

Lead with the change, not the process: what was wrong, what is different now, how you
showed it. A before/after render or a failing-then-passing test is worth more than a
paragraph. Reference the issue it fixes (`Fixes #NN`).
