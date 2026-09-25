# Handover to forge — cut-over to astro-code's personal principle store

For a forge maintainer with no astro-code context. astro-code now has its own personal
principle store (`~/.astro/principles/`) and a versioned read contract for it. Nothing is
carried over from forge's graph: the user chose to leave that data behind, so the store
starts from what astro-code itself captures (astro-code ADR-065). This document is the
three remaining pieces of work — all on the forge side, none of them touch the astro-code
repository, and nothing in it has been filed anywhere outside this repo; where to file it
(astro-context, ClickUp, …) is a separate question, asked of the user directly rather than
assumed here.

Do these in order. Task 3 is gated on tasks 1 and 2 both actually working, not on elapsed
time or a release train.

## Why

Forge's principle-graph nodes (Principle/Pattern/AntiPattern/Preference, their linked
Signal evidence, an approval queue, a low-confidence flag) duplicate what astro-code's own
store now does natively, with astro-code's own capture, review and retrieval already
landed (phases 22–26). Once forge reads astro-code's store instead of its own graph, forge
no longer needs to run its own copy of this system.

## Task 1 — Read astro-code's store back

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

## Task 2 — Turn off forge's own capture

**What:** retire forge's principle-capture path — the miner that watches for new
principles and the approval queue it stages them into — now that astro-code's own capture
(phases 23/26) and review (`/astro-principles-review`) cover the same ground natively. Forge should
stop writing NEW principle graph nodes entirely once this lands; existing nodes stay in
place until task 3.

**Done when:** forge's capture/miner and its approval queue no longer run, and no new
principle graph node is created by forge after this ships.

## Task 3 — Retire the forge graph's generator nodes

**What:** delete (or otherwise decommission) the Principle/Pattern/AntiPattern/Preference
generator nodes and their linked Signals from forge's graph. Their content is NOT moved
anywhere first — that is the user's decision, not an oversight — so this step discards it.

**Done when, and NOT BEFORE:** task 1's read path is live (forge lists the `accepted`
principles of the user's real store through the contract alone), task 2 has shipped (no
new principle node has been created by forge since), and the user has confirmed, at the
moment of retirement, that the old graph's contents may be discarded. Then the generator
nodes and their Signals are gone from forge's graph and nothing in forge reads or writes
them any more.

## Filing

Nothing in this document has been filed anywhere outside this repo (D6) — no astro-context
entry, no ClickUp task, nothing posted automatically. Where this work should actually be
tracked (astro-context, ClickUp, a forge-side issue tracker, or nowhere beyond this file)
is the user's call; ask them directly once this phase lands, rather than assuming a
destination.
