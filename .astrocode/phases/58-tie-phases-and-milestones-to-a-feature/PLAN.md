# Phase 58 — Plan: tie phases and milestones to a feature branch; the band shows only my work here

Goal: tie phases and milestones to a feature branch (stored in the shared registry claim, automatic on
discuss/plan/execute while on a feature branch, plus `ac flow link/unlink`); the band shows only the work
tied to the current branch, and anywhere else only my open work, with other people's phases behind a dim
count. Identity is the git email plus personal aliases.
Bar: CRITERIA.md C1–C11. Canon: ADR-002 (writes go through `transact`), ADR-009 (no automatic branching),
ADR-043 (an unreachable registry is never treated as empty), ADR-071 (the band keeps no state and fails
open), ADR-094 (optional keys are absent when empty), ADR-018/020.

## Settled design (every task builds to this contract)

**Tie storage (C1, CONTEXT D2 "reuse/extend `branch`").**
- Extend the claim with a new field `feature_branch` that sits next to the existing `branch`.
- The existing `branch` keeps its meaning (where the claim was made). It is NEVER read as a tie, so historic `main`/`develop` claims count as untied and need no migration.
- Phase claim states:
  - `feature_branch: "<name>"` means tied.
  - `feature_branch: null` means explicitly untied (`ac flow unlink <phase>`). It overrides the milestone's tie.
  - The key absent means the phase inherits its milestone claim's `feature_branch`.
- Milestone claim states: `feature_branch: "<name>"` or the key absent. Unlinking deletes the key.
- Precedence: a phase's own tie (or explicit untie) beats its milestone's tie.
- A tie value equal to flow `main` or `develop`, the registry branch, or `HEAD` is ignored and counts as untied. This is defensive; link refuses to write such values in the first place.

**Identity (C4, D6).**
- "Me" is a normalized set (`trim().toLowerCase()`, exact string equality, never assuming an `@`) of:
  - the repo's git `user.email` (`git config user.email`, so repo-local wins over global);
  - `user.name` only when the email is empty, matching `gitIdentity`;
  - the personal aliases in `$HOME/.astro/config.json` → `identity.aliases` (an array of strings).
- Aliases add to the git email; they never replace it.
- A claim with no owner, or a roadmap phase with no claim, counts as mine. This fails open (CONTEXT: never hide work you cannot attribute).
- `unknown` and `astro-code@localhost` count as mine only when they literally equal my own fallback.
- Aliases are never stored under `.astrocode/` or in any tracked file.
- `~/.astro/config.json` also holds `astrokit.token`. No code path prints the file.

**`ac status --json` contract (C3). The producer is t4; the consumers are t7, t8 and t10.**
- Per-row keys, present only when the local registry ref is readable:
  - `owner`: the claim owner verbatim (the full email). Absent when the row has no claim.
  - `owner_tag`: the short `ownerTags` tag. Only on rows that are not mine.
  - `mine`: boolean.
  - `feature_branch`: the effective tie. Absent when untied.
  - `tied_by: "milestone"`: only when the tie is inherited from the milestone.
  - `onBranch`: boolean, `feature_branch === <current branch>`.
- Rows that exist only in the registry (`remote: true`) now cover open claims, mine and others', in every milestone (not just the current one, and not just others'). Each such row carries `number`, `name`, `milestone`, `status: "pending"` and the keys above.
- New top-level keys, each absent when unknown:
  - `branch`: the full current branch name, read from `<gitdir>/HEAD` as a file read. Absent on a detached HEAD.
  - `registry: true`: the local registry ref was readable.
  - `registry_ref`: the absolute path of the file holding that ref (the loose ref, else `packed-refs`), used by the band's freshness check.
- When the ref is unreadable, rows carry none of the ownership keys and there is no `registry`. That makes the band show the full view (C7).
- Still no network and no fetch.
- `next`, `siblings` and the text `ac status` are unchanged. C8 holds by construction: text status reads `roadmap.json`, never the scoped view.

