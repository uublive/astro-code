<!-- astro-discuss: captured -->
# Phase 12 — Kit conversion command (source → standard kit)

## Goal
Add `astro-kit-convert`: take an existing **non-kit** implementation — a standalone
script/repo or an existing tool/service — and reproduce its capability as a standard
Astro kit at **verified feature parity** with the original.

## Decisions (settled with the developer, two rounds)

1. **Command name: `astro-kit-convert`** (ADR-023 convention).

2. **Output = a standalone kit project, driven by the loop.** Convert **reuses the
   `astro-kit-new` scaffold** (same `templates/kit/` tree + vendored `tools/`, one source
   of truth — do NOT fork scaffolding), then ports the source's logic into it and seeds
   `.astrocode/` phases so the normal discuss→plan→execute→verify loop drives it to full
   parity. Convert sets up the kit + the parity bar; the loop closes the gap. It does NOT
   have to fully implement parity in one shot (mirrors how `astro-kit-new` hands off).

3. **Parity is proven by a parity contract from the source's REAL outputs.** Capture
   representative inputs → the original's actual outputs as **golden fixtures**, then the
   kit's verification asserts the kit reproduces **equivalent** outputs. Parity becomes
   falsifiable CRITERIA the verifier checks — not a human "looks right". Equivalence must
   tolerate benign nondeterminism (timestamps, run ids, ordering) — normalize before diff.

4. **Fixtures: run the source to capture, else user-supplied.** Try to run the original
   on representative inputs in this environment (or via the host bridge per the global
   CLAUDE.md rules) and record real outputs as fixtures. If it can't run here, the user
   supplies sample input→output pairs and those fixtures are marked **user-attested**.
   Fixtures live with the kit (e.g. under the kit's parity check + EXAMPLES).

5. **Auto-derive from the source; interview only gaps.** Extract everything inferable —
   kit id (repo/dir name), description (README/docstrings), tool deps
   (requirements.txt / package.json / imports → exact pins per the kit contract), runtime,
   entrypoints → recipe phases, produced files → `outputs.artifacts`. Interview only for
   what's missing and **which single deliverable is the `email_attachment`** (0-or-1).

6. **Capability scope: propose a map, the user confirms.** Convert extracts what the
   source does, proposes the capability map, and the user confirms/selects. **A kit = one
   coherent capability.** If the source spans several unrelated things, pick the primary
   (or split into separate kits) rather than cramming a grab-bag into one.

7. **Source scope: extract the core capability, flag the rest.** Reproduce the core task
   as a **self-contained** kit (python3 runtime + exact-pinned tool deps, base-image
   allowlist respected). Infra, network-only pieces, secrets, and anything that can't be
   made self-contained are **flagged as explicit manual follow-up REQs/notes** — never
   silently dropped, never wired in as a hidden external dependency.

## Scope
In:
- `commands/astro-kit-convert.md` — the command spec (argument-hint: source path).
- Reuse of the `astro-kit-new` scaffold + `templates/kit/` (shared, not duplicated).
- A **parity harness** shipped with the converted kit: golden fixtures + a parity-check
  step that runs the kit and compares normalized outputs to the fixtures, exit non-zero
  on mismatch. Prefer a small stdlib-only tool under the kit's `tools/` (consistent with
  `build_kit.sh` / `publish_kit.py`) so every converted kit can self-check parity.
- Seeding `.astrocode/` for the new kit project: PROJECT.md (vision = parity with the
  named source; requirements = the source's capabilities as REQs + the kit contract +
  parity REQs + flagged non-self-contained items), CONVENTIONS from KIT-CONTRACT, and an
  initial milestone/phases to reach parity.
- Docs: list `astro-kit-convert` in `/astro-help` + README alongside the other kit
  commands.

Out:
- A generic "run any tool" adapter — convert targets script/repo/tool sources whose core
  capability can be reproduced with python3 + pinned deps.
- Fully automated parity for sources that can't run here — those degrade to user-attested
  fixtures, clearly labeled.
- Any `ac kit` CLI surface (standardization stays naming-only, per Phase 11).

## Open questions / assumptions
- **Host bridge for capture:** running the source may need the host (`host <cmd>`) per
  global CLAUDE.md; capture must mention every host command it runs and never touch the
  astro-forge stack. If neither local nor host run works, fall back to user-attested.
- **Where the converted kit lands:** default to a sibling `./<kit-id>/` project (like
  `astro-kit-new`'s subdir path) so the source repo is left intact; confirm at runtime.
- **Nondeterminism policy:** the parity check needs a declared normalization list
  (timestamps, temp paths, ordering); the command should surface fields it normalized so
  parity isn't silently loosened.

## Verification (parity-first)
The phase's own CRITERIA (authored plan-blind next) should assert, behaviorally:
- Given a real sample source, `astro-kit-convert` yields a **valid** kit
  (`validate_manifest.py` green, `build_kit.sh` green) that is self-contained.
- The kit **reproduces the source's captured outputs** on the fixture inputs (parity
  check passes), with normalization limited to declared benign fields.
- Capabilities the converter could NOT make self-contained are surfaced as explicit
  flagged follow-ups, not dropped.
- Auto-derived manifest fields match the source (deps from requirements/imports, outputs
  from produced files), with the interview limited to genuine gaps + the email_attachment.
