# Plan — phase 27: Forge import and handover (bring the forge graph over, then forge reads astro-code)

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, named exports only, `die()` +
`✓`/`•`/`⚠`/`⊡` glyphs, a `node:test` test per `lib/` change, real fs in tests, load-bearing
comment voice, §Voice reporting budgets), `.astrocode/DECISIONS.in-force.md` (ADR-018 red-test
imports, ADR-020 wave-green, ADR-021 CRITERIA.md is the bar, ADR-029 per-verb flag allowlist,
ADR-030 external services only in the prose layer via MCP, ADR-053 strict equality never
similarity, ADR-055 voice, ADR-057 home store written only through `lib/principles.mjs`,
ADR-058 human data authoritative, ADR-059 fixed header order + strict parse), this phase's
`CONTEXT.md` (D1–D7), and aims at every criterion in `CRITERIA.md` (C1–C11).

**Precondition — do not start executing until phases 24, 25 AND 26 are on `develop`.** At
planning time (HEAD `76dc8f8`) only phases 22–23 have landed; 24/25 are planned, 26 is
discussed. This plan builds on their MERGED state and reuses, never forks:
- phase 24: `lib/principlematch.mjs` (`findCandidates`, `pickExactTarget`, `normaliseStatement`),
  the `sighting:` header key / `entry.sightings`, the `merged`/`mergedInto` status,
  `ac principles list --proposed --json` (the `/astro-review` queue) and `accept`;
- phase 25: `ac principles brief|ask` (accepted-only retrieval), the rewritten D3 guard
  `tests/forge.test.mjs`, and the `templates/forge-knowledge.md` STUB it left pointing here;
- phase 26: whatever it leaves in `bin/ac.mjs`/`MANUAL.md` — edit on top of it.
If `lib/principlematch.mjs` or sighting support is absent when t2/t4 run, the executor STOPS
and reports it — it never writes a second matcher or a private evidence format.

**Test strategy — test-first, serialized (chosen explicitly) for engine + CLI; test-in-task for
the three doc/prose guards.** RED tasks t1, t3, t5 have empty `depends_on` (wave 1); each
implementation task depends on its RED task. t1/t3 reach every not-yet-existing symbol ONLY
through `const { fn } = await import('../lib/x.mjs')` inside async test bodies (ADR-018) —
including the NEW export `importForgeExport` of the EXISTING `lib/principles.mjs`. t5 drives
`bin/ac.mjs` as a subprocess only, so a missing verb is a non-zero exit, never a load crash.
The guards in t7 (export-schema doc), t8 (read contract) and t10 (interim command) are written
in the same task as the text they guard and depend on the code they check, because they assert
on prose that only exists once written.

**Guards to respect everywhere.**
- `tests/forge_standalone.test.mjs`: no `lib/`/`bin/`/`workflows/` file may match
  `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`; CLI output may not
  match `…|knowledge graph|the brain`. The word "forge" and `--from-forge` are fine; say
  "the forge export" / "D3", never "knowledge graph", in engine comments and output.
- `tests/principle_capture.test.mjs`: no `commands/`/`agents/`/`templates/`/`workflows/`
  file may contain `forge_capture_knowledge` — the new templates and the interim command
  describe turning capture off WITHOUT naming that tool id.
- Every test that runs `ac` sets `HOME` and `ASTRO_PRINCIPLES_DIR` to `mkdtempSync` dirs. No
  test and no executor command ever touches the real `~/.astro/principles/` (it is shared by
  every session in this container and holds real proposals).
- No new `ac` verb reads stdin or prompts. Nothing in this phase edits the astro-forge repo
  or posts anything externally (D6).

---

## Decisions this plan pins (CONTEXT "Open for the planner")