**Band scope (C5, C6, C7). These are pure rules in `band.js`, using the band's full branch name (falling back to `status.branch`).**
- **full mode.** `status.registry` is not `true`. The band behaves exactly as today, with no hidden-count line.
- **branch mode.** At least one row has `mine && feature_branch === branch` (the milestone-inherited tie included).
  - Visible rows: exactly those rows, plus phases with a run in flight.
  - The current phase is NOT forced in, because it can be untied.
  - Hidden line: one dim `+N elsewhere`. N = |baseline − visible|, where baseline = today's `trackedPhases(status, runs)`.
- **mine mode.** Any other branch: develop, main, a detached HEAD, a branch with nothing of mine tied, or a branch deleted on the remote.
  - Visible rows: rows with `mine` and status not `complete` and not `rejected`, across ALL milestones, plus phases with a run in flight.
  - Hidden line: one dim `+N by others`. N = rows with `mine === false` whose status is neither `complete` nor `rejected`.
  - These rules apply whether gitflow is on or off (D7).
- Branch mode and mine mode never both draw a count. Each phase is counted at most once, and the count line appears only when N > 0.
- In branch and mine modes:
  - The meter counts only visible rows.
  - The title is `M<n>` for the milestone tied by `tied_by: "milestone"` rows if there is one. Otherwise it is the single milestone of the visible rows if they share one. Otherwise it is `status.milestone`.
  - The `OTHER` row is dropped, because it tallies teammates' work and the visible rows already span milestones.
  - Buttons: `next` and `siblings` are kept only when their phase number is visible. When none survive, one button is derived for the first open visible row, by number. It mirrors `nextAction`:
    - pending + planned → execute;
    - pending + discussed → plan;
    - pending → discuss;
    - executing → execute;
    - verified → accept.
  - Autocomplete phase rows use the same visible set.
- The band starts no new process (C9). The branch comes from the existing `<gitdir>/HEAD` read. Ownership arrives in the existing `ac status --json` turn-boundary read.

**Auto-tie (C2). This puts ADR-009 at the CLI layer: it never creates or switches a branch.**
- `ac phase context <N>` (the discuss step 5b `--author` form and the plan step 2 gate form) and `ac state set active_phase <slug>` (execute step 2, and `/astro-fast`) call `autoTie(root, N)`.
- `autoTie` is best-effort and never changes stdout or the exit code. Callers compare stdout exactly (`ready`, `human`, JSON).
- It runs only when ALL of these hold:
  - `gitflow.enabled`;
  - HEAD is a named branch starting `<prefixes.feature>/`, and it is not main, develop or the registry branch;
  - a registry exists;
  - the phase's claim is mine;
  - the claim has no own `feature_branch` key (an explicit unlink is respected);
  - the claim's milestone tie is absent or equals this branch.
- It checks the local registry ref first. When that already shows a tie, there is no network call.
- Output, all on stderr:
  - it tied: one `• phase N tied to <branch>` line;
  - it refused because the phase is tied elsewhere: one `⚠ phase N is tied to <other> — \`ac flow link N\` moves it` line;
  - unreachable: one `⚠ could not tie phase N to <branch>: <reason>` line;
  - any other case: silence.
- Auto-tying the milestone ("where natural") is **deferred**.

**Test strategy (ADR-018).**
- Every task ships its own tests in the same commit (test-with-impl). No task is a cross-wave RED task.
- A test that reaches a symbol added in the same task still uses `await import(...)` inside the async test body, as the existing band, team and registry tests already do.
- Every test that touches identity points `HOME` (and `XDG_CONFIG_HOME`) at an `mkdtempSync` dir, so the real `~/.astro` is never read or written.

## Tasks

