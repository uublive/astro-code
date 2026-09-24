<!-- astro-discuss: captured -->
# Phase 27 — Forge import and handover: context

Milestone 9 "Second Nature" (PROJECT.md: bring forge's personal-knowledge layer into
astro-code so it works standalone/open source, "after which forge's version is retired").
Builds on phases 22 (store, ADR-057/058/059), 23 (capture; forge WRITES from astro-code
removed), 24 (dedupe + sightings + /astro-review), 25 (retrieval; forge READS removed,
`templates/forge-knowledge.md` left as a stub pointing here), 26 (miner).

Forge graph as seen via its MCP (`forge_knowledge_list`): generator nodes of type
Principle / Pattern / AntiPattern / Preference (slug, name, statement), linked Signal
nodes carrying the evidence (the user's words / what happened), soft-retired (superseded)
nodes, a low-confidence flag, and an approval queue (forge_capture_knowledge stages to it).
No scopes. Deployment fact (verified 2026-09-24): forge's server `astroforged` runs in the
SAME container as the agent sessions, as the same user; `~/.astro` → `/data/.astro`
(persistent volume). The live store `~/.astro/principles/` is already shared by every
session in the container (it already holds real proposals from other projects).
This session could not read the astro-forge repo (lean-ctx project-root restriction) —
forge internals must come from its export/MCP, not assumptions.

## Decisions

### D1 — Status mirrors forge's human decisions
- Forge-approved → `accepted`; still pending in forge's queue → `proposed` (reviewed via
  /astro-review); forge-rejected → `rejected` (reason kept where forge has one; otherwise a
  fixed reason like "rejected in forge"). Forge-superseded → `superseded`/`retired` as fits.
- Nothing becomes accepted that the user never approved (ADR-058). Kind maps 1:1
  (AntiPattern → antipattern). Low-confidence + unapproved stays `proposed`.
- History records the import (e.g. an `imported` action with forge slug) — the entry says
  where it came from.

### D2 — Evidence: Signals → sightings/source; scopes empty, suggestions reviewable
- Each linked Signal becomes redacted evidence on its entry (source excerpt / phase-24
  sightings). Forge has no scopes → entries import with empty scopes (apply everywhere).
- The importer may produce scope SUGGESTIONS as a reviewable batch (e.g. via review /
  `amend`), never written onto entries unreviewed.

### D3 — Source: an export file, not MCP or nanograph
- `ac principles import --from-forge <file>` (name: planner) reads a JSON/JSONL export.
  Zero-dep, fixture-tested; `ac` has no MCP/nanograph coupling.
- The export format is DEFINED here (documented schema astro-code accepts); forge producing
  it is a forge-side task (D6). Interim: a slash command may build the same file by paging
  `forge_knowledge_list` (+ Signals) so the import is usable before forge ships an exporter.

### D4 — Idempotent, re-runnable
- Keyed by forge slug recorded in the entry's source. Re-run: new forge nodes are added;
  known ones get sightings via phase-24 dedupe; accepted / edited / rejected entries are never
  overwritten (ADR-058). Safe on any machine, until forge stops producing.
- Dedupe also applies against entries that did NOT come from forge (a principle already
  captured natively should gain a sighting, not a twin).

### D5 — Forge reads astro-code: on-disk, read-only; forge stops capturing
- Forge reads `~/.astro/principles/` directly (same container, same user, D-context fact);
  machines outside the container use the phase-22 git remote as usual.
- Forge is a READER only: never writes files in the store. Forge STOPS capturing entirely —
  its miner and its approval queue retire; astro-code's moments (23) and miner (26) are the
  only sources. (User chose this over "forge proposes via ac".)
- astro-code ships a stable, versioned READ CONTRACT: the on-disk entry format (ADR-059) and/or
  `ac principles brief|ask|list --json` output, documented (e.g. a PRINCIPLES-CONTRACT.md,
  mirroring KIT-/RUN-CONTRACT) and pinned by tests so format changes are deliberate.

### D6 — This phase never edits astro-forge; handover work is filed
- Deliverable for forge: a forge-side task list written in this repo (and/or filed where the
  user tracks forge work — planner/command asks, never auto-posts externally): (1) export
  verb producing D3's format, (2) read path over the contract (D5), (3) turn off forge
  capture + approval queue, (4) retire the forge graph's generator nodes after import is verified.
- astro-code cleanup here: delete `templates/forge-knowledge.md` stub and any remaining forge
  references/tests in astro-code (phase 25 left a stub pointing at this phase).

### D7 — Done means
Phase accepted when: the graph is importable (fixture + a real export/interim file), reviewable
(proposed ones visible in /astro-review), the read contract is documented + tested, and the
forge-side task list exists. Forge's actual cut-over is verified when that task lands, not here.

## Scope
IN: export schema + importer (D1–D4), read contract doc + tests (D5), interim MCP-paging export
command (D3), forge-side task write-up (D6), removing astro-code's last forge references.
OUT: any edit to the astro-forge repo; forge's non-principle knowledge (entities, notes,
contacts); embeddings; auto-assigning scopes.

## Open for the planner
- Export schema (fields: slug, type, name, statement, why?, status/approval, confidence,
  superseded-by, signals[] {text, source, at}); mapping of forge's approval states (confirm via
  MCP/export what forge actually exposes — don't assume).
- The `imported` history action + source fields within ADR-059's fixed header order.
- Where the forge-side task list lives (a doc in this repo vs astro-context/ClickUp — ask before
  posting anywhere external).
- Interplay with phases 24–26 landing first: build on their merged state (matcher, sightings,
  review command).
