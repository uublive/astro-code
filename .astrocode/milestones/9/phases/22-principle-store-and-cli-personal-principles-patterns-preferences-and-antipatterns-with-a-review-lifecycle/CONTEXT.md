<!-- astro-discuss: captured -->
# Phase 22 — Principle store and CLI: context

Milestone 9 "Second Nature" (PROJECT.md). This phase builds the PERSONAL store and its
whole manual surface. Capture at intent moments (23), the review workflow (24), retrieval
into prompts (25), the transcript miner (26) and the forge import (27) build on it and are
OUT of scope here — but the data model below must already carry what they need.

## Decisions

### D1 — The store lives in the user's home, optionally synced through a private git repo
- Local store: `~/.astro/principles/` (overridable, e.g. `ASTRO_PRINCIPLES_DIR`, so tests
  never touch the real home). Never inside a project's `.astrocode/` — one developer's
  preferences must not land in a teammate's clone.
- `ac principles remote <url>` backs it with the user's OWN private git repo, so the
  container and the Mac hold one set. No remote → purely local, fully functional.
- This is a deliberate carve-out of ADR-048's "lib/ must not write outside .astrocode/"
  (`ac tune`/`ac install` already write outside it). Record it as a decision (see bottom).

### D2 — Offline-first sync
- Every command writes locally and succeeds, remote or not, reachable or not.
- The next command that can reach the remote pushes and pulls. Entries merge by id; the
  same entry changed on two machines merges as revisions (the marker model built for
  decisions in #35/#36 — a strict-prefix marker list is an older revision). A genuine
  conflict is REPORTED, never overwritten.
- Planner guidance: the natural shape is the store directory being a plain git repo
  (commit locally, fetch/merge/push when reachable); one-file-per-entry (D6) makes merges
  of different entries conflict-free. Unreachable ≠ "no remote" (ADR-043): never treat a
  failed fetch as an empty remote.

### D3 — Data model
- `kind`: principle | pattern | preference | antipattern (fixed enum).
- `strength`: rule | default — separate from kind ("always pnpm" is a preference that is
  a rule). Rules will be handed to agents in full (phase 25); defaults only when in scope.
- `scopes`, three structured dimensions (empty = applies everywhere):
  - `stack`: free tags, normalised lowercase (go, react, postgres);
  - `files`: globs (`**/*.test.*`, `migrations/**`);
  - `work`: fixed set — plan, code, test, review, git, ui, data, docs, ops.
- `statement` (one line — this is what the phase-25 index shows) and `why` (prose).
- `source`/evidence: pointers (session id, project, timestamp, or the ADR/phase it came
  from) + a SHORT excerpt passed through a secret redactor (tokens, keys, credentialed
  URLs). Never whole transcripts.
- `status` lifecycle: proposed → accepted | rejected (reason REQUIRED) ; accepted →
  retired (reason) | superseded (by id). Rejected entries are KEPT — they are what stops a
  later proposal repeating them (dedupe itself is phase 24).
- Promotions recorded on the entry (project + ADR id / "convention"), possibly several.

### D4 — Ids are dated slugs
`2026-09-24-never-mock-the-database`, like backlog items and fixes (ADR-013 precedent):
created offline on any machine with nothing to coordinate and no renumbering — ever (the
#45 lesson: a reissued id silently re-points citations). Commands accept any unique
prefix.

### D5 — Editing: edit on accept, amend after
- `accept --edit` (reword before it counts; proposals are often 80% right).
- After acceptance: `amend --reason` keeps id, records history; a real change of mind is
  `supersede --by <id>`. Same model as `ac decision amend/supersede`.
- Human data is authoritative (forge brain, low-confidence, adopted): anything that
  re-proposes (phases 23/26) may refresh still-PROPOSED entries only, never touch an
  accepted, rejected or edited one.

### D6 — Layout: one Markdown file per entry
`principles/<id>.md`: a small FIXED header (kind, strength, status, scopes, source,
promotions, history) then the statement and the why as prose. Reads well in the private
repo on GitHub; diffs show exactly what changed. Still written ONLY through lib helpers
(ADR-004: CLI-owned, lock-guarded). The header is a simple fixed format parsed by hand —
no YAML dependency. A damaged entry is refused, never read as absent (the strict-reader
rule from debt/backlog).

### D7 — Manual add is accepted directly
`ac principles add "<statement>" --kind … [--strength …] [--why …] [--stack/--files/--work …]`
→ status accepted (the user wrote it). `add --propose` queues it instead. The review queue
exists for what the MACHINE proposes.

### D8 — Promote into project canon; the entry stays personal
`ac principles promote <id> [--as decision|convention]` (default decision):
- decision → recorded via the existing `ac decision add` path (shared at once);
- convention → appended to the project's CONVENTIONS.md locally; print the
  `ac canon push` that publishes it (refuse-first, no implicit publish).
- The personal entry stays accepted (it still applies in other projects) and records the
  promotion. Project canon beats personal preference; a conflict is flagged, never
  silently resolved (detection itself lands with retrieval, phase 25).

## Scope of phase 22
IN: the store + lifecycle + sync (D1–D6), and the CLI:
`ac principles add | list [--proposed|--accepted|--rejected|--all] | show | accept [--edit]
| reject --reason | retire --reason | supersede --by | amend --reason | promote | remote`.
Flags validated per verb (ADR-029 allowlist). Tests with an isolated store dir and a local
bare repo as the remote (two "machines" sharing it, like the canon two-dev tests).
OUT: automatic proposing (23), the batch review command and dedupe (24), injection into
prompts / `ask` / conflict detection with canon (25), transcript mining (26), forge (27).

## Open for the planner
- Exact command/flag names within the surface above; `--edit` mechanics (an $EDITOR
  round-trip vs flags).
- The redaction patterns for excerpts (reuse/extend anything already in the codebase).
- How `list` renders (compact one-line-per-entry is the phase-25 index shape — reuse it).