### t1 — Registry: `tieClaim` writes, moves and clears a phase or milestone tie through `transact`
- **id:** t1
- **files:** lib/registry.mjs, tests/registry.test.mjs
- **depends_on:** []
- Add `export function tieClaim({ root, type, number, tie, auto = false, me = [], remote, branch, retries = 6 })`. Clone the `repointPhaseClaim` shape:
  - `probeBranch` returning `unreachable` gives `{ok:false,error}` (ADR-043).
  - A missing registry gives `{ok:true, source:'local', reason}`.
  - Otherwise the edit runs inside `transact` (ADR-002). It mutates the matching claims (`type`, `number`) in place, so every other field and every sibling file is preserved.
- `type` is `'phase'` or `'milestone'`. The `tie` values:
  - a string sets `feature_branch`;
  - `null` on a phase sets `feature_branch: null`;
  - `null` on a milestone deletes the key.
- Returns `{ok:true, source:'remote', found, from, to, changed}`. `changed` is 0 when the tie is already the requested one, and then nothing is written.
- `auto: true` writes only when ALL of these hold:
  - the claim's normalized owner is in `me` (or the claim has no owner);
  - the phase has no own `feature_branch` key;
  - the milestone claim's `feature_branch` is absent or equal to `tie`.
- Otherwise `auto` returns `{changed:0, skipped:'not-mine'|'tied'|'milestone-tied', from}` and writes nothing.
- Comment block: why this is a new field rather than an overwrite of `branch`. The historic claim branch is not a tie, and this needs no migration.
- Tests, extending the contract suite (real bare remote plus two clones):
  - clone A links phase N, and clone B's `readRegistry` sees `feature_branch`;
  - a re-link moves the tie, with exactly one value;
  - unlink of a phase gives `null`, and unlink of a milestone removes the key;
  - a milestone link;
  - the `auto` rules: never overwrites, skips not-mine, respects an explicit `null`, and yields to a milestone tie elsewhere;
  - a concurrent link from both clones retries cleanly;
  - the field survives `markComplete` and `repointPhaseClaim`;
  - `registry.json` siblings are preserved;
  - unreachable refuses;
  - no registry gives `source:'local'`.

### t2 — Personal identity aliases in `~/.astro/config.json` (`lib/identity.mjs`)
- **id:** t2
- **files:** lib/identity.mjs, tests/identity.test.mjs
- **depends_on:** []
- New module. Named exports, each taking `home = homedir()` so tests pass a temp dir (the `lib/config.mjs` pattern):
  - `normalizeOwner(s)`: trim plus lower-case. Returns `''` for a non-string.
  - `readUserAliases({home})`: `identity.aliases`. Validated as an array of non-empty strings, deduped and normalized. Fails soft to `[]` on a missing file, bad JSON or a bad shape.
  - `addUserAlias({home, email})` and `removeUserAlias({home, email})`:
    - Atomic tmp-and-rename write that preserves every other key (`astrokit`, `agent_tools`, `models`, `statusline`, …).
    - REFUSES a file that is not a JSON object, as `setUserRoleDefaults` does, and returns `{ok:false,error}`.
    - Rejects an empty or whitespace alias.
    - Idempotent: returns `{ok:true, changed, aliases}`.
  - `myIdentities({root, home})`: `git config user.email`, else `user.name` (mirrors `gitIdentity`), plus the aliases, as a normalized Set.
- The module header cites ADR-068/ADR-057: this is personal state outside `.astrocode/`, and this module is its only writer. It also states that the file holds `astrokit.token` and must never be echoed.
- Tests:
  - read, add and remove round trips;
  - other keys are preserved byte-for-byte as a parsed deep-equal, the token included;
  - a non-object file is refused;
  - bad shapes fail soft;
  - the set adds to the git email and never replaces it (temp repo with a repo-local `user.email`);
  - case-insensitive match.

