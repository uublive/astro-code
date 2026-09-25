# Phase 22 — success criteria (pre-registered, plan-blind)

Derived from the phase goal, CONTEXT.md (D1–D8) and canon (ADR-004, ADR-029, ADR-043,
ADR-053, ADR-057, ADR-058). Not derived from any plan.

**Shared setup for every Observe step.** Run the real CLI: `AC="node /Users/buu/Development/astro-code/bin/ac.mjs"`.
Each "machine" is a fresh home: `export HOME=$(mktemp -d)` plus `GIT_AUTHOR_NAME/EMAIL` and
`GIT_COMMITTER_NAME/EMAIL` set so git works without a global config. The default store is
therefore `$HOME/.astro/principles/`. If the implementation also documents a store-dir
override (e.g. `ASTRO_PRINCIPLES_DIR`), it must honour it equally; the verifier may use either.
Commands run from inside a scratch project (`git init` + `$AC init`) unless stated. "Entry id"
means the id the CLI printed or listed.

### C1 — A manually added principle is stored accepted, in the user's home, never in the project
- **Observe:** In a scratch project with no principles remote configured, run
  `$AC principles add "Never mock the database in integration tests" --kind antipattern --strength rule --why "Mocks hid a broken migration" --stack Postgres --work test`.
  It exits 0 and prints an id of the form `YYYY-MM-DD-<slug>` whose date is today and whose
  slug is derived from the statement. Exactly one new Markdown file appears under
  `$HOME/.astro/principles/`, and it contains the statement and the why as readable prose.
  `git -C <project> status --porcelain` shows nothing new under `.astrocode/` or anywhere else
  in the project compared with before the add. `$AC principles list --accepted` shows the entry.
- **Fails if:** the entry lands inside the project (or its `.astrocode/`), is stored as
  `proposed`, gets a sequential/numeric or random id, the command errors or tries to reach a
  network/git remote when none is configured, or the file is not human-readable Markdown
  (e.g. a JSON blob).

### C2 — Every data-model field round-trips, enums are enforced, and unknown flags are refused
- **Observe:** `$AC principles show <id>` for the C1 entry reports kind `antipattern`,
  strength `rule`, stack scope `postgres` (lowercased), work scope `test`, status `accepted`,
  the statement and the why. Add another with `--files "migrations/**" --files "**/*.test.*"`
  (or the documented multi-value form) and `--kind preference --strength default`: `show`
  returns both globs intact and the kind/strength given. Then each of these exits non-zero and
  leaves the store's file set and contents byte-identical (hash every file before/after):
  `--kind habit`, `--strength maybe`, `--work cooking`, and a typo'd flag such as `--knd principle`
  on `add`; a typo'd flag on `reject`/`promote` likewise exits non-zero with no change.
- **Fails if:** a field is dropped or altered on read-back, stack tags are not normalised to
  lowercase, a glob is mangled, an out-of-set kind/strength/work value is stored, or an
  unknown flag is silently ignored and the command runs with default behaviour.

### C3 — Proposals queue separately and `list` filters by status
- **Observe:** `$AC principles add "Prefer small PRs" --kind preference --propose` exits 0.
  `list --proposed` shows it and not the C1 entry; `list --accepted` shows C1 and not it;
  `list --all` shows both. After rejecting/retiring entries (C4), `list --rejected` shows only
  rejected ones and `list --all` still shows every entry ever created. Each list line is a
  compact single line carrying at least the id and the one-line statement.
- **Fails if:** `--propose` stores the entry as accepted, a filter leaks entries of another
  status, `--all` omits rejected/retired/superseded entries, or list output spans multiple
  lines per entry.

### C4 — The lifecycle is enforced: reasons are required, illegal transitions are refused, nothing is deleted
- **Observe:** On proposed entries: `accept <id>` → status accepted; `reject <id>` with no
  reason exits non-zero and the entry is unchanged; `reject <id> --reason "too broad"` → status
  rejected, and `show` displays the reason; the rejected file still exists. On accepted
  entries: `retire <id>` without a reason exits non-zero; `retire <id> --reason "obsolete"` →
  retired with the reason shown; `supersede <old> --by <new>` → old is superseded and `show`
  names the successor; `supersede <old> --by <nonexistent>` exits non-zero with no change.
  Illegal moves each exit non-zero and leave the entry byte-identical: retiring or superseding
  a still-proposed entry, rejecting an already-accepted entry, accepting a rejected entry.