**P1 — The forge export format, v1 (`templates/FORGE-EXPORT.md`, D3).** One JSON document
(not JSONL: a one-shot dump wants a versioned envelope; JSONL's only precedent,
`SURPRISES.jsonl`, is justified by append-only multi-run writes, which this is not):
```json
{ "format": "astro-forge-export", "version": 1, "exported_at": "<ISO-8601>",
  "nodes": [ {
    "slug": "commit-lockfiles", "type": "Principle", "name": "Commit lockfiles",
    "statement": "Commit the lockfile with every dependency change", "why": "…",
    "status": "approved", "confidence": "normal", "created": "<ISO-8601>",
    "signals": [ { "text": "the user's words", "source": "session 8f2c", "at": "<ISO-8601>" } ]
  } ] }
```
- Envelope keys exactly `format` (= `astro-forge-export`), `version` (= 1), `exported_at`
  (ISO string), `nodes` (array, may be empty). Anything else → refused.
- Node keys: `slug` (required; `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, unique within the file),
  `type` (required; `Principle|Pattern|AntiPattern|Preference`), `statement` (required,
  non-empty after whitespace runs — including newlines — collapse to one space), `status`
  (required; `approved|pending|rejected|superseded`), `name`, `why`, `created` (ISO),
  `confidence` (`low|normal`), `reason` (only with `rejected`), `superseded_by` (a slug; only
  with `superseded`; never itself), `signals` (array). Signal keys: `text` (required,
  non-empty), `source` (free-text origin pointer), `at` (ISO).
- **Strict: an unknown key at any level is refused**, as is a wrong type, a bad enum value, a
  duplicate slug, a `reason`/`superseded_by` on the wrong status. A field forge wants to add
  is a v2 of this document, never a silent drop (C1's "silently drops fields" failure).
- Hand-rolled field/type checks (zero deps, the `parsePrinciple` "damaged throws" precedent);
  every error names `nodes[i]` and the slug when known and the exact field. The WHOLE file is
  validated before anything is written (C6: all-or-nothing).

**P2 — Mapping (D1, D2).** Kind: `Principle→principle`, `Pattern→pattern`,
`AntiPattern→antipattern`, `Preference→preference`; strength `default`; scopes all empty; no
scope suggestions are produced (D2 permits but does not require them — so none can leak onto
entries unreviewed, C2).
| forge `status` | entry `status` | lifecycle history line appended after `imported` |
| --- | --- | --- |
| `approved` (any confidence) | `accepted` | `{ action:'accepted', at }` |
| `pending` (any confidence) | `proposed` | — |
| `rejected` | `rejected`, `reason` = forge's `reason` verbatim, else `rejected in forge` | `{ action:'rejected', at, reason }` |
| `superseded` + `superseded_by` naming a slug in this file or already keyed in the store | `superseded`, `supersededBy` = that entry's id | `{ action:'superseded', at, by }` |
| `superseded` otherwise | `retired`, `reason` = `superseded in forge` (+ ` by <slug>` when given) | `{ action:'retired', at, reason }` |
Nothing the user never approved becomes `accepted` (ADR-058). Every created entry's history
STARTS with `{ action:'imported', at, from:'forge:<slug>', forgeStatus, name?, confidence? }`
(`name` redacted), so the entry says where it came from and a forge name round-trips.
`created` = node `created` ?? `exported_at`; `at` of the history lines = import time.

**P3 — Provenance keying + evidence (D2, D4).** Entry `source` =
`{ at: created, ref: 'forge:<slug>' }`. Each signal becomes ONE sighting (phase-24 format)
`{ at: signal.at ?? created, ref: 'forge:<slug>#<key>', excerpt: text, session?: source }`,
built through the store's existing `buildSource` (redact-then-cap at 500, identical to native
capture — C2). `<key>` = first 10 hex of sha1 of `JSON.stringify([slug, text, source ?? '',
at ?? ''])` over the RAW signal, so a re-run recognises a signal it already imported.
A slug is **known** when some non-damaged entry has `source.ref === 'forge:<slug>'` or a
sighting whose `ref === 'forge:<slug>'`.

**P4 — The import algorithm (`planForgeImport`, pure; D4, ADR-058).** Over the validated
nodes in file order, against the loaded entries plus the plan's own pending creations:
1. Known slug → append only the signals whose key is not yet on that entry. NOTHING else on
   a known entry ever changes — not status, statement, why, reason, scopes or history — no
   matter what forge now says (C3, C4). Zero new signals → no write (byte-identical re-run).
2. Unknown slug whose redacted statement is `sameStatement`-exact (phase-24
   `findCandidates(...).exact` → `pickExactTarget` → follow `mergedInto`, visited-set guarded)
   with an existing entry — native or imported, or an earlier node in this file → append one
   sighting `{ at: created, ref: 'forge:<slug>' }` (this is what keys the slug next time)
   plus its signals' sightings to THAT entry; its text/status are untouched (C5, D4).
   Overlap-only candidates are never acted on (ADR-053, phase 24 P1).
3. Otherwise → create one entry per P2/P3 with a fresh `principleId`. Ids for all creations
   are assigned before superseded links are resolved, so a `superseded_by` pointing later in
   the file still lands as `superseded`.
The store function refuses the whole import (writes nothing) when `loadPrinciples` reports
ANY damaged entry: a damaged file might be the one carrying a slug's key, and importing past
it would mint a twin. Result: `{ created:[{id,slug,status}], sighted:[{id,slug,added}],
unchanged:[slug], counts }`.

**P5 — Where the code lives.** `lib/principleimport.mjs` (new, pure: no fs, no git):
`parseForgeExport(text)`, `planForgeImport(entries, doc, { now, idFor })`, `forgeSignalKey`,
`forgeSlugIndex(entries)`, and frozen constants `FORGE_EXPORT_FORMAT`, `FORGE_EXPORT_VERSION`,
`FORGE_TYPES` (type → kind), `FORGE_STATUSES`, `FORGE_ENVELOPE_KEYS`, `FORGE_NODE_KEYS`,
`FORGE_SIGNAL_KEYS`. `lib/principles.mjs` gains ONE writer, `importForgeExport(dir, text,
{ now })`: parse + validate FIRST (bad input → throw, no `mkdirSync`, no lock, nothing
written), then under ONE `withLock` re-load strictly, plan, and `writeEntry` every creation,
then every sighted entry (sighting excerpts go through `buildSource`). Only this module
writes the store (ADR-057).

**P6 — CLI (`bin/ac.mjs`).**
- `ac principles import --from-forge <file> [--json]` — syncs before and after like its
  siblings (`principlesSync`, `reportPrinciplesConflicts`). Missing `--from-forge`, a
  nonexistent/unreadable path, invalid JSON or any schema violation → `die` naming the
  problem, store untouched. Text output: exactly one line
  `✓ imported from forge — N new (a accepted, p proposed, r rejected, s superseded/retired), M matched existing, U unchanged`,
  plus one line `• p proposed awaiting review — /astro-review` only when p > 0. `--json`
  prints the result object. Allowlist row `'principles import': ['from-forge', 'json']`.
- `--no-sync` on `list` and `show` (joins `PRINCIPLES_BOOLEAN_FLAGS`; allowlist rows gain
  it): skips `principlesSync` entirely — no lock dir, no git, no write of any kind — so a
  read-only consumer (forge, D5) can follow the contract on a store it may not write (C9).
  Without the flag, behaviour is unchanged.
- HELP block + the unknown-verb list gain `import`.

**P7 — The read contract (`templates/PRINCIPLES-CONTRACT.md`, D5, C8, C9).** Mirrors
`RUN-CONTRACT.md`/`KIT-CONTRACT.md` (numbered sections, "the promise", non-goals). States
`Version: 1` and a change policy (adding an optional header key or JSON key = still v1 and
consumers must ignore unknown keys; renaming, removing or reordering anything = v2, with an ADR
and this document + its guard test updated in the same change). Surfaces covered:
1. **On-disk format** (primary, D5): store location (`$ASTRO_PRINCIPLES_DIR` else
   `~/.astro/principles/`; other machines: the phase-22 git remote), top-level `<id>.md` only
   (never `conflicts/`, `.local/`, `.lock`, `.git`), the marker line, the fixed header key
   order in ONE fenced block (`<!-- contract:header-keys -->`), which keys repeat, the JSON
   shapes of `source`/`sighting`/`history`/`promotion`, the status set and the status
   invariants (`reason` iff rejected/retired, `superseded-by` iff superseded, `merged-into`
   iff merged), the body (`# statement` then why), and ONE canonical example entry in a fenced
   block (`<!-- contract:example-entry -->`) — including a `forge:<slug>` source and a
   sighting — plus "a damaged file is skipped and reported, never guessed at".
2. **JSON reads**: `ac principles list --all --json --no-sync` and
   `ac principles show <id> --json --no-sync`, with the promised per-entry keys in ONE fenced
   block (`<!-- contract:json-keys -->`). Governs = `status === 'accepted'` only.
3. **Read-only rule**: a consumer never writes under the store, never runs `add`/`accept`/
   `import`/…; `brief`/`ask`/`cite` are agent-facing and NOT part of this contract (they
   record per-machine usage under `.local/`).
Non-goals: no write API for foreign tools; no embedding/index files; no stability promise for
text (non-`--json`) output.

**P8 — Interim export (`commands/astro-forge-import.md`, D3, C11, ADR-030).** The ONLY file in
astro-code that may grant or name forge MCP tools. `allowed-tools: Bash, Read, Write,
AskUserQuestion, ToolSearch, mcp__forge__forge_knowledge_list, mcp__forge__forge_knowledge`.
Steps:
1. Detect the tools (ToolSearch select probe). Absent → say so in ONE line
   ("forge tools are not connected — nothing to import") and stop. A failing call → one line,
   stop.
2. Page `forge_knowledge_list` per type until no new slugs appear; for each node, at most one
   `forge_knowledge` lookup by slug for its linked evidence text (none found → `signals: []`).
3. Status: this MCP surface does not expose approval, rejection or superseded state (verified
   while planning). `[low-confidence]` nodes → `pending`. For the rest, ONE `AskUserQuestion`:
   "import as proposed for review" (listed first, the default) or "I approved these in forge —
   import as accepted". Rejected/superseded nodes are not visible here; say so in one line and
   point at the forge-side exporter (handover task 1).
4. Write the file per `$(ac path templates)/FORGE-EXPORT.md` v1 (never restate the schema —
   single source) into a fresh `mktemp -d` path — NEVER under `~/.astro/principles/`.
5. One `AskUserQuestion` before the real import (it writes the shared store): "import now" /
   "keep the file only" (prints the path). On import: `ac principles import --from-forge
   <file>` — the command never writes the store itself.
6. Report: the importer's line(s) verbatim, nothing more; "keep the file only" → one line with
   the path.
`## Never`: write the store directly, call any forge write/capture tool, mark anything accepted
without the user's explicit choice, post anything anywhere.

**P9 — Handover (`FORGE-HANDOVER.md` in this phase's directory, D6, C10).** Four forge-side
tasks, each with a done-condition: (1) an export verb emitting exactly
`templates/FORGE-EXPORT.md` v1 (by reference, including approval/rejection/reason,
confidence, superseded-by and every linked Signal); (2) a read path over
`templates/PRINCIPLES-CONTRACT.md` v1 — on-disk reads of `~/.astro/principles/` in the shared
container, the user's store git remote elsewhere, read-only, `accepted` governs; (3) turn off
forge capture: its miner and approval queue retire, and forge stops writing principle nodes;
(4) retire the forge graph's generator nodes ONLY after a verified import — done when the
exporter's file imports into a scratch store with `ac principles import --from-forge`
(exit 0, entry count == node count, spot-checked statuses) and then into the real store.
A "Filing" section: nothing has been filed externally; where to file (astro-context,
ClickUp, …) is the user's call, asked at the end of the phase.

**P10 — astro-code's last forge reads leave (D6, C11).** Delete `templates/forge-knowledge.md`
and every consumer of it in one task; root `AGENTS.md`'s and `MANUAL.md`'s
"Forge knowledge graph (optional)" sections are replaced by a two-line pointer to
`/astro-forge-import` and `templates/PRINCIPLES-CONTRACT.md`.

**P11 — Canon.** One `ac decision add` (never hand-edited DECISIONS) records P1–P8's pinned
specifics; rejected alternatives: JSONL, lenient unknown-key handling, status sync on re-import,
fuzzy/overlap dedupe, reading forge over MCP inside `ac`, making `brief`/`ask` part of the
contract, forge proposing via `ac`.

---

## Tasks

### t1 — RED: export parser + import planner unit tests
- **file:** `tests/principleimport.test.mjs` (new)
- **depends_on:** —
- `const { parseForgeExport, planForgeImport, forgeSignalKey, forgeSlugIndex, FORGE_TYPES,
  FORGE_STATUSES, FORGE_NODE_KEYS, FORGE_SIGNAL_KEYS, FORGE_ENVELOPE_KEYS } = await
  import('../lib/principleimport.mjs')` inside each async test. Entries are plain objects shaped
  like `parsePrinciple` output (with phase-24 `sightings`).
- Parser (P1): a full valid doc parses; statement newlines collapse; each refusal throws a
  message naming the problem — not JSON, a JSONL-looking text, an array top level, wrong
  `format`, `version: 2`, unknown envelope key, unknown node key, unknown signal key, missing
  slug (message names `nodes[1]`), bad slug, duplicate slug, unknown type `Concept`, unknown
  status, empty statement, `reason` on approved, `superseded_by` on pending, self-supersede,
  signal without text.
- Planner (P2–P4), with `idFor` = a deterministic counter and a fixed `now`:
  - the CRITERIA-shaped node set (approved Principle, pending Pattern, rejected AntiPattern
    with reason, rejected Preference without reason, superseded → in-file target, superseded
    → unknown target, low-confidence pending, low-confidence approved) yields the exact
    statuses/kinds/reasons/`supersededBy` of the P2 table, empty scopes, history starting
    `imported` (with `from`, `forgeStatus`, `name`), `source.ref === 'forge:<slug>'`, and one
    sighting per signal with `ref` `forge:<slug>#<key>`;
  - a later-in-file `superseded_by` still resolves to `superseded`;
  - known slug (via `source.ref`, and via a sighting `ref`) with one new signal → only that
    signal is planned; with no new signal → `unchanged`; forge status/statement changes on a
    known accepted, rejected, edited (history `edited`/`amended`) or proposed entry plan NO
    field change (C4);
  - a native entry with a re-punctuated/re-cased identical statement → sighted (with the
    `forge:<slug>` keying sighting), not created (C5); a `merged` exact match lands on its
    survivor; an overlap-only match is created, never sighted;
  - two nodes with the same statement in one file → one creation + one sighting;
  - `forgeSignalKey` is stable across calls and differs when text differs.

### t2 — Pure export parser + planner module
- **file:** `lib/principleimport.mjs` (new)
- **depends_on:** t1
- Implement P1–P5's pure half. Imports only `node:crypto`, `./redact.mjs`,
  `./principlematch.mjs`, `./principlemd.mjs` (for `KINDS`/statuses — never redefine them).
  Named exports only; frozen constants. Module header says: why a strict, versioned envelope
  (a silent drop is data loss the user never sees); why validate-everything-before-writing
  (C6); why re-import only ever appends evidence (ADR-058 — the human's decision in astro-code
  outranks forge's later one); why exact-only dedupe (ADR-053); why signal keys hash the RAW
  signal. No `knowledge graph`/MCP wording (standalone guard).
- `node --test tests/principleimport.test.mjs tests/forge_standalone.test.mjs` → green.

### t3 — RED: store-level import tests
- **file:** `tests/principles_import.test.mjs` (new)
- **depends_on:** —
- `const { importForgeExport, loadPrinciples, proposePrinciple, addPrinciple, acceptPrinciple,
  rejectPrinciple, amendPrinciple } = await import('../lib/principles.mjs')` inside each async
  test; store dirs are `mkdtempSync`.
- C1: the fixture imports; `loadPrinciples` shows one entry per created node with the P2
  statuses, and every file re-parses clean.
- C2: a signal carrying `AKIAIOSFODNN7EXAMPLE` and a `ghp_…` token — no raw secret in any store
  file; the imported sighting excerpt equals the excerpt the native path stores for the same
  text (`proposePrinciple` with `source.excerpt`).
- C3: a second identical import → every file byte-identical (digest of the directory); adding
  one node and one signal on a still-proposed node → exactly one new file and one new sighting.
- C4: after import, accept one proposed entry with an edited statement, reject another with a
  reason, amend an imported accepted entry; flip those nodes' forge status and statement in the
  fixture; re-import → status, statement, reason and history of all four unchanged (only
  `sighting:` lines may be added).
- C5: a native `addPrinciple` statement equal to a node's modulo case/punctuation → still one
  entry, with the forge sightings; its status/text untouched; a re-run keys on it (no twin).
- C6: invalid JSON and a schema-violating doc → throws; a store dir that did not exist is
  still absent; an existing store's digest is unchanged. A store holding a damaged entry →
  refuses, digest unchanged.

### t4 — Store writer `importForgeExport`
- **file:** `lib/principles.mjs`
- **depends_on:** t2, t3
- Implement P5's writer: parse before any fs call; ONE `withLock`; strict re-load inside it
  (damaged → throw naming the files); `planForgeImport(entries, doc, { now, idFor: s =>
  uniqueId(dir, principleId(s, now)) })` — guard against two creations in one run drawing the
  same id; `writeEntry` creations then sighted entries; sighting records through
  `buildSource`. JSDoc + a module-header paragraph: the import is the one bulk writer, why it
  is all-or-nothing, and that it never refreshes a known entry.
- `node --test tests/principles_import.test.mjs tests/principles.test.mjs tests/principles_review.test.mjs` → green.

### t5 — RED: CLI tests for `import --from-forge`, `--no-sync`, review and retrieval of imports
- **file:** `tests/principles_import_cli.test.mjs` (new)
- **depends_on:** —
- Subprocess only (`spawnSync(process.execPath, [AC, …], { input: '', env, windowsHide: true })`),
  `HOME` + `ASTRO_PRINCIPLES_DIR` temp dirs, inline fixture written to a temp file.
- `import --from-forge <file>` → exit 0, stdout's first line starts `✓ imported from forge`,
  a `• … proposed awaiting review — /astro-review` line; `list --all --json` holds the P2
  statuses/kinds, `source.ref` values `forge:<slug>`, sightings per signal, empty scopes.
- `--json` prints `created`/`sighted`/`unchanged`.
- C6: nonexistent path, invalid JSON, unknown type, missing slug, missing `--from-forge` → each
  non-zero with a message naming the problem; store digest unchanged. `--bogus` dies (ADR-029).
- C7: `list --proposed --json` (the `/astro-review` queue) holds exactly the pending +
  low-confidence-pending imports; `accept <id>` on one → accepted, and a re-import leaves it
  accepted; `brief --json` (phase 25) serves the accepted imports and none of the proposed/
  rejected/superseded/retired ones; `ask "<a word from an accepted statement>" --json` likewise.
- C9: after an import, `chmod -R a-w` the store (skip with a note when `process.getuid?.() === 0`,
  where chmod does not bind); `list --all --json --no-sync` and `show <id> --json --no-sync`
  exit 0 with the same stdout as when writable; after restoring, the recursive listing
  (incl. hidden dirs) and file digests are unchanged. Without `--no-sync`, `list` still works
  on a writable store (unchanged behaviour).
- `ac help` lists `principles import`.

### t6 — CLI: `principles import`, `--no-sync` on `list`/`show`
- **file:** `bin/ac.mjs`
- **depends_on:** t4, t5
- Implement P6 inside the `case 'principles':` block: import `importForgeExport`; read the file
  (`die` on ENOENT/EISDIR naming the path); allowlist rows; `no-sync` in
  `PRINCIPLES_BOOLEAN_FLAGS`; HELP and the unknown-verb list. No stdin, no prompt.
- `node --test tests/principles_import_cli.test.mjs tests/principles_cli.test.mjs tests/principles_review_cli.test.mjs tests/principles_sync_cli.test.mjs tests/forge_standalone.test.mjs tests/flags.test.mjs` → green.

### t7 — The forge export schema document + its guard
- **files:** `templates/FORGE-EXPORT.md` (new), `tests/forge_export_doc.test.mjs` (new)
- **depends_on:** t2
- Write P1+P2+P3 for a forge maintainer: `Version: 1`, envelope, node and signal field tables
  (one row per key: name, required?, type, meaning), the status/kind mapping table, the
  keying/idempotency and "re-import never overrides a human decision" rules, the redaction
  note (astro-code redacts and caps every signal — the exporter sends raw text), the
  all-or-nothing refusal, and ONE complete example document in a ```json fence covering every
  type, every status (rejected with and without reason, superseded with an in-file target),
  a low-confidence node and 1–3 signals per node. No MCP tool ids.
- Guard (test-in-task; static import is fine, t2 has landed): the key names in the doc's field
  tables equal `FORGE_ENVELOPE_KEYS`/`FORGE_NODE_KEYS`/`FORGE_SIGNAL_KEYS`, the listed types and
  statuses equal `FORGE_TYPES`/`FORGE_STATUSES`; the example fence passes `parseForgeExport`,
  and `planForgeImport([], …)` over it yields every entry status of the mapping table.
- `node --test tests/forge_export_doc.test.mjs tests/principle_capture.test.mjs tests/install.test.mjs` → green.

### t8 — The read contract + its guard
- **files:** `templates/PRINCIPLES-CONTRACT.md` (new), `tests/principles_contract.test.mjs` (new)
- **depends_on:** t6
- Write P7. Guard (test-in-task):
  - the doc states `Version: <n>` and has a change-policy section;
  - the `contract:header-keys` block equals `HEADER_KEYS` from `lib/principlemd.mjs` in order;
  - the `contract:example-entry` block parses with `parsePrinciple` and
    `renderPrinciple(parsePrinciple(x)) === x` byte for byte;
  - every key in `contract:json-keys` is present, with the documented type, on every item of
    `ac principles list --all --json --no-sync` and on `show <id> --json --no-sync`, run
    against a temp store populated via `ac principles import --from-forge` (a fixture with
    proposed/accepted/rejected/superseded entries and sightings);
  - every backticked `ac principles … --no-sync` command in the doc, placeholders substituted,
    exits 0 against that store after `chmod -R a-w` (root-skip as in t5), and the store's
    listing + digests are unchanged afterwards (C9).
- `node --test tests/principles_contract.test.mjs tests/install.test.mjs` → green.

### t9 — Delete the forge-knowledge stub and every consumer of it
- **files:** `templates/forge-knowledge.md` (deleted), `tests/forge.test.mjs`,
  `tests/install.test.mjs`, `AGENTS.md`, `MANUAL.md`
- **depends_on:** —
- One atomic change (ADR-020): delete the stub; in `tests/forge.test.mjs` drop the stub
  assertions and ADD "no shipped file (`commands/`, `agents/`, `templates/`, `hooks/`,
  `workflows/`, `lib/`, `bin/`) mentions `forge-knowledge.md`"; in `tests/install.test.mjs`
  replace the "ships templates/forge-knowledge.md" assertion with "does not ship it" while
  keeping its phantom-command/agent checks; root `AGENTS.md` and `MANUAL.md` (section + TOC
  link) get P10's two-line pointer. First run `git grep -n "forge-knowledge"` (excluding
  `.astrocode/`): any further hit left by phases 24–26 is fixed IN THIS TASK and named in the
  commit body. Keep phase 25's other D3 guards in `forge.test.mjs` untouched.
- `node --test tests/forge.test.mjs tests/install.test.mjs tests/commands.test.mjs tests/agentsmd.test.mjs tests/hosts.test.mjs` → green.

### t10 — Interim `/astro-forge-import` command + guard + help line
- **files:** `commands/astro-forge-import.md` (new), `commands/astro-help.md`, `tests/forge.test.mjs`
- **depends_on:** t6, t7, t9
- Write P8 in the `astro-debt.md`/`astro-review.md` shape (numbered steps, then `## Never`);
  every reporting slot states its bound inline. `astro-help.md` gets one line: ``- `/astro-forge-import` —
  bring principles over from a connected forge server (writes an export file, then runs
  `ac principles import --from-forge`)``.
- `tests/forge.test.mjs` (as t9 leaves it): relax the "no `mcp__forge__` in `commands/`/`agents/`"
  guard to "ONLY `commands/astro-forge-import.md`", and extend it to `templates/`, `hooks/`,
  `workflows/`; the `ToolSearch(`/`AntiPattern`/`EvidencedBySignal` restatement guard likewise
  exempts only that file; new assertions on it: grants no forge write/capture tool, runs
  `ac principles import --from-forge`, points at `FORGE-EXPORT.md`, writes the export under a
  `mktemp -d` path, never names `~/.astro/principles` except to forbid writing it, has the
  tools-absent one-line stop, and asks before the import and before any `accepted` marking;
  the `format`/`version` values it names equal `FORGE_EXPORT_FORMAT`/`FORGE_EXPORT_VERSION`.
- `node --test tests/forge.test.mjs tests/install.test.mjs tests/hosts.test.mjs tests/commands.test.mjs tests/principle_capture.test.mjs` → green.

### t11 — The forge-side handover task list
- **file:** `.astrocode/phases/27-forge-import-and-handover-bring-the-forge-graph-over-then-forge-reads-astro-code/FORGE-HANDOVER.md` (new)
- **depends_on:** t7, t8
- Write P9 for a forge maintainer with no astro-code context: a short "why" paragraph, the four
  tasks (each: what, the exact document + version it must match, done-condition), the ordering
  (1 → 4, with 4 gated on the verified import), and the Filing section. It references
  `templates/FORGE-EXPORT.md` v1 and `templates/PRINCIPLES-CONTRACT.md` v1 by path (installed
  copies under `~/.astro/code/templates/`). No edit to the astro-forge repo; nothing posted.

### t12 — Docs, canon, final gate
- **files:** `MANUAL.md`, `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** t8, t9, t10, t11
- `MANUAL.md` (on top of t9 and phases 24–26; never revert their text): Principles section gains
  "Importing from forge" (the command, the file-only importer, the mapping, re-runs only add
  evidence, where the schema lives) and "Reading the store from another tool"
  (`PRINCIPLES-CONTRACT.md`, `--no-sync`); cheat-sheet lines for `import --from-forge` and
  `--no-sync`.
- `node bin/ac.mjs decision add "Forge import and read-contract specifics this plan pinned: …"
  --why "…" --rejected "…"` per P11; record its output as-is.
- **Final gate** (C1–C11): record `find ~/.astro/principles -type f -exec sha1sum {} + | sort |
  sha1sum` for the REAL home first; `HOME=$(mktemp -d) node --test tests/` → 0 failures,
  0 cancelled; `git grep -nE "mcp__|forge_knowledge|nanograph" -- lib bin workflows` → no hit;
  `git grep -n "forge-knowledge" -- . ':!.astrocode'` → no hit; `package.json` has 0
  dependencies; the real-home digest is unchanged; `git log` for the phase touches no path
  outside this repo. The run summary ends by ASKING the user whether and where to file
  `FORGE-HANDOVER.md` — never files it.

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t3, t5, t9 |
| 2 | t2 |
| 3 | t4, t7 |
| 4 | t6 |
| 5 | t8, t10 |
| 6 | t11 |
| 7 | t12 |

Rule checks:
- **Test-first, serialized.** RED tasks t1, t3, t5 have empty `depends_on`; t2←t1, t4←t3,
  t6←t5. t1/t3 use only `await import(...)` for every symbol (including the new
  `importForgeExport` on an existing module); t5 is subprocess-only. The doc/prose guards (t7,
  t8, t10) are test-in-task by choice, each after the code it checks.
- **Wave-green.** The only destructive edit — deleting `templates/forge-knowledge.md` — carries
  every consumer (`tests/forge.test.mjs`, `tests/install.test.mjs`, `AGENTS.md`, `MANUAL.md`,
  plus any grep hit) in t9. Every other task is additive: a new verb/flag, new modules, new
  docs; `--no-sync` leaves default behaviour unchanged.
- **One owner per wave per file.** `tests/forge.test.mjs`: t9 → t10. `MANUAL.md`: t9 → t12.
  `bin/ac.mjs`: t6. `lib/principles.mjs`: t4. `lib/principleimport.mjs`: t2.
  `commands/astro-help.md`: t10. `AGENTS.md`, `tests/install.test.mjs`: t9.
  `.astrocode/DECISIONS*.md`: t12. Every other file is new and owned by one task. No two tasks
  in one wave share a file.
- **Every task declares its files and lands a stamped commit.** The final gate is folded into
  t12; no task is `commits: none`.