### t3 — Hooks: the registry read keeps owner, ties and milestone claims; identity includes aliases and refreshes on change
- **id:** t3
- **files:** hooks/_astro-team.mjs, tests/team_phases.test.mjs
- **depends_on:** []
- `teamClaims` cache becomes `v: 2`. An older cache is ignored and rebuilt. It keeps, per phase claim: `number`, `milestone`, `name`, the raw `owner`, `status`, and `tie` (present only when the claim has a `feature_branch` key; `null` is kept as `null`). It also keeps a `milestoneTies` map from milestone claims that have a string `feature_branch`.
- `me` becomes an array: the normalized git email (else name) plus `identity.aliases` from `<home>/.astro/config.json`. Use the module's own `readJson`; hooks must not import `lib/`.
  - Aliases are re-read on every call (one small file).
  - The git identity cache is invalidated when the mtime or size of `<commonGitDir>/config`, `$HOME/.gitconfig` or `$XDG_CONFIG_HOME/git/config` (default `~/.config/git/config`) changes, in addition to the 10-minute TTL. This way a changed `user.email` takes effect on the next call (C4).
  - The alias key and the normalization rule duplicate `lib/identity.mjs` on purpose (hooks ship without lib). Say so in a comment.
- New exports:
  - `ownership(root, nowSeconds, {home})`: `{ me:Set, claims, milestoneTies, refPath }`, or `null` when there is no ref or no readable registry.
  - `isMine(owner, me)`: an empty owner is mine; otherwise exact normalized equality.
  - `headBranch(root)`: the full branch name from `<per-worktree gitdir>/HEAD` (not the common dir), or `null` when detached or unreadable. The name is never truncated or split on `/`.
  - The ref resolution (`refCommit`) also reports which file held the ref, for `refPath`.
- `teamPhases` (statusline track) keeps its current output, with tags for others only in the current milestone. Comparing against the new `me` set means aliases also stop my own phases from being tagged.
- Tests (temp repos, `HOME` pointed at a temp dir; new symbols via `await import`):
  - the v2 cache shape;
  - tri-state `tie`;
  - `milestoneTies`;
  - alias makes mine;
  - a `user.email` change is seen without waiting for the TTL;
  - `headBranch` handles a slash name, detached HEAD and a worktree `.git` file;
  - `null` with no ref.

### t4 — `ac status --json`: owner, effective tie, `mine`, `onBranch`, `branch`, `registry` (offline)
- **id:** t4
- **files:** lib/nextstep.mjs, tests/status_json.test.mjs
- **depends_on:** [t3]
- `statusJson` calls `ownership(root, now)` and `headBranch(root)` from `hooks/_astro-team.mjs`. The import direction lib → hooks is allowed. It builds rows per the contract above:
  - the effective tie: the phase's own `tie` when the key is present, else `milestoneTies[milestone]`;
  - `tied_by`;
  - ignores ties equal to `loadFlowConfig(root)` main or develop, `registryBranch(root)`, or `HEAD`;
  - `mine` via `isMine`;
  - `owner_tag` via `ownerTags`, for rows that are not mine only;
  - `onBranch`.
- Registry-only `remote:true` rows: open claims that are not closed and not in the roadmap, in any milestone, mine and others', with `milestone` and `name`.
- Replace the old `ctx.phases`-based owner merge. `next`, `siblings`, `deferred_fixes`, `full_check_pending` and the text `Next:` line are untouched.
- Top-level `branch`, `registry: true` and `registry_ref` are ABSENT when unknown (ADR-094).
- The module header comment changes from "No registry read" to "local registry REF only, never a fetch".
- Tests (two clones on a bare remote, `HOME` pointed at a temp dir):
  - the rows of A and B carry the full `owner` email;
  - `mine` is true for A's rows and false for B's;
  - `onBranch` follows the current branch;
  - a milestone tie is inherited, and a phase `null` overrides it;
  - historic `branch: develop` is untied;
  - with no ref, there are no ownership keys and no `registry` key;
  - the call stays offline: with the remote URL pointed at a nonexistent path it still succeeds, and the local ref is not moved.

