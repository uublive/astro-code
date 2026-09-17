# Success Criteria — Phase 11: Standardize kit command naming

> Pre-registered, goal-derived. Derived from the phase goal + CONTEXT.md (ADR-023: kit
> commands use the `astro-kit-<verb>` convention; hard rename, no aliases). Each
> criterion is an observable outcome any valid implementation must satisfy.
>
> Shorthand: `REPO = /Users/buu/Development/astro-code`; "user-facing text" excludes
> `.git/`, `node_modules/`, and archived phase docs under `.astrocode/milestones/`.

### C1 — Every kit command is exposed under the `astro-kit-<verb>` convention
- **Observe:** In `REPO/commands/`, the kit commands are `astro-kit-new.md` and
  `astro-kit-publish.md`, each with a valid slash-command frontmatter (`description:`)
  and body that reads as the same command as before the rename (scaffold a kit / publish
  a kit). No kit command uses the old `astro-<verb>-kit` form.
- **Fails if:** either renamed command is missing; a kit command still uses the suffix
  form; a renamed file lost its frontmatter or its body no longer matches its purpose.

### C2 — The old command names are fully retired (hard rename, no aliases)
- **Observe:** `commands/astro-new-kit.md` and `commands/astro-publish-kit.md` do not
  exist. `grep -rn "astro-new-kit\|astro-publish-kit"` across user-facing text returns
  nothing — no alias stub, no lingering reference in README, `/astro-help`,
  KIT-CONTRACT, installer comments, or tests.
- **Fails if:** an old-name file remains (even as a deprecation stub); any user-facing
  reference to an old name survives.

### C3 — Every cross-reference points at the new names and stays accurate
- **Observe:** The places that previously named the kit commands — `README.md`,
  `commands/astro-help.md`, `templates/kit/KIT-CONTRACT.md`, `commands/astro-kit-new.md`
  (self/sibling references), and the `lib/install.mjs` comment — now name
  `astro-kit-new` / `astro-kit-publish`, and each reference is still true in context
  (e.g. help still lists the kit commands; KIT-CONTRACT's publish note points at the new
  publish command).
- **Fails if:** any doc/help/comment still shows an old name, or a reference was changed
  to a name that doesn't exist.

### C4 — Installing produces a clean surface with no orphaned old-name entries
- **Observe:** `node REPO/bin/ac.mjs install` exits 0. Afterwards, each populated config
  dir exposes `astro-kit-new` and `astro-kit-publish`, and there is NO
  `astro-new-kit`/`astro-publish-kit` command or dangling symlink left behind under
  `~/.astro/code/commands` or the linked config dirs.
- **Fails if:** install errors; the new commands aren't present after install; a stale
  old-name file or dangling symlink remains.

### C5 — The suite passes with the rename reflected
- **Observe:** `node --test` in `REPO` passes, including the install test, which now
  asserts the renamed command set (not the old names).
- **Fails if:** any test fails, or a test still asserts an old kit-command name.
