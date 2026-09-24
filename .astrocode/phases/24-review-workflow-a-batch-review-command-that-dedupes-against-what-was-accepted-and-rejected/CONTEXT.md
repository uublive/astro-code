<!-- astro-discuss: captured -->
# Phase 24 — Review workflow: context

Milestone 9 "Second Nature". Builds on phase 22's store (`lib/principles.mjs`,
`lib/principlemd.mjs`, `lib/principlesync.mjs`, `ac principles …`) and closes phase 23's
accepted known gap: until now a capture may re-propose something already accepted, already
proposed, or previously REJECTED. ADR-058 governs throughout: the machine only proposes;
re-proposing may refresh still-proposed entries only, never touch an accepted, rejected or
human-edited one; rejections are kept with their reason.

## Decisions

### D1 — Match rule: deterministic candidates, agent decides the fuzzy cases
- `ac`/lib normalises statements (case, punctuation, whitespace, dash variants) and finds
  candidates by keyword/token overlap — explainable ("matched on: pnpm, lockfile"), no
  embeddings (milestone rule), zero deps (REQ-001).
- EXACT-normalised match → handled mechanically, no agent needed.
- Overlap-only candidates → the capturing/reviewing agent makes the final same-or-different
  call. Nothing is auto-merged on similarity alone (the ADR-053 precedent: similarity-driven
  automatic merges were removed for destroying data).

### D2 — Dedupe runs at BOTH propose time and review time
- Propose time (the phase-23 capture path, `proposePrinciple` / `ac principles add --propose`):
  - match vs **rejected** → never re-queued; record a sighting (D3).
  - match vs **accepted** → not re-queued; record a sighting.
  - match vs **proposed** (not human-edited) → refresh / record sighting on it instead of a new entry.
  - The phase-23 capture spec (single source, `templates/…`) must tell the capturing agent to
    consult the candidates before proposing, so near-duplicates are caught at capture too.
- Review time: the review pass groups near-duplicate proposed entries and offers a merge (D6).

### D3 — A repeat is recorded as a sighting, never dropped silently
- Like `ac debt add` repeat sightings: the existing entry gains the new evidence
  (source/ref/project/session, redacted excerpt) and a sighting count.
- On accepted/rejected entries this ONLY appends evidence — never changes text, status or
  scopes (ADR-058). Recurrence becomes visible (input for milestone-close and for reopening).
- Must survive sync: two machines appending sightings to the same entry offline should merge
  like other same-entry changes in `principlesync` (planner: keep sightings append-only so
  they merge cleanly).

### D4 — Review surface: a slash command over plain `ac` verbs
- `/astro-review` walks the proposed queue in batches (~4 per round) via AskUserQuestion:
  accept / edit-then-accept / reject (reason required) / skip. Near-duplicates are shown grouped.
- Every decision it makes is an existing or new `ac principles` verb — the CLI stays the
  source of truth and a script can do the same thing. No readline/interactive mode in `ac`.
- Each item shows enough to decide: statement, why, kind/strength/scopes, source excerpt,
  sighting count, and any match against accepted/rejected entries.
- Output follows ADR-055: one line summary at the end (e.g. `reviewed 7 — 4 accepted, 2 rejected, 1 skipped`).

### D5 — Rejection is permanent against recapture, with a deliberate reopen
- A capture matching a rejected entry is never re-queued, only sighted.
- Review surfaces "rejected (reason), seen again N times" so the user can knowingly change
  their mind via a new verb (e.g. `ac principles reopen <id> --reason …`: rejected → proposed,
  history records it). Nothing reopens automatically.

### D6 — Merging duplicate proposals: keep one, fold evidence, delete nothing
- User picks (or edits) the survivor; the other becomes a terminal merged state
  (e.g. `merged` into `<id>`, or superseded-by) with its sources folded into the survivor
  as sightings. Ids stay citable; nothing is deleted.
- Do NOT reuse `reject` for duplicates — a rejection blocks recapture of that wording (D5),
  which a duplicate should not.

### D7 — Folded-in debt (in scope)
- `2026-09-24-accept-statement-edit-records-only-an` (lib/principles.mjs):
  `accept --statement/--edit` records only an `edited` history line, never an `accepted`
  one. Review's edit-then-accept path depends on this; fix so an edited acceptance records
  both the edit (with prior text) and the acceptance. Close the debt item on landing.

## Scope
IN: normalisation + candidate matching (lib, tested), propose-time dedupe with sightings,
sightings in the entry format + sync, `reopen`, merge-duplicates, `/astro-review` command,
update to the phase-23 capture spec to consult candidates, the D7 debt fix.
OUT: retrieval into prompts / `ac principles ask` / canon-conflict detection (25),
transcript mining (26), forge import (27), reviewing ACCEPTED entries for disuse (needs
phase 25's usage log).

## Open for the planner
- Overlap scoring and threshold; how candidates are exposed to agents (e.g. a
  `ac principles match "<statement>" [--json]` verb) — keep it explainable.
- Entry-format change for sightings (header key vs section) — must stay within ADR-059's
  fixed header order rules and parse strictly; old entries without sightings still read.
- Name of the merged state and verb (`merge <dup> --into <id>`?), `reopen` flags.
- Whether an exact match vs a proposed entry refreshes its text or only adds a sighting
  (ADR-058 permits refresh of non-edited proposed entries).
- Interplay with phase 23 landing concurrently: phase 23 is executing now; the plan must
  build on its capture spec file as merged, not assume its shape.