### t5 — `lib/flowlink.mjs`: `flowLink`, `flowUnlink`, `autoTie`
- **id:** t5
- **files:** lib/flowlink.mjs, tests/flowlink.test.mjs
- **depends_on:** [t1, t2]
- New module, so it does not collide with phase 57's `lib/flow.mjs`. It imports `loadFlowConfig` (read-only use) from `./flow.mjs`, `tieClaim`/`registryBranch`/`readRegistry` from `./registry.mjs`, and `myIdentities` from `./identity.mjs`.
- `parseTieTarget(root, s)`: `m<N>` gives a milestone. `<N>` or a slug gives a phase, resolved through the roadmap. A bare number that is not in the roadmap still targets the registry claim.
- `flowLink(root, target)`:
  - throws (for `die`) unless gitflow is enabled, using the same message as `assertFlowEnabled`;
  - throws on a detached HEAD;
  - throws when the branch is main, develop or the registry branch;
  - throws when there is no shared registry (`ac registry init`) or the claim is not found;
  - calls `tieClaim`;
  - returns `{message}`, a single line: `✓ phase N tied to <b>`, `✓ phase N moved from <a> to <b>`, `✓ milestone N tied to <b>`, or `✓ phase N already tied to <b>`.
  - It never creates or switches a branch (ADR-009).
- `flowUnlink(root, target)`: the same guards, except that any current branch is allowed. Messages: `✓ phase N untied` / `✓ milestone N untied`.
- `autoTie(root, number)`: the guards from "Auto-tie" above. The local-ref fast path uses `ownership`/`headBranch` from `hooks/_astro-team.mjs`. Then `tieClaim({auto:true, me:[...myIdentities]})`. It never throws, and returns `{line|null}` with one of the stderr lines specified above.
- Tests (bare remote, two clones, flow enabled, `HOME` pointed at a temp dir):
  - link, re-link to move, milestone link, unlink, each read back from clone B;
  - refusals: flow off, main, develop, detached HEAD, no registry, unreachable;
  - `autoTie`:
    - ties on `feature/x`;
    - is a no-op on develop and on a non-`feature/` branch;
    - never overwrites a tie elsewhere (and returns the `⚠` line);
    - skips a teammate's claim;
    - skips when gitflow is off;
    - never runs `git switch`/`branch` (HEAD and the branch list are unchanged).

### t6 — CLI: `ac flow link|unlink`, `ac identity`, and the auto-tie on `ac phase context` / `ac state set active_phase`
- **id:** t6
- **files:** bin/ac.mjs, tests/flow_link_cli.test.mjs
- **depends_on:** [t2, t5]
- `case 'flow'`:
  - Add `link <phase|m<N>>` and `unlink <phase|m<N>>`, calling `flowLink`/`flowUnlink`. Print `res.message`; an `Error` goes to `die`.
  - Extend the unknown-subcommand usage string.
  - Add help lines next to `ac flow hotfix finish` (~L689) with both argument forms.
- New `case 'identity'`:
  - `ac identity` prints `me: <git email>` plus `aliases: …`, or `aliases: none`. It never prints anything else from the file.
  - `ac identity alias add <email>` and `ac identity alias remove <email>` call t2 and print one `✓` line.
  - Errors go to `die`.
  - Add help lines.
- `ac phase context <N>` (both forms) and `ac state set active_phase <slug|N>`: after the existing stdout output, call `autoTie` and write its line (if any) to **stderr**. Stdout and the exit code stay byte-identical. This is the C2 hook point.
- Tests (spawn `node bin/ac.mjs` against two clones on a bare remote; `HOME` and `XDG_CONFIG_HOME` pointed at temp dirs):
  - `flow link`/`unlink` exit 0 with one line, and clone B's `ac status --json` shows the tie;
  - flow help lists `link`/`unlink`;
  - `identity alias add` makes a third-email claim read `mine` in `status --json`, `remove` reverts it, and `git status --porcelain` is clean;
  - on `feature/alpha`, `ac phase context N --author`, `ac phase context N` and `ac state set active_phase <slug>` each tie an untied phase (one phase per verb). Their stdout equals the pre-change output (`human`/`ready`/JSON);
  - on `develop` they tie nothing and leave an existing tie intact.

