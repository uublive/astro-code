# Phase 11 — Standardize kit command naming

**Goal:** rename the kit commands onto the `astro-kit-<verb>` convention (ADR-023), hard
rename with no aliases, and fix every cross-reference — so the kit surface reads as one
coherent family and nothing references a dead name.

## Design notes
- Convention (ADR-023): `astro-kit-new`, `astro-kit-publish` (and the Phase-12 converter
  will be `astro-kit-convert`). Hard rename — delete the old files, no alias stubs.
- Use `git mv` so history follows the file.
- The installer keys off `commands/*.md` filenames, so a rename is transparent to
  copy/symlink — but `ac uninstall`/`install` only manage links they own; stale
  old-name symlinks under `~/.astro/code/commands` and the linked config dirs must be
  cleared so C4 holds.
- Gap found while grounding: `astro-publish-kit` was never listed in `/astro-help` or
  `README.md`. Standardizing the family = document `astro-kit-publish` there too, not
  just rename `new-kit`.

## Tasks

### t1 — Rename the two kit command files and fix in-file references
- **files:** `commands/astro-new-kit.md` → `commands/astro-kit-new.md`,
  `commands/astro-publish-kit.md` → `commands/astro-kit-publish.md`
- **depends_on:** []
- `git mv` each. In `astro-kit-new.md`: the body line "Once it's green,
  `/astro-publish-kit` packages it…" → `/astro-kit-publish`. Leave `description:`
  frontmatter wording intact except where it names the command. Scan both bodies for any
  other `/astro-new-kit` or `/astro-publish-kit` self/sibling mention and update.

### t2 — Update all cross-references to the new names (and close the doc gap)
- **files:** `commands/astro-help.md`, `README.md`, `templates/kit/KIT-CONTRACT.md`,
  `lib/install.mjs`, `tests/install.test.mjs`
- **depends_on:** []
- `astro-help.md:38`: `/astro-new-kit` → `/astro-kit-new`; add a sibling line for
  `/astro-kit-publish` — publish a kit to a hosted Astro instance.
- `README.md:55`: `/astro-new-kit` → `/astro-kit-new`; add a `/astro-kit-publish` row in
  the same list/style.
- `KIT-CONTRACT.md:101`: `/astro-publish-kit` → `/astro-kit-publish`.
- `lib/install.mjs:236` comment: `/astro-new-kit` → `/astro-kit-new`.
- `tests/install.test.mjs:34` comment: `/astro-new-kit` → `/astro-kit-new`. If the test
  asserts a specific command filename set, update it to the renamed files.

### t3 — Re-install, clear orphaned old-name links, and run the suite
- **files:** (no source file — verification/cleanup step)
- **depends_on:** [t1, t2]
- `node bin/ac.mjs install`; confirm it exits 0 and `~/.astro/code/commands` holds
  `astro-kit-new.md` + `astro-kit-publish.md`. Remove any stale `astro-new-kit.md` /
  `astro-publish-kit.md` copies under `~/.astro/code/commands` and dangling symlinks of
  those names in the linked config dirs (they are not auto-pruned on rename).
- `node --test` — all green.
- Final `grep -rn "astro-new-kit\|astro-publish-kit"` over the repo (excluding `.git`,
  `node_modules`, `.astrocode/milestones`, and this phase's own docs) returns nothing.

## Order
t1 and t2 are file-disjoint and independent; t3 gates on both. Executing inline &
sequentially (t1 → t2 → t3) is fine — this is a small mechanical phase.
