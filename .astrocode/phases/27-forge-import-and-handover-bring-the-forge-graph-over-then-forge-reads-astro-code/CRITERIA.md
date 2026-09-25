# Phase 27 — Forge import and handover: success criteria

> Pre-registered, plan-blind. Derived from the phase goal, CONTEXT.md (D1–D7) and canon
> (ADR-030, ADR-057/058/059). Every criterion must hold independently.

**Isolation rule for every criterion that runs `ac`:** the live store `~/.astro/principles/`
is shared by every session in this container and holds real proposals. Run each check with
`HOME` pointed at a fresh `mktemp -d` (or the store's documented location override), invoke
`node /Users/buu/Development/astro-code/bin/ac.mjs …`, and record
`find ~/.astro/principles -type f -exec sha1sum {} + | sort | sha1sum` for the REAL home
before and after the whole verification. A changed digest fails every criterion that ran.

**Fixture rule:** build the forge export from the importer's published schema documentation
ALONE (not by copying a fixture from `tests/`). One fixture, reused below, containing at least:
an approved Principle, a pending Pattern, a rejected AntiPattern carrying a reason, a rejected
Preference with no reason, a superseded node (with its superseded-by where the schema allows),
a low-confidence unapproved node, and nodes carrying 1–3 linked signals each.

### C1 — An export written purely from the documented schema imports offline, and every forge human decision lands as the matching status and kind
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** with no forge server, MCP or nanograph reachable, run the documented forge-import
  invocation on the fixture, then list the store as JSON (`ac principles list --json` or the verb
  the read contract names). Expect exit 0 and one entry per forge node with: approved → `accepted`;
  pending → `proposed`; rejected → `rejected` with forge's reason preserved verbatim where one
  existed and a fixed non-empty reason otherwise; superseded → a superseded/retired status (not
  `accepted`, not `proposed`); low-confidence unapproved → `proposed`. Kind maps 1:1
  (Principle→principle, Pattern→pattern, AntiPattern→antipattern, Preference→preference), and the
  name/statement text round-trips.
- **Fails if:** the documented schema and the importer disagree (a doc-conformant file is refused
  or silently drops fields/nodes); any node the user never approved — pending, low-confidence, or
  rejected — ends up `accepted` (ADR-058); a rejected entry has an empty or lost reason; kinds
  collapse or mismatch; the import needs a network, MCP or forge process to run.

### C2 — Every imported entry says where it came from and carries its forge signals as evidence, with empty scopes
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** for each imported entry, inspect it via the store's show/JSON output or its on-disk
  file: it records the forge slug as its source, its history contains an import event, each
  linked signal from the fixture appears as evidence (source excerpt and/or sightings) on THAT
  entry, and its scopes are empty. Additionally feed one signal containing a secret-shaped
  string and capture the same text through astro-code's native evidence path: the imported form
  is redacted exactly as the native one is. Any scope suggestions the importer offers exist only
  as a reviewable item — no entry's scopes are populated by the import.
- **Fails if:** the slug or import provenance is missing (re-runs then cannot key on it); signals
  are dropped, merged onto the wrong entry, or stored verbatim where native capture would redact;
  the importer writes scopes onto entries unreviewed.

### C3 — Re-running the import is idempotent: known nodes gain sightings, new nodes are added, nothing is duplicated
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** import the fixture, snapshot the list JSON, import the identical file again: the
  entry count and each entry's status/statement are unchanged and no second copy of any slug
  exists. Then add one new node and one new signal on an existing still-proposed node to the
  export and re-import: exactly one entry is added, and the existing node gains a
  sighting/evidence rather than a twin entry.
- **Fails if:** a second run duplicates entries, a known node becomes a new entry because its
  text or signals changed, a new node is missed, or a re-run errors out on already-imported data.

### C4 — A re-import never overwrites what the human decided in astro-code
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** after the first import, in astro-code: edit the text of one proposed entry, accept
  another proposed entry, reject a third with a reason, and hand-edit an imported `accepted`
  entry's statement. Record those four entries (on-disk content or show JSON). Change the
  fixture so forge now reports different statement text and a different status for all four
  nodes (e.g. approved→rejected, rejected→approved), then re-import. Each of the four is
  unchanged in status, statement and rejection reason (a new sighting may be appended, nothing
  else). An untouched still-proposed entry may be refreshed.
- **Fails if:** any human-accepted, edited or rejected entry's status, statement or reason
  changes on re-import, or an entry the user rejected in astro-code is resurrected as proposed
  or accepted from forge's side (ADR-058).

### C5 — Importing dedupes against principles that were captured natively, not only against earlier imports
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** in a fresh temp HOME, create a principle through astro-code's native capture path
  whose statement matches a fixture node (same wording, trivially re-punctuated/re-cased as the
  phase-24 matcher treats as the same). Import the fixture. The native entry gains a sighting/
  evidence from the forge node; the store holds one entry for that principle, not two.
- **Fails if:** the import creates a twin next to the native entry, or it overwrites the native
  entry's status/text instead of adding evidence.

### C6 — A malformed export is refused loudly and writes nothing
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** snapshot the temp store (file digests), then run the import on (a) a file that is
  not valid JSON/JSONL and (b) a syntactically valid file whose records violate the documented
  schema (e.g. an unknown node type, a node missing its slug). Each exits non-zero with a message
  naming the problem; the store digest is identical to the snapshot. A nonexistent path also
  exits non-zero.
- **Fails if:** a bad file exits 0, half-applies (some entries written before the error), or
  imports schema-violating nodes under a guessed kind/status.

### C7 — Imported still-pending forge proposals are what /astro-review presents for review, and only those need a decision
_Withdrawn R1 (user decision 2026-09-25, CONTEXT "Revision R1"): the forge import was removed from scope — astro-code starts clean. Not graded._
- **Observe:** after importing the fixture into a temp HOME, drive the listing step that
  `commands/astro-review.md` itself prescribes (the `ac` verb it runs) against that HOME. The
  forge-pending and low-confidence nodes appear as reviewable proposals; the forge-approved,
  forge-rejected and superseded ones do not appear as awaiting a decision. Accepting one through
  the review path's accept verb moves it to `accepted` and a re-import leaves it so (C4).
  Separately, the retrieval output agents receive (`ac principles brief`/`ask`, per phase 25)
  includes the accepted imports and never the proposed, rejected or superseded ones.
- **Fails if:** imported proposals are invisible to the review flow, already-decided forge nodes
  are re-queued for a decision, or unapproved/rejected/superseded imports reach agent retrieval.

### C8 — A versioned read contract for forge is documented, true of the real output, and guarded so a format change breaks the suite
- **Observe:** read the read-contract document the phase ships (the contract forge will read
  against, per D5): it states a version and which surfaces it covers (on-disk entry format and/or
  the named `--json` outputs). Using the C1 store, check every field/section the contract promises
  against the actual entry files and/or JSON output — all present with the documented shape and
  meaning. Then, in a scratch copy of the repo (`cp -r` or `git worktree add` into the scratchpad,
  never the working tree), rename one contract-promised field in the emitted output (or reorder
  the fixed header, per whatever the contract pins) and run `node --test`: at least one test fails.
  `node --test` on the unmodified repo passes.
- **Fails if:** the contract has no version or no change policy, documents a field the real output
  lacks or shapes differently, or a contract-breaking format change leaves the suite green (the
  "pinned by tests" guarantee is decorative).

### C9 — The contract is readable by a read-only consumer: following it never writes to the store
- **Observe:** populate a temp store via C1, record its file digests and directory listing
  (including hidden lock/cache dirs), `chmod -R a-w` it, then execute every read path the
  contract tells a consumer to use (reading entry files per the documented format and/or each
  documented `ac … --json` read command). All succeed with the same content as when writable;
  after restoring permissions, digests and listing are unchanged.
- **Fails if:** a documented read command needs write access (lock dir, index, cache, last-seen
  stamp, sync) or mutates the store, so forge-as-reader (D5) would either fail or write.

### C10 — A forge-side handover task list exists that a forge maintainer could execute without astro-code context
- **Observe:** read the handover document the phase ships in this repo. It contains four
  actionable tasks: (1) an export verb producing exactly the documented import schema (by
  reference to that schema), (2) a read path over the versioned read contract (C8), including
  on-disk read in the shared container and the git-remote path for other machines, (3) turning
  off forge's capture/miner and approval queue, (4) retiring the forge graph's generator nodes
  only after the import has been verified. Each names its done-condition. Git history for the
  phase shows no commit touching the astro-forge repository and the phase posted nothing
  externally on its own (any external filing is presented as a question to the user).
- **Fails if:** any of the four tasks is missing or vague ("update forge"), the export task
  points at a schema different from the one the importer accepts, retirement is not gated on a
  verified import, or the phase edits astro-forge / auto-posts the list externally.

### C11 — astro-code no longer depends on forge anywhere except the explicit import path, and the interim export only feeds the importer
_Revised R1: there is no import path any more, so the exception is gone — astro-code has no forge dependency at all (no `/astro-forge-import`, no export schema, no importer)._
- **Observe:** install astro-code into a scratch target with its own installer (or inspect the
  shipped `commands/`, `agents/`, `templates/`, `hooks/`, `workflows/`, `lib/`, `bin/`): no
  capture, retrieval, verify or review step instructs an agent to call a forge MCP tool or read a
  forge knowledge template; the only forge-MCP use is the interim export command. Read that
  command: it pages forge's knowledge list (+ signals) into a file in the documented import
  schema, then hands it to the importer — it never writes `~/.astro/principles/` itself — and when
  forge tools are absent it says so once and stops (ADR-030). `lib/`, `bin/` and `workflows/`
  contain no MCP, nanograph or forge-process coupling (the importer works on a file only, C1).
  `node --test` passes with no test that asserts forge integration is present.
- **Fails if:** a retired forge read/write path or its template stub is still reachable from any
  shipped command/agent; the interim command writes the store directly or emits a shape the
  importer rejects; executable code reaches forge.