### t7 — Band core: branch, mine and full scopes; hidden-count line; scoped meter, title, buttons
- **id:** t7
- **files:** mods/astro-mods/hooks/lib/band.js, tests/mods_phase_band.test.mjs, tests/mods_phase_band_scope.test.mjs
- **depends_on:** []
- Add `export function scopeOf(status, {branch, runs})`, which returns `{mode:'full'|'branch'|'mine', visible, hidden:{label, count}|null, title}` per the "Band scope" rules. It is pure; a missing or odd field fails open to `full`.
- `bandView(status, live, {…, branch})`:
  - the ROADMAP row renders `visible`. The `✓ N done` collapse is kept;
  - one dim row (tone `note`) with `+N elsewhere` or `+N by others` sits directly under ROADMAP when `hidden.count > 0`;
  - `meterOf` counts `visible`;
  - `view()` title takes `scope.title`;
  - `OTHER` is drawn in full mode only;
  - buttons are filtered to visible phase numbers, with the single derived fallback button;
  - the `hint` follows the same filter.
- `chipOf` shows `(owner_tag)`. It no longer shows the raw `owner`, which is now an email.
- `stalePaths` adds `status.registry_ref` when it is present, so a fetch or link refreshes the band at the next turn boundary.
- Full mode output must stay identical to today for every existing test input. The one existing test that fed `owner: 'a'` switches to `owner_tag: 'a'`.
- New tests (`mods_phase_band_scope.test.mjs`, which imports `band.js` dynamically like the existing band tests):
  - branch mode:
    - only tied, mine rows, including a milestone-inherited one from another milestone;
    - a teammate's tied row is hidden;
    - meter, title and buttons cover visible rows only;
    - `+N elsewhere` equals baseline minus visible;
  - mine mode on develop, main and an untied `feature/empty`:
    - my open rows across milestones; a complete phase of mine is excluded;
    - `+N by others` is correct, and a B row with historic `branch: develop` stays hidden;
    - the same result with gitflow off;
  - full mode when `registry` is absent: today's rows and no count line;
  - a deleted or unknown branch gives mine mode without error;
  - a detached HEAD;
  - counts are disjoint and the line appears once.

### t8 — phase-band feature: feed the full branch name; scope the autocomplete rows
- **id:** t8
- **files:** mods/astro-mods/hooks/features/phase-band.js, tests/mods_phase_band_complete.test.mjs
- **depends_on:** [t7]
- In the existing `<gitdir>/HEAD` read (L145-155), keep a second, untruncated value `st.branchName = branchFrom(text, Infinity)` beside the banner's truncated `st.branch`. A detached HEAD stays `null`.
- Pass `{branch: st.branchName}` to `bandView`. Because scope is computed in `bandView`, a branch change re-scopes on the redraw that already happens. No `ac status` refetch is added.
- `phaseBandComplete` with `source === 'phases'` offers only `scopeOf(st.status, {branch: st.branchName, runs}).visible`.
- C9: no new `$.run`/`ask`/process. Add a comment at the HEAD read saying so.
- Tests:
  - the autocomplete phase rows exclude a teammate's and an untied phase in branch mode, and are unchanged in full mode;
  - the existing complete tests stay green.

### t9 — Docs, command notes and the ADR
- **id:** t9
- **files:** MANUAL.md, commands/astro-help.md, ARCHITECTURE.md, commands/astro-discuss.md, commands/astro-plan.md, commands/astro-execute.md, .astrocode/DECISIONS.md, .astrocode/DECISIONS.in-force.md, .astrocode/CONVENTIONS.md
- **depends_on:** [t6, t8]
- MANUAL.md:
  - `ac flow link|unlink` (argument forms `<phase>` and `m<N>`, the guards, and that the tie is shared through the registry);
  - the automatic tie (which steps, the conditions, never overwrites, explicit unlink respected);
  - what the band shows on a feature branch versus on develop/main or an untied branch, including the dim `+N elsewhere` / `+N by others` lines and the full-view fallback when the registry ref is unreadable;
  - personal aliases: `ac identity alias add <email>`, stored in `~/.astro/config.json` and never in the project;
  - the phase-band section and the `ac flow` block (~L1398).
