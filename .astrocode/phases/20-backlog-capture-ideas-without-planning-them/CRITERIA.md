# Success criteria — phase 20: Backlog, capture ideas without planning them

Pre-registered before any plan exists. Derived from the phase goal, `CONTEXT.md` (D1–D5,
scope) and the canon (ADR-056, CONVENTIONS.md). Every criterion is an outcome: a different
but valid implementation of the same goal must still satisfy all of them. No criterion may
be discharged by pointing at a file, a symbol or a string in the source.

**Scratch-project recipe** (referenced below as *scratch project*; the verifier runs it
directly, no network):

```sh
AC=/Users/buu/Development/astro-code/bin/ac.mjs
P=$(mktemp -d)/proj; B=$(mktemp -d)/origin.git
git init --bare -b main "$B" >/dev/null
mkdir -p "$P" && cd "$P" && git init -b main >/dev/null
git config user.email v@x && git config user.name v
node "$AC" init --name demo >/dev/null
git add -A && git commit -qm init && git remote add origin "$B"
node "$AC" registry init            # only needed for criteria that claim a phase number
```

Any equivalent driving of the shipped surface counts — the verifier may discover the exact
verbs and flags from `node "$AC" backlog` / `--help` usage output, or call the engine
directly from a small `node -e` script. If neither the CLI nor an importable engine entry
point makes a criterion drivable without editing `.astrocode/*.json` by hand, that
criterion FAILS.

---

### C1 — An idea can be captured and read back later without spending a phase number or touching the roadmap
- **Observe:** In a *scratch project* (no `registry init` needed), capture two ideas with
  distinct text, then list. Both come back with their text intact and a stable identifier
  each, and `.astrocode/roadmap.json` + `ROADMAP.md` are byte-identical to what they were
  before the captures (`cmp` against copies taken first). Re-running the listing in a fresh
  shell returns the same two items, so the capture survives the process.
- **Fails if:** capture requires a phase/milestone number, errors without a remote or
  registry, mutates the roadmap or registry, loses the captured text (title-only), or the
  items vanish/duplicate on the second listing.

### C2 — A linked item leaves the backlog by itself when the phase that absorbed it is accepted, and comes back if that phase is rejected
- **Observe:** In a *scratch project* with a registry, capture an item, claim a phase, link
  the item to that phase, then accept the phase (`node "$AC" phase accept <n> --by v
  --force`). Listing open items no longer shows it; interrogating the item (list of all
  items / show / `--json`) reports it closed with status `absorbed` and records which phase
  closed it. Repeat on a second item linked to a second phase, and reject that phase
  instead: the item is open again and eligible for promotion.
- **Fails if:** an accepted phase leaves the linked item open or in a `linked`/`paying`
  limbo; the item closes as something other than `absorbed`; closing loses the reference to
  the phase; a rejected phase strands the item as linked forever; or accepting a phase
  closes items that were never linked to it.

### C3 — Promoting an item starts a real phase carrying the captured thinking, and that phase still owes a discussion
- **Observe:** In a *scratch project* with a registry, capture an item whose text includes a
  recognisable sentinel sentence, then promote it. The roadmap gains a phase with a newly
  claimed number (`node "$AC" registry show` lists that claim), the new phase directory's
  `CONTEXT.md` contains the sentinel sentence, and `node "$AC" phase context <n>` prints
  `stub` — not `ready`. The promoted item no longer appears among open items.
- **Fails if:** `phase context` prints `ready` (the seed satisfied the discuss gate — the
  exact failure D2 exists to prevent), the sentinel text is absent from `CONTEXT.md` (title
  only), no number is claimed in the registry, the item stays open after promotion, or any
  promotion path produces a fix instead of a phase (D3).

### C4 — An archived idea answers "why not" months later, and the system refuses to archive without that answer
- **Observe:** In a *scratch project*, archive an item with a kind and a reason string; a
  later query for archived/all items returns that item with both its kind and the verbatim
  reason. Then attempt three archives: with no reason, with no kind, and with a kind that is
  neither `declined` nor `obsolete`. Each exits non-zero and leaves the target item open and
  unchanged (re-list to confirm).
- **Fails if:** an archive succeeds with an empty/missing reason or an unrecognised kind, the
  reason or kind is not retrievable afterwards, a rejected archive nonetheless mutates the
  item, or `absorbed` is accepted as a human-typed kind.

