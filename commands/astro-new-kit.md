---
description: Start a new Astro kit as a standalone astro-code project — scaffold the full kit anatomy (manifest v4, recipe, EXAMPLES, build tooling), then develop it through the normal loop
argument-hint: [kit id (kebab-case)]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion
---

You are starting a new **Astro kit** — a self-contained capability pack for the Astro
agent (Claude commands, recipe, reference docs, schemas, report generators, packaged
as `dist/kit.zip` with a manifest v4 `kit.json`). The kit is developed as a
**standalone astro-code project**: it gets its own `.astrocode/`, milestone and
phases, and the normal `/astro-discuss` → `/astro-plan` → `/astro-execute` →
`/astro-verify` loop builds it. It is NOT imported into an AstroKit registry checkout
— it must end 100% registry-ready on its own (valid manifest, built zip + sha256,
ready-to-paste `registry-entry.json`).

The scaffold source of truth is `$(ac path templates)/kit/` — referred to as
`$KIT_TPL` below.

1. **Preflight.** If `.astrocode/` already exists here, tell the user and stop. Decide
   the kit root: if the cwd is empty (or holds only `.git`), scaffold **in place**;
   otherwise create `./<kit-id>/` and scaffold there — and at the end tell the user to
   reopen their session in that directory, since the whole loop must run with the kit
   as project root. `git init` if the kit root isn't a git repo. Derive `<kit-id>`
   from `$ARGUMENTS` (kebab-case: lowercase, digits, hyphens); if absent, use the
   directory name, and confirm it with the user if it isn't already kebab-case.

2. **Kit interview.** Briefly interview the user — use `AskUserQuestion` only for
   genuine forks, free text for the rest. You need:
   - **display name** and one-line **description** (what the kit lets Astro do,
     end-to-end);
   - **category** — one of: security, compliance, quality, performance,
     documentation, infrastructure, data, testing, operations;
   - **triggers** — the natural-language phrases a user would say to invoke it;
   - **deliverables** — the artifacts the kit produces, and which **single one** (or
     none) is the email deliverable (`email_attachment` tag);
   - **tool dependencies** known up front (apt/pip/npm/url — exact version pins), the
     runtime (usually `python3`), and **estimated duration**;
   - anything domain-specific the kit needs (reference data, external services,
     models).

3. **Scaffold.** Copy the template tree and fill every `{{PLACEHOLDER}}` from the
   interview (author from `git config user.name`); drop the `.tmpl` suffix:
   - `$KIT_TPL/kit.json.tmpl` → `kit.json`; `$KIT_TPL/registry-entry.json.tmpl` →
     `registry-entry.json` (fill triggers/tags/category; keep `download_url` as the
     TODO placeholder — there is no registry yet); `$KIT_TPL/gitignore.tmpl` →
     `.gitignore`; `$KIT_TPL/KIT-CONTRACT.md` → `KIT-CONTRACT.md` (verbatim).
   - `$KIT_TPL/src/*.tmpl` → `src/` (`CLAUDE.md`, `README.md`, `EXAMPLES.md`,
     `generate_report.py`, `recipes/recipe.yaml.tmpl` → `recipes/<kit-id>.yaml`).
     Fill what the interview settled; leave the guidance comments where phases will
     flesh things out. Create empty `src/scripts/`, `src/reference/`, `src/schemas/`
     (with `.gitkeep`).
   - `$KIT_TPL/tools/` → `tools/` **verbatim** (build_kit.sh, _zip_src.py,
     publish_kit.py, validate_manifest.py, _schema_engine.py, schemas/).
     `chmod +x tools/build_kit.sh`.
   - Sanity-check the scaffold now: `python3 tools/validate_manifest.py kit.json`
     must exit 0. Fix before continuing.

4. **Init the project.** Run `ac init --name "<kit-id>"`. Write
   `.astrocode/PROJECT.md`: **vision** = what the kit lets Astro do end-to-end and
   for whom; **requirements** (stable `REQ-001` ids) = the kit's functional promises
   PLUS the kit contract as explicit requirements (valid manifest v4; recipe present
   and consistent; EXAMPLES.md complete; `./tools/build_kit.sh` green; declared
   artifacts actually produced); **constraints** from the interview.

5. **Seed the canon.** Write `.astrocode/CONVENTIONS.md` from `KIT-CONTRACT.md`: the
   manifest v4 rules (exact pins, base-image allowlist, 0-or-1 `email_attachment`),
   the recipe phase style (`goal`/`constraints`/`input`/`output`, runtime output
   under `_report/`, resumable state in `_report/state.json`), EXAMPLES.md required
   sections, and "deliverables come from scripts, never hand-made". This canon is
   injected into every planning/execution agent — it is how the kit contract travels
   through the whole loop. Record notable up-front choices with `ac decision add`,
   and `ac canon push` if a remote exists.

6. **Registry init.** Run `ac registry init`. It needs an `origin` remote — if there
   isn't one, tell the user to add it (`git remote add origin <url>`) and run
   `ac registry init` before the first `ac phase add` (phase claims fail fast until
   then).

7. **Propose phases.** Propose an initial milestone sized to the kit — the default
   shape, collapsing for small kits:
   1. *Recipe & core workflow* — the real `recipes/<kit-id>.yaml` phases +
      `src/CLAUDE.md` instructions;
   2. *Scripts, schemas & reference data* — generators under `src/scripts/`, output
      schemas, reference JSON;
   3. *Examples, docs & packaging* — complete `EXAMPLES.md` + `README.md`, finalize
      `kit.json`/`registry-entry.json`, `./tools/build_kit.sh` green, zip committed.
   Confirm with the user, then create each with `ac phase add "<name>"`.

8. Show `ac status` and point to `/astro-discuss 1` (then `/astro-plan 1`) — always
   reference phases by **number**. If the kit was scaffolded into a subdirectory,
   remind the user to reopen the session there first.

Keep PROJECT.md tight. The kit is DONE when the "Build & definition of done" list in
`KIT-CONTRACT.md` fully holds. Once it's green, `/astro-publish-kit` packages it
(src/ + `kit.json` inside the zip) and uploads it to a running Astro instance's
hosted kit registry.
