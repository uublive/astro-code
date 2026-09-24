# Phase 27 — acceptance (human UAT)

Run every `ac` step with a scratch store (`export ASTRO_PRINCIPLES_DIR=$(mktemp -d)`) unless an
item says otherwise. The real `~/.astro/principles/` is shared by every session in this
container.

- [ ] **The user can import a forge export written only from the published schema.**
  Precondition: an empty scratch store, and an export file the user wrote by reading
  `templates/FORGE-EXPORT.md` alone. It holds at least one approved, one pending, one rejected
  (with a reason), one superseded and one low-confidence node, several of them with signals.
  `ac principles import --from-forge <file>` prints one summary line. `ac principles list --all`
  shows approved → accepted, pending and low-confidence → proposed, rejected → rejected (with
  forge's reason), and superseded → superseded or retired. `ac principles show <id>` shows the
  forge slug as the source and the signals as evidence.

- [ ] **The user can review the imported proposals in `/astro-review`, and only those.**
  Precondition: the scratch store from the item above, still holding at least two proposed
  imports and at least one accepted and one rejected import. `/astro-review` offers exactly the
  proposed imports. After the user accepts one there, re-running the same import leaves it
  accepted.

- [ ] **The user can re-run the import without creating duplicates or losing decisions.**
  Precondition: the scratch store holds an earlier import of the same file, plus a principle
  the user added natively with the same wording as one forge node. In astro-code, the user has
  since edited one imported entry and rejected another. The entry count does not change on
  re-run. The edited and rejected entries are exactly as the user left them. The native
  principle gains evidence, not a twin.

- [ ] **The user can see a bad export refused, with nothing written.**
  Precondition: a scratch store holding one earlier import. Importing a truncated JSON file,
  then a file with an unknown node type, exits with an error naming the problem each time. The
  store is unchanged, which `ac principles list --all` confirms.

- [ ] **The user can bring the live forge graph over with `/astro-forge-import`.**
  Precondition: forge MCP tools connected in this session, forge's graph holding its current
  nodes, and `ASTRO_PRINCIPLES_DIR` pointed at a scratch store. The command writes an export
  file to a temp path and asks before importing. It never marks anything accepted unless the
  user chooses to. Choosing "import now" fills the scratch store. In a session where forge is
  not connected, the command says so in one line and stops.

- [ ] **The user can hand forge a read contract and a task list.**
  Precondition: the phase's commits are on the branch. The user reads
  `templates/PRINCIPLES-CONTRACT.md`, which is versioned and has a change policy. Its documented
  read commands (`… --no-sync`) run against a store the user made read-only. The user also reads
  `FORGE-HANDOVER.md` in this phase's directory. It lists four forge-side tasks (export verb,
  read path, stop capturing, retire nodes after a verified import), each with a done-condition.
  Nothing has been posted anywhere, and the phase asked where to file the list.

- [ ] **The user can confirm astro-code no longer reads from forge.**
  Precondition: a fresh `node bin/ac.mjs install` into a scratch HOME. `templates/forge-knowledge.md`
  is gone. The only shipped file that names a forge tool is `commands/astro-forge-import.md`.
  `HOME=$(mktemp -d) node --test tests/` passes.