### C5 — "Let's plan X" meets the earlier decision against X, and never gets blocked by it
- **Observe:** In a *scratch project* with a registry, archive one item as `declined` with a
  reason and another as `obsolete` with a reason, both with recognisable names. Run
  `node "$AC" phase add "<name resembling the declined item>"`: the output mentions that
  item and its reason, the command exits 0, and the phase is created with a claimed number
  (check the roadmap and `registry show`). Run `phase add` with a name resembling the
  *obsolete* item: no such warning is raised and the phase is created. Capture a new idea
  whose text closely resembles an *open* item: the capture warns about the similar open item
  and still exits 0 with the new item recorded (unless the implementation deliberately
  merges it as a repeat sighting — in which case the sighting is observable on the original).
- **Fails if:** the declined match is silent, or the warning carries no reason; `phase add`
  exits non-zero / refuses / demands `--force` on a match; an `obsolete` item raises the
  warning; or the capture-time duplicate check either never fires or blocks capture.

### C6 — `ac status` tells the truth about how many ideas are waiting
- **Observe:** In a *scratch project*, run `node "$AC" status` with an empty backlog, then
  after capturing 3 items, then after archiving 1 and promoting/absorbing another. The open
  count in the status output tracks 3 → 1 (or the correspondingly correct numbers for the
  sequence actually run), sitting alongside the existing `Debt:` line.
- **Fails if:** the count is hardcoded, counts archived/absorbed/promoted items as open, does
  not change as items leave, or `ac status` errors / prints nothing about the backlog in a
  project whose `.astrocode/` predates this phase (i.e. no backlog file yet).

### C7 — Ideas stay out of the debt register, the debt score and the statusline
- **Observe:** In a *scratch project*, record `node "$AC" debt score --json`, `node "$AC"
  debt list --json` and the rendered statusline segment output (`node
  /Users/buu/Development/astro-code/hooks/_astro-ctx.mjs` or the hook's documented entry
  point) before capturing anything. Capture 5 backlog items and archive one. All three
  outputs are unchanged. Inspect a captured item's stored record: it carries no priority,
  rank or score field.
- **Fails if:** backlog items appear in `debt list`, move `debt score`/pressure in any
  direction, add or alter a statusline segment, or the stored item shape includes a
  priority/score/rank field (explicitly out of scope, ADR-056).

### C8 — Adding a phase or a note no longer wipes the `· planned` markers off `ROADMAP.md`
- **Observe:** In a *scratch project* with a registry, create two phases, give one a
  `PLAN.md` so that after `node "$AC" roadmap render` its `ROADMAP.md` line ends in
  `· planned`. Copy `ROADMAP.md`, then run `node "$AC" phase add "<new name>"` and
  `node "$AC" phase note <n> "a note"`. After each, the previously-planned phase's line in
  `ROADMAP.md` still ends in `· planned`.
- **Fails if:** either command re-renders `ROADMAP.md` without the disk-derived planned flag
  (the marker disappears from lines the command did not touch), or the marker is preserved
  only by stopping the re-render so that the newly added phase/note is missing from
  `ROADMAP.md`.

### C9 — The loop commands actually reach the backlog, and the whole suite stays green
- **Observe:** Run `node --test tests/` from the repo root: all tests pass, including the
  existing contract suites (`registry`, `planning`, `debt`, `commands`) and new tests
  covering C2–C5 behaviour. Then read the shipped orchestration specs end-to-end as an
  operator would: `/astro-discuss` offers the fold-in of related open items *after* its
  existing debt prompt; `/astro-accept` closes the items linked to the phase it is closing;
  `/astro-phase` surfaces a declined match and offers proceed / show / stop rather than
  aborting. Each new human-facing reporting slot in those specs states a line budget or a
  silence rule (per CONVENTIONS "Writing to a human"; the shape guard in
  `tests/commands.test.mjs` must cover the new slots and pass).
- **Fails if:** any test fails or is skipped to get green; the drain exists in the engine but
  no command invokes it (a capture surface with no outflow is the `todo.md` D1 forbids); the
  fold-in is placed before the phase's own questions; or a new reporting slot emits unbounded
  output with no stated budget.
