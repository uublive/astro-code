# Principles read contract

Version: 1

What a read-only consumer of the personal principle store (a forge server, another tool)
can rely on. This is the promise a foreign reader gets, distinct from `ac principles
brief`/`ask`/`cite` — those are agent-facing, per-machine (they record usage under
`.local/`) and NOT part of this contract; a consumer following this document never calls
them.

**Change policy.** Adding an optional header key or an optional JSON key is still v1 — a
consumer must ignore a key it does not recognise. Renaming, removing or reordering
anything this document pins is v2: a new ADR and an update to this document (and its
guard test, `tests/principles_contract.test.mjs`) land together, never silently.

## 1. On-disk format

The store lives at `$ASTRO_PRINCIPLES_DIR` if set, else `$HOME/.astro/principles/`; on a
machine outside the container that shares `~/.astro/principles/` with the agent sessions,
it is instead reached through the phase-22 git remote (`ac principles remote`) configured
for that store. Only TOP-LEVEL `<id>.md` files are entries — never `conflicts/`, `.local/`,
`.lock`, or `.git`.

Every entry file starts with the exact line `<!-- astro-principle -->`, then a fixed-order
header of `key: value` lines, then `---`, then a body (`# statement`, optionally a blank
line and a why paragraph). The header key order — some keys repeat, most do not — is:

<!-- contract:header-keys -->
```
id
kind
strength
status
created
stack
work
files
reason
superseded-by
merged-into
source
promotion
history
sighting
```
<!-- /contract:header-keys -->

`files`, `promotion`, `history` and `sighting` may repeat (0 or more lines each, in
file order); every other key appears at most once. `id`, `kind`, `strength`, `status` and
`created` are required; the rest are optional and, where present, invariant to status:
`reason` appears if and only if `status` is `rejected` or `retired`; `superseded-by` if
and only if `status` is `superseded`; `merged-into` if and only if `status` is `merged`.
The status set is `proposed`, `accepted`, `rejected`, `retired`, `superseded`, `merged`
(`merged` is terminal — a merged entry's evidence lives on its survivor, named by
`merged-into`).

Scope values: `stack` and `work` are ONE line each holding a comma-and-space separated list,
lowercased (`stack: node, deno`, `work: code, docs`); `files` repeats, one glob per line
(`files: lib/**`). A missing scope line means that scope is empty (applies everywhere).

`source`, each `promotion`, each `history` and each `sighting` line is one JSON object:

- **`source`** — `{ at, ref?, session?, project?, excerpt? }`. `at` (ISO-8601) is always
  present; the rest are optional pointers to where the entry came from.
- **`sighting`** — `{ at, ref?, session?, project?, excerpt?, mergedFrom? }`. Append-only
  evidence that the entry recurred; never rewritten, only added to.
- **`history`** — one lifecycle event per line, e.g. `{ action, at, ... }` with
  `action` one of `accepted`, `rejected`, `retired`, `superseded`, `merged`, `promoted`,
  `edited`, `amended`, `refreshed`, `reopened`, `imported`. Nothing writes `imported`
  any more (astro-code does not import from another store, ADR-065); it can still appear
  on an entry written by v0.29.0, and a reader treats it like any other past event.
- **`promotion`** — `{ project, path, as, ref, at }`, recorded when the entry was promoted
  into a project's own canon.

A damaged file (a parse failure — a missing marker, an out-of-order header, an unknown
key, unresolved conflict markers, …) is SKIPPED and reported, never guessed at: a reader
following this contract must treat a damaged entry as absent from the readable set and
surface it, exactly like `ac principles list` does, rather than attempt to repair or
partially interpret it.

### Canonical example entry

Includes a source and one sighting, so a consumer can see both shapes in one file:

<!-- contract:example-entry -->
```
<!-- astro-principle -->
id: 2026-09-01-commit-lockfiles-a1b2
kind: principle
strength: default
status: accepted
created: 2026-09-01T00:00:00.000Z
stack: node
work: code
source: {"session":"session 8f2c","project":"astro-code","at":"2026-09-01T00:00:00.000Z","excerpt":"always commit the lockfile, no exceptions"}
history: {"action":"accepted","at":"2026-09-01T00:00:00.000Z"}
sighting: {"session":"session 9a01","at":"2026-09-03T00:00:00.000Z","excerpt":"committed the lockfile again"}
---

# Commit the lockfile with every dependency change

Reproducible installs across every machine and CI run.
```
<!-- /contract:example-entry -->

## 2. JSON reads

`ac principles list --all --json --no-sync` (every entry) and
`ac principles show <id> --json --no-sync` (one entry) — always with `--no-sync` from a
read-only consumer (section 3). Every item carries at least these keys:

<!-- contract:json-keys -->
```
id: string
kind: string
strength: string
status: string
created: string
scopes: object
statement: string
why: string
promotions: array
history: array
sightings: array
sightingCount: number
```
<!-- /contract:json-keys -->

`scopes` is `{ stack: string[], files: string[], work: string[] }` (each possibly empty).
`reason` (string), `supersededBy` (string), `mergedInto` (string) and `source` (object) are
present if and only if the on-disk header carries `reason`, `superseded-by`, `merged-into`
and `source` respectively (section 1's invariants) — never under any other name. **`status === "accepted"` is what governs**
— an entry a consumer surfaces as "in force" must be filtered to that status; `proposed`,
`rejected`, `retired`, `superseded` and `merged` entries are visible in this JSON for
context but never treated as governing.

## 3. Read-only rule

A consumer of this contract NEVER writes under the store: no `add`/`accept`/`reject`/
any other mutating verb, no file write, no lock directory, no sync. Every command
this document names is run with `--no-sync` so it skips `lib/principlesync.mjs` entirely —
no git fetch, no lock acquisition, nothing written — which is what makes it safe to run
against a store the consumer does not own or cannot write to. `ac principles brief`/`ask`/
`cite` are NOT part of this contract (they are agent-facing and record per-machine usage
under `.local/`, itself a write) — a read-only consumer never calls them.

## Non-goals

No write API for a foreign tool, and no import path into this store: it holds only what
astro-code itself captures (ADR-065). No embedding or index file is promised. No stability promise is made for
non-`--json` (human-readable) output — only the on-disk format and the named `--json`
commands are pinned.
