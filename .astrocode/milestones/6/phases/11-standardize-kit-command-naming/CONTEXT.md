<!-- astro-discuss: captured -->
# Phase 11 — Standardize kit command naming

## Goal
Bring every kit command onto one consistent naming convention so the kit surface reads
as a coherent family, and update all cross-references.

## Decisions (settled with the developer)
- **Convention: `astro-kit-<verb>`** (namespace prefix). Rename:
  - `astro-new-kit` → `astro-kit-new`
  - `astro-publish-kit` → `astro-kit-publish`
  - The Phase 12 converter is born as `astro-kit-convert` (not built here).
  Rationale: groups all kit commands together in the slash-command list and reads as a
  family; scales as more kit commands are added.
- **Hard rename, no aliases.** Delete the old command files outright — do NOT keep
  deprecated stubs or duplicate commands. The commands are new and lightly used, so the
  clutter/drift of aliases isn't worth it.

## Scope
In:
- `git mv commands/astro-new-kit.md → commands/astro-kit-new.md` and
  `commands/astro-publish-kit.md → commands/astro-kit-publish.md` (preserve history).
- Update the `description:` frontmatter and any self-references inside those files to the
  new names.
- Update every cross-reference to the old names: `README.md`, `commands/astro-help.md`,
  `templates/kit/KIT-CONTRACT.md`, the comment in `lib/install.mjs`, and
  `tests/install.test.mjs`.
- Confirm the installer picks the renamed files up (it copies/symlinks `commands/*.md`
  by filename — a rename is transparent, but stale symlinks under `~/.astro` for the old
  names must not linger; `ac install` re-links, and `ac uninstall` only removes links it
  owns — verify no orphaned `astro-new-kit`/`astro-publish-kit` links remain).

Out:
- The converter command itself (Phase 12).
- Any `ac kit` CLI surface — standardization here is naming only, per the developer.
- Back-compat aliases of any kind.

## Verification
- `commands/` contains `astro-kit-new.md` + `astro-kit-publish.md` and NO
  `astro-new-kit.md` / `astro-publish-kit.md`.
- `grep -rn "astro-new-kit\|astro-publish-kit"` across the repo (excluding `.git`,
  `node_modules`, and archived phase docs) returns nothing.
- `ac install` runs clean and the two renamed commands appear; no dangling old-name
  symlinks under the config dirs.
- `node --test` passes (install test updated).