- **Fails if:** a reject/retire succeeds without a reason, a rejected/retired/superseded entry
  is deleted or hidden from `list --all`, a supersede points at an id that does not exist, or
  any transition outside proposed→accepted|rejected and accepted→retired|superseded is allowed.

### C5 — Proposals can be reworded on accept, and accepted entries are amended in place with history
- **Observe:** Propose "Use pnpm", then accept it with `--edit` using the non-interactive form
  the phase provides (flags, or `EDITOR` set to a script such as `sed -i 's/Use pnpm/Always use pnpm/'`).
  `show` reports status accepted with the reworded statement. Then
  `amend <id> --reason "clarified scope"` with a changed statement/why (via the documented
  form): exit 0, the id is unchanged, `show` displays the new text AND a history record carrying
  the reason and the prior text (or a pointer to it). `amend <id>` with no reason exits non-zero
  with no change.
- **Fails if:** `--edit` accepts the original unedited text, amend mints a new id or a new file,
  amend discards the prior text/reason, or amend succeeds without a reason.

### C6 — Ids are stable dated slugs, resolved by unique prefix, never reissued or overwritten
- **Observe:** Add two entries with the identical statement on the same day: both succeed with
  two distinct ids and two distinct files; neither's content was overwritten. `show` with a
  unique prefix of one id resolves it; a prefix shared by both exits non-zero (ideally naming
  the candidates) and changes nothing; an id matching nothing exits non-zero. After amend,
  supersede and promote, the entry's id is unchanged.
- **Fails if:** the second add overwrites or merges into the first, an ambiguous prefix picks
  one silently, an unknown id is treated as an empty/new entry, or any operation renames an id.

### C7 — One entry per file: changing an entry touches only that entry's file
- **Observe:** With at least four entries in the store, hash every file; run `amend` (or
  `accept`/`retire`) on one entry; re-hash. Exactly one entry file differs, it is that entry's
  file, and it contains the change. No entry file is added or removed.
- **Fails if:** an operation rewrites other entries' files, an index/aggregate file becomes the
  source of truth such that a single change rewrites shared content, or entries are stored
  several per file.

### C8 — A damaged entry is refused loudly, never read as absent and never clobbered
- **Observe:** Corrupt the header of one entry file (e.g. delete its status line or replace the
  kind with garbage). `show <that id>` exits non-zero naming the file/problem; `list --all`
  either exits non-zero naming the damaged file or prints an explicit warning naming it — it
  never silently omits it. Running `add`, `accept`, `amend` on other entries leaves the damaged
  file byte-identical, and `amend`/`accept` on the damaged id exits non-zero without rewriting it.
- **Fails if:** the damaged entry silently disappears from listings, is treated as not
  existing (so its id could be reused or it is overwritten), or any command "repairs" it by
  rewriting it with defaults.

### C9 — Source excerpts are redacted of secrets before they are stored
- **Observe:** Record an entry carrying a source excerpt through whatever interface the phase
  exposes for source/evidence (a CLI flag on `add`, or the store helper that later capture
  phases call, driven via `node -e`), with an excerpt containing a fake GitHub token
  (`ghp_` + 36 alphanumerics), a fake AWS key (`AKIA` + 16 uppercase alphanumerics), a
  `Bearer <long token>` header and a credentialed URL `https://alice:s3cr3tpass@git.example.com/r.git`.
  `grep -r` across the store for each secret value returns nothing; `show` shows the excerpt
  with those values masked while the surrounding non-secret words survive. Source pointers
  (session id / project / timestamp or ADR/phase ref) round-trip via `show`.
- **Fails if:** any of the secret values is written to disk or printed, the whole excerpt is
  discarded instead of redacted, or there is no way at all for this phase's store to hold a
  source pointer + excerpt.

### C10 — Two machines sharing the user's private git remote converge
- **Observe:** Create a local bare repo `remote.git`. Machine A (own `$HOME`): add entry a1,
  then `$AC principles remote <path-to-remote.git>`. Machine B (fresh `$HOME`): `$AC principles
  remote <same path>`, then `list --all` shows a1. B adds b1; the next principles command on A
  (e.g. `list --all`) shows b1. A amends a1 while B accepts a different proposal: after one more
  command on each side, both machines' `show` for both entries agree, with no conflict
  reported. Hashes of both stores' entry files match.
