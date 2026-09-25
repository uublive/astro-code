# Handover to forge — cut-over to astro-code's personal principle store

For a forge maintainer with no astro-code context. astro-code now has its own personal
principle store (`~/.astro/principles/`), an import path that reads a forge export
(`/astro-forge-import`, interim, paging the live graph today), and a versioned read
contract. This document is the four remaining pieces of work — all on the forge side, none
of them touch the astro-code repository, and nothing in it has been filed anywhere outside
this repo; where to file it (astro-context, ClickUp, …) is a separate question, asked of
the user directly rather than assumed here.

Do these in order — task 4 is explicitly gated on task 1's output actually working, not on
elapsed time or a release train.

## Why

Forge's principle-graph nodes (Principle/Pattern/AntiPattern/Preference, their linked
Signal evidence, an approval queue, a low-confidence flag) duplicate what astro-code's own
store now does natively, with astro-code's own capture, review and retrieval already
landed (phases 22–26). Once forge's graph is imported once and astro-code can read forge's
future principles the other way round, forge no longer needs to run its own copy of this
system.

## Task 1 — Ship the export verb

**What:** a forge command/verb that emits a file shaped EXACTLY like
`templates/FORGE-EXPORT.md` v1 (installed copy: `~/.astro/code/templates/FORGE-EXPORT.md`)
— by reference to that document, never redefined here. It must include everything the
interim `/astro-forge-import` command currently cannot see through forge's read-only MCP
surface: each node's real `approved`/`pending`/`rejected`/`superseded` status (with a
rejection's own reason, and a superseded node's `superseded_by` target), its
`confidence`, and every linked Signal (`text`, `source`, `at`) — sent UNREDACTED (the
importer redacts and caps on its own side, identically to astro-code's own native
capture — pre-redacting on forge's side would just hide a shape astro-code's redactor
would otherwise catch).

**Done when:** running the verb against forge's live graph produces a file that
`parseForgeExport` (astro-code's `lib/principleimport.mjs`) accepts without modification,
and every node in forge's graph — including rejected and superseded ones, which the
interim command cannot currently reach — appears in it.

## Task 2 — Read astro-code's store back

**What:** a read path over `templates/PRINCIPLES-CONTRACT.md` v1 (installed copy:
`~/.astro/code/templates/PRINCIPLES-CONTRACT.md`) — by reference, never redefined here.
Two deployment shapes, both real:
- **Same container as the agent sessions** (the current deployment, verified while
  planning this phase): read `~/.astro/principles/*.md` directly, on disk, exactly as the
  contract describes — fixed header order, the JSON record shapes, `status === "accepted"`
  governs.
- **Any other machine:** the user's own private git remote for that store
  (`ac principles remote` on the astro-code side sets it up) — clone or pull it, then read
  the same on-disk format.

**Done when:** forge can list every `accepted` principle from a real store (either
deployment shape) using only the contract document, with no write access requested or
used against that store — the contract's own read-only rule (section 3) applies to forge
exactly like any other consumer.

## Task 3 — Turn off forge's own capture

**What:** retire forge's principle-capture path — the miner that watches for new
principles and the approval queue it stages them into — now that astro-code's own capture
(phases 23/26) and review (`/astro-review`) cover the same ground natively. Forge should
stop writing NEW principle graph nodes entirely once this lands; existing nodes stay in
place until task 4.

**Done when:** forge's capture/miner and its approval queue no longer run, and no new
principle graph node is created by forge after this ships.

## Task 4 — Retire the forge graph's generator nodes

**What:** delete (or otherwise decommission) the Principle/Pattern/AntiPattern/Preference
generator nodes and their linked Signals from forge's graph — the data has a new home.

**Done when, and NOT BEFORE:** task 1's exporter has been run once for real and the
resulting file has been verified to import cleanly — first into a SCRATCH astro-code
store (`ASTRO_PRINCIPLES_DIR` pointed at an empty temp dir, `ac principles import
--from-forge <file>` exits 0, the resulting entry count equals the exported node count,
and a spot-check of a handful of entries' statuses matches what forge reported for them),
and only then into the real store the user actually uses. Task 4 is gated on that
verification succeeding, not on tasks 1–3 simply having shipped — retiring the graph
before a working import exists would be a one-way data loss with nothing to recover from.

## Filing

Nothing in this document has been filed anywhere outside this repo (D6) — no astro-context
entry, no ClickUp task, nothing posted automatically. Where this work should actually be
tracked (astro-context, ClickUp, a forge-side issue tracker, or nowhere beyond this file)
is the user's call; ask them directly once this phase lands, rather than assuming a
destination.
