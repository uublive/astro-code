<!-- astro-discuss: captured -->
# Phase 53 — Registry-claimed ADR numbers for a project's own ADR store

## Why
Astrobot report (REPORT.md in this folder): ADR numbers in the project's own ADR folder
(`docs/adr/NNNN-*.md`) are picked by agents as "highest on my branch + 1", so branches collide —
0096, 0097, 0099, 0102, 0103 each taken twice in three days, each renumber a hand rewrite of
references. Checked in session: astro-code's `.astrocode/DECISIONS.md` numbering is already
coordinated (`ac decision add` builds the entry inside the registry transact), but astro-code does
not manage a project's ADR folder at all. Astrobot also has TWO overlapping series: DECISIONS.md
`ADR-001…068` (registry) and `docs/adr` `0001…0103` (hand-written), different decisions under the
same numbers; DECISIONS.md even carries a copied `ADR-0103` heading and cites "ADR-103" meaning
docs/adr/0103.

## Goal
In any astro-code project, every ADR number has exactly one meaning: one registry-claimed series
across the decision log and the project's ADR folder, a guard that stops unclaimed numbers at write
time and reports any that slip through, and a migration that fixes the existing overlaps.

## Decisions (Matteo, in this session)

D1 — **One series, both stores.** One registry-claimed number per decision. `ac decision add`
claims it (through the existing registry mechanism), writes the DECISIONS.md entry AND, when the
project has an ADR folder, `<adr_dir>/<NNNN>-<slug>.md` with the same number. "ADR-0104" then means
one thing everywhere. Planner/executor workflows and agent instructions must use the claim — never
compute "max + 1" or write an ADR file by hand.

D2 — **Guard at write time, plus reports.** The canon-guard mod (when on) refuses writing an ADR file
or an `ADR-NNNN` heading whose number is not claimed in the registry. `ac doctor` and
`ac canon check` report any that slipped through, including two different ADRs sharing one number.

D3 — **Backfill: claim + guided renumber.** At upgrade, claim every number already on the default
branch so new claims start above them. Each duplicate is reported, and
`ac decision renumber <file|id> <new>` moves ONE decision to a fresh claimed number and rewrites its
references across the project in one step, listing every file it touched.

D4 — **Migration: freeze history, unify forward.** Nothing old is renumbered except one relabel:
the old decision-log series (Astrobot's DECISIONS.md `ADR-001…068`) becomes `D-001…D-068`, with
references to them rewritten in that single pass, so `ADR-0xx` never means two things. The next
claim is above every existing number in both stores (Astrobot: 0104), one series from then on.

D5 — **Renumber attribution by branch.** `ac decision renumber` rewrites the references in lines the
moving decision's own branch added (git blame against the merge base); the other side's references
stay. Anything it cannot attribute is listed for a human, never guessed.

D6 — **Enabled by detection, with a setting.** A project with an ADR folder (`docs/adr`, `adr`,
`doc/adr`) of `NNNN-*.md` files is detected; `ac config set decisions.adr_dir <path>` overrides or
turns it off. Number width (3 or 4 digits) and the folder are read from the project's existing files
(principle 1f10: detect from the project's own files, allow an override, report which). Projects
without an ADR folder keep today's DECISIONS.md-only behaviour.

D7 — **`ac doctor` checks ADR consistency** (Matteo, added at capture): the doctor reports ADR files
or headings not in the correct claimed format — an unclaimed number, a duplicate number, an old-series
`ADR-0xx` that should be `D-0xx` after migration, a file whose number and DECISIONS.md entry disagree —
each with its fix command (phase 50's report-only shape).

## Scope
In: claim + write in `ac decision add`; the canon-guard rule; doctor + canon check reports; upgrade
backfill; `ac decision renumber`; the one-time D-series relabel; detection + config; workflow/agent
text that tells planners/executors to claim; MANUAL, CHANGELOG, tests (real bare remote, two working
copies on separate branches reproducing the Astrobot collision).

Out: changing astro-code's own DECISIONS.md format (it has no ADR folder: unchanged behaviour);
name-based ids; fixing Astrobot's repo itself (done afterwards with the new tools, on its branch).

## Open / for the planner
- Whether the claim reuses the shared DECISIONS.md CAS (the number IS the entry) or adds `adr`
  claims to registry.json — either must keep one series across both stores.
- The relabel's detection: which entries are the "old log series" (numbers that collide with an ADR
  file of a different decision) vs entries mirroring an ADR file (keep the file's number).
- git-blame attribution when the moving decision's branch was already merged/squashed.