- **Fails if:** an entry written on one machine never reaches the other, sync requires a manual
  git command by the user, a push is forced (remote history rewritten), or changes to two
  different entries produce a conflict.

### C11 — Offline-first: every command succeeds locally when the remote is unreachable, and unreachable is never "empty"
- **Observe:** With machine A configured as in C10, make the remote unreachable (move
  `remote.git` aside). `add`, `accept`, `amend`, `list` on A all exit 0 and the local store
  reflects them; at most an advisory line mentions the remote. Nothing is deleted from A's
  store. Move `remote.git` back: the next principles command on A exits 0 and afterwards B sees
  A's offline changes, and every entry that was on the remote before the outage is still there
  (`git -C remote.git log` shows only fast-forward history, entries intact).
- **Fails if:** a command fails or refuses to write because the remote is unreachable, the
  offline writes are lost or never pushed once the remote returns, or an unreachable remote is
  treated as having no entries (local entries deleted, or the remote rewritten/emptied).

### C12 — The same entry changed divergently on two machines is reported, never silently overwritten
- **Observe:** From the converged C10 state, edit on both sides without syncing in between:
  A amends entry x's statement to "X-from-A", B amends the same x to "X-from-B". Sync A, then
  sync B. B (and/or A) reports a conflict naming entry x, visibly (warning or non-zero exit),
  and neither "X-from-A" nor "X-from-B" is lost — both are recoverable from the store or the
  remote. Separately: if only A amends x and B still holds the older revision unchanged, B takes
  A's revision silently with no conflict reported.
- **Fails if:** one side's amendment silently wins and the other disappears, conflict markers
  are left inside an entry file that then reads as valid, or a plain older-vs-newer revision is
  reported as a conflict.

### C13 — Promoting as a decision records a shared ADR in the project, and the entry stays personal
- **Observe:** In a scratch project initialised with a registry on a local bare remote
  (`$AC init`, `$AC registry init` against it), run `$AC principles promote <accepted-id>`
  (default) or `--as decision`. A new ADR appears in the project's DECISIONS.md carrying the
  principle's statement (and why), and the same ADR is present on the registry branch of the
  bare remote (`git -C remote.git show <registry-branch>:DECISIONS.md` or equivalent). The
  personal entry's `show` still reports status accepted and lists a promotion naming this
  project and that ADR id. The personal store file stays outside the project.
- **Fails if:** the ADR is only written locally (never shared), existing ADRs in DECISIONS.md are
  lost or renumbered, the personal entry is moved/retired/deleted, or the promotion is not
  recorded on the entry.

### C14 — Promoting as a convention appends locally, publishes nothing, and tells the user how to publish
- **Observe:** In the same project, record the registry branch tip, then run
  `$AC principles promote <id2> --as convention`. The project's CONVENTIONS.md now contains the
  statement, with every pre-existing line still present. The registry branch tip on the bare
  remote is unchanged. The command output names the `ac canon push` command to publish it.
  `show <id2>` lists a convention promotion for this project; promoting the same entry again
  into another project (or as a decision) adds a second promotion record rather than replacing
  the first.
- **Fails if:** the convention is published implicitly, CONVENTIONS.md content is overwritten or
  reordered, no publish instruction is printed, or promotions overwrite one another.

### C15 — Human data is authoritative: proposing never touches an accepted, rejected or edited entry
- **Observe:** Using every path this phase exposes for proposing/refreshing an entry (`add
  --propose`, and any store helper for re-proposing that later capture phases will call, driven
  via `node -e`), attempt to (re)propose content targeting an entry that is (a) accepted,
  (b) rejected, (c) amended. Each such entry's file is byte-identical afterwards and its status
  is unchanged; a still-proposed entry targeted the same way may be refreshed. Accepting is the
  only way a proposal reaches `accepted` — no propose path yields an accepted entry.
- **Fails if:** a re-proposal overwrites, re-opens (back to proposed) or deletes an accepted,
  rejected or amended entry, or a rejection's reason is lost.

### C16 — The full test suite passes and never touches the real principles store
- **Observe:** `cd /Users/buu/Development/astro-code && HOME=$(mktemp -d) node --test tests/`
  (or `npm test` with the same `HOME`) exits 0 with zero failures. Afterwards the temp `HOME`
  has no `.astro/principles` directory created by the tests (tests used an isolated store).
- **Fails if:** any test fails (including pre-existing suites — no regression in canon,
  decision or registry behaviour), or running the suite writes principle entries into the
  invoking user's home store.