- `commands/astro-help.md`: list the new verbs. ARCHITECTURE.md: the phase-band filter and the `feature_branch` claim field.
- discuss step 5b, plan step 2 and execute step 2: one sentence each, saying the step also ties the phase to the current feature branch when gitflow is on. The reporting rule: "relay a `⚠` tie line in one line; say nothing otherwise". This keeps `tests/commands.test.mjs` bound checks green.
- Record the decision with `ac decision add "<choice>" --why "<why>"` (registry-claimed number; never hand-pick one). The decision covers:
  - the `feature_branch` field and its tri-state and precedence;
  - `branch` is never a tie;
  - the auto-tie hook points and rules;
  - the identity set;
  - owner-less = mine;
  - the three band modes;
  - an unreadable ref gives the full view.
- `ac decision add` also publishes CONVENTIONS.md. Hence that file is declared here.
- Run `node --test tests/commands.test.mjs` before committing.

### t10 — End-to-end fixture test across C1–C8, then the full suite
- **id:** t10
- **files:** tests/branch_scope_e2e.test.mjs
- **depends_on:** [t4, t6, t8, t9]
- One test file builds the CRITERIA shared fixture:
  - a temp bare remote; clones A (`me@example.test`) and B (`alex@example.test`);
  - registry initialised; `gitflow.enabled` on;
  - `HOME` pointed at a scratch dir for every `ac` call;
  - a first milestone holding ≥ 5 phases: two from A, one of them complete; two from B, one claimed while on `develop`;
  - one phase from A in a second milestone.
- Assertions, feeding `bandView` from `band.js` with each clone's `ac status --json` plus its branch, as phase-band.js does:
  - **C1:** link, move and unlink from A, seen in B; `m<N>` link.
  - **C2:** the auto-tie via the discuss, plan and execute verbs on `feature/alpha`; none on develop.
  - **C3:** the row fields.
  - **C4:** a third clone `me-old@example.test`; `ac identity alias add` (the MANUAL's literal command) makes the row mine, and the band shows it; remove reverts; switching `user.email` to alex flips mine.
  - **C5:** the branch-mode band.
  - **C6:** the mine-mode band on develop, main and `feature/empty`, with flow on and off.
  - **C7:** the full view when the registry ref is missing (remote removed); a deleted-on-remote branch renders without error.
  - **C8:** text `ac status` lists every phase, B's included.
- Finish by running `npm test` on the integrated tip (C11). Fix only failures this phase caused, inside this task's file. Any other failure is reported, not patched outside scope.

## Wave shape

- W1: t1, t2, t3, t7. Four parallel tasks, with disjoint files.
- W2: t4 (after t3), t5 (after t1 and t2), t8 (after t7).
- W3: t6 (after t2 and t5).
- W4: t9.
- W5: t10.

Same-file check: `bin/ac.mjs` is only in t6. `band.js` is only in t7. The band test files are split between t7 (`mods_phase_band*.test.mjs` minus `_complete`) and t8 (`_complete`). No two tasks share a file. No task deletes or renames a symbol (all changes are additive), so every wave boundary compiles (ADR-020).

## Deferred (not tasks)
- Auto-tying the milestone along with the phase ("where natural", D1). Today only `ac flow link m<N>` ties a milestone.
- Owner/branch columns in the text `ac status` (allowed by C8, not required).
- Refreshing the band when only `~/.astro/config.json` aliases change with no other state change. It picks the change up at the next refetch.
- Clearing ties to deleted branches automatically. A tie stays as history, and the band falls to mine mode on a branch nothing is tied to.
