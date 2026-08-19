---
description: Convert an existing non-kit implementation (script/repo/tool/service) into a standard Astro kit at verified feature parity with the original
argument-hint: [source path]
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Grep, Glob, Agent
---

You are converting an existing **non-kit** implementation into a standard **Astro
kit** — same anatomy `astro-kit-new` produces (manifest v4, recipe, EXAMPLES, build
tooling), packaged as `dist/kit.zip` — but this time the kit's job is to **reproduce
the source's capability at verified feature parity**, proven against the source's
own real outputs rather than a human "looks right" (ADR-025). Convert reuses the
`astro-kit-new` scaffold (`templates/kit/` + vendored `tools/`, ONE source of truth
— never fork scaffolding, ADR-024) then ports the source's logic into it and seeds
`.astrocode/` so the normal discuss → plan → execute → verify loop closes any
remaining gap. Convert does not have to reach full parity in one shot.

The scaffold source of truth is `$(ac path templates)/kit/` — referred to as
`$KIT_TPL` below, exactly as in `astro-kit-new.md`.

1. **Map the source.** `$ARGUMENTS` is the source path (a repo, directory, or single
   script). Spawn the read-only **astro-mapper** agent against it — reuse the same
   mapping primitive `astro-adopt.md` uses, do not invent a second mapping pass.
   Get back: stack & entry points, architecture, conventions, state/data, risks.

2. **Propose the capability map; user confirms.** Ground the proposal in concrete
   entrypoints — `console_scripts`/`pyproject.toml`, `package.json` `bin`,
   `__main__.py`, argparse/click subcommands, a Dockerfile `ENTRYPOINT`, or OpenAPI
   operations for a service — README only as a fallback when no entrypoint is
   declared. **A kit = ONE coherent capability.** If the source spans several
   unrelated things, propose the primary one (or splitting into separate kits)
   rather than cramming a grab-bag into one kit. Default to a single-phase recipe
   unless the source has genuinely distinct stages. Confirm the map with the user
   via `AskUserQuestion` before deriving anything from it.

3. **Auto-derive the manifest; interview only genuine gaps.** Extract everything
   inferable from the source rather than asking:
   - **kit id** from the repo/dir name (kebab-case);
   - **description** from the README/docstrings;
   - **tool dependencies** resolved to **exact pins** — prefer a lockfile over a
     loose manifest (`requirements.txt`/`pyproject.toml` pins, `package.json` +
     lockfile), or record `pip freeze`/`npm ls --json` at fixture-capture time
     (step 6) so the pins match what actually produced the fixtures; filter out
     anything already on the kit base-image allowlist (`bash coreutils grep sed
     awk jq git curl wget tar unzip`) — those are never declared as tool deps;
   - **runtime**: `python3` (the kit-contract runtime);
   - **entrypoints → recipe phases**, one phase per confirmed stage from step 2;
   - **produced files → `outputs.artifacts`**, derived from what the source
     actually writes on a real run.
   Interview (`AskUserQuestion`, kept short) ONLY for what genuinely can't be
   derived: anything still ambiguous after steps 1–2, and **which single
   deliverable (0-or-1) is the `email_attachment`** — the kit contract never
   allows more than one.

4. **Prefer wrap over reimplement.** If the source is redistributable and can be
   pinned as a tool dependency, vendor it as a `requires.tools[]` entry plus a thin
   `python3` wrapper that invokes it — this is the lowest-drift path to parity.
   Fall back to a full reimplementation only when the source can't be pinned or
   redistributed that way (e.g. it needs to be inlined to stay self-contained).

5. **Scaffold via `$KIT_TPL`**, exactly as `astro-kit-new.md` step 3: decide the kit
   root (in place if the cwd is empty, else `./<kit-id>/`, same as `astro-kit-new`),
   copy the template tree, fill every `{{PLACEHOLDER}}` from steps 2–3, drop the
   `.tmpl` suffix, copy `tools/` **verbatim** (including `parity_check.py` — the
   golden-fixture parity harness every converted kit ships), `chmod +x
   tools/build_kit.sh`, and sanity-check `python3 tools/validate_manifest.py
   kit.json` exits 0. Always go through `$(ac path templates)/kit/` — never
   hardcode the template tree, so this stays in lockstep with `astro-kit-new`.

6. **Capture golden fixtures from the source's REAL outputs.** Pick representative,
   preferably deterministic/offline inputs. Before writing anything captured to
   disk, grep the source and the captured outputs for secret-shaped values and
   never copy `.env`/credential files into the kit. Try to run the source:
   - **Locally first** (`subprocess.run` with a timeout);
   - **Escalate to the host bridge only for genuine environment reasons**
     (`host <cmd>`, never raw `ssh`, never touch the astro-forge stack) and
     **surface every host command you ran** in your final summary;
   - **Else fall back to user-attested fixtures**: ask the user for sample
     input→output pairs and label them explicitly lower-confidence.
   Stamp every fixture with the source's version/commit, the exact capture
   command, and a timestamp so parity claims are auditable.

7. **Wire the parity contract.** Write `tools/parity/parity.json` (the format
   `parity_check.py` documents) with one fixture entry per captured case — run
   command template, `input`/`output`/`expected_output` paths, and a **declared**
   normalization list (regex substitutions and/or JSON field paths for
   timestamps/run-ids/temp-paths/unordered collections, optional float tolerance).
   Normalize ONLY declared-benign nondeterminism — never broaden it to mask a real
   difference. Tell the user exactly which fields you normalized so parity can't be
   silently loosened. Store fixtures under `tools/parity/fixtures/<case>/`.

8. **Flag the non-self-contained rest — never drop it silently.** Static-scan the
   source for capabilities that can't be reproduced self-contained: network calls,
   database/infra access, subprocess calls out to infrastructure, and
   credential-shaped `os.environ` reads. Every such capability becomes an explicit,
   named manual follow-up — a flagged requirement/note in `.astrocode/PROJECT.md` —
   never wired into the kit as a hidden external dependency and never silently
   omitted.

9. **Seed the project**, mirroring `astro-kit-new.md` steps 4–8: `ac init --name
   "<kit-id>"`; write `.astrocode/PROJECT.md` with **vision** = parity with the
   named source, **requirements** = the source's capabilities as `REQ-` ids PLUS the
   kit contract (valid manifest, `build_kit.sh` green, self-contained) PLUS one
   falsifiable parity requirement **per fixture** (the parity-check step must pass
   on it), and the step-8 flagged capabilities recorded under Out-of-scope /
   deferred follow-ups; write `.astrocode/CONVENTIONS.md` from `KIT-CONTRACT.md`
   same as `astro-kit-new`; `ac registry init`; propose an initial milestone/phases
   sized to close the remaining parity gap and confirm with the user, then create
   each with `ac phase add "<name>"`; show `ac status`.

10. Point the user at `/astro-discuss 1` (then `/astro-plan 1`) to start closing the
    gap — always reference a phase by its **number**. If the kit was scaffolded into
    a subdirectory, remind the user to reopen their session there first.

The conversion is DONE when the "Build & definition of done" list in
`KIT-CONTRACT.md` holds AND `python3 tools/parity_check.py --manifest
tools/parity/parity.json` exits 0 on the shipped fixtures. Any flagged non-self-
contained capability from step 8 stays an explicit, visible follow-up — it is never
quietly treated as complete.
