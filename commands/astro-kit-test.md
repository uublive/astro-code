---
description: Test this kit WITHOUT publishing it — Tier 1 static checks offline in seconds, or --tier2 to run it against a real local Astro
argument-hint: [--tier2] [--json]
allowed-tools: Bash, Read, Edit
---

You are testing **this kit** offline, before it is published anywhere. Publishing to
test is a slow loop; most kit breakage is mechanical and can be caught in under a
second on this machine.

The checker is `$(ac path templates)/kit/tools/kit_test.py` — stdlib-only (PyYAML is
used when importable but never required), invoked from the installed astro-code
templates so it works even for kits scaffolded before this command existed. New kits
also ship their own copy at `tools/kit_test.py`. **Prefer the kit's local copy if
present, else the templates one.**

## What this does and does NOT prove

Tier 1 proves the kit is **well-formed**. It cannot prove the kit **works** — only a
real run does that. Say so when you report results; never let a green Tier 1 be
reported as "the kit works".

| Tier | What it exercises | Needs |
|---|---|---|
| **1 (default)** | manifest, recipe, artifact reachability, EXAMPLES, scripts, parity | nothing |
| **2 (`--tier2`)** | astro really resolving, loading and running the kit | an astro checkout |
| 3 | the above inside the worker image, with `requires.tools[]` installed | podman/docker |

## Steps

1. **Preflight.** Confirm the cwd is a kit root: `kit.json` or `src/` exists. If not,
   tell the user to run this from the kit's root and stop.

2. **Run the checker.** Prefer `./tools/kit_test.py`, else
   `$(ac path templates)/kit/tools/kit_test.py`:

   ```bash
   python3 tools/kit_test.py            # or the templates path
   ```

   Pass `--json` through if the user asked for it. `--skip-parity` skips the
   golden-fixture run when it is slow.

   Exit codes: `0` clean (warnings alone are still 0), `1` one or more checks failed,
   `2` usage / not a kit root.

3. **Report and fix.** Group what failed by check id and fix the underlying kit — never
   the checker, and never by loosening a check to make it pass. The checks that matter
   most, because nothing else catches them until a real run:

   - **R-11 — a declared artifact is produced by no phase.** The kit would finish with
     nothing to deliver. Either add the artifact to the producing phase's `output:`, or
     the deliverable genuinely is not produced and the recipe needs the missing step.
   - **R-07 — a phase declares no output.** Astro validates phase completion by output
     existence, so such a phase can never be marked complete.
   - **R-09 — an input/output escapes the work dir.** Astro rejects these at runtime
     (its own containment guard); better to fail here.
   - **S-02 — a shipped script does not compile.** The recipe tells the agent to run it;
     it would fail mid-run.

   Warnings are advisory — R-10 in particular fires for inputs supplied at invocation
   time, which is legitimate. Judge them, don't reflexively silence them.

4. **When it's clean**, report the pass/warn/fail counts and state plainly that Tier 1
   passing means well-formed, not working. Then offer Tier 2 — don't assume it.

## Tier 2 — run it against a real local Astro (`--tier2`)

`tools/kit_run_local.py` stands up a one-kit registry on localhost, seeds the kit
straight from `src/`, and points a local Astro at both. No publishing, no upload. It
works because four hooks already exist in astro: `ASTROKIT_REGISTRY_URL` has no
default, `UseKit` skips the download when the kit dir is already populated,
`ASTRO_KIT_BASE_DIR` overrides the container-only `/workspace/.kits`, and the agent
CLI runs locally.

It needs the **astro checkout** — `--astro-root <path>` or `$ASTRO_ROOT`. If it's
absent, say so and stop at Tier 1 rather than guessing at a path.

```bash
# set up + prove astro resolves and loads the kit (no agent, no tokens):
python3 tools/kit_run_local.py --astro-root "$ASTRO_ROOT"

# hold the registry up so you can drive the agent yourself in another terminal:
python3 tools/kit_run_local.py --astro-root "$ASTRO_ROOT" --serve

# run the agent end-to-end and assert every declared phase output appears:
python3 tools/kit_run_local.py --astro-root "$ASTRO_ROOT" \
    --execute --task "<the Quick Start prompt from src/EXAMPLES.md>"
```

**`--execute` spends API tokens.** Never pass it on your own initiative — the default
mode deliberately stops after proving the kit loads. Ask the user first, every time.

Exit codes: `0` loaded (and with `--execute`, every declared phase output was
produced), `1` astro could not load the kit or a phase produced nothing, `2` usage or
no astro checkout.

Reading a Tier 2 failure:

- **registry 0 kits** — the entry was filtered out. Almost always `contract_version`
  not satisfying astro's active runtime contract; `KIT_CONTRACT_DISABLE=1` confirms
  that's the cause, but fix the declaration rather than shipping with it disabled.
- **seed FAILED** — the kit dir wasn't populated, so astro would try `download_url`.
  Means `src/` is missing `CLAUDE.md` and `recipes/` both.
- **CLAUDE.md FAILED** — astro loads instructions from `CLAUDE.md`/`ASTRO.md`/
  `AGENTS.md`; without one the kit loads as an empty capability.
- **a phase output missing after `--execute`** — the agent ran but didn't produce what
  the recipe declares. That's the real finding Tier 2 exists for: either the phase
  goal doesn't actually cause the output, or the output path is wrong.

An `--execute` run is agent-driven and therefore nondeterministic. Judge it on
**declared outputs existing**, never on the prose matching a previous run — for
output-level determinism use `parity_check.py` (Tier 1), which is what it's for.

## When to suggest this

Proactively run or suggest `/astro-kit-test` whenever kit work has just changed the
manifest, a recipe, `EXAMPLES.md`, or a script — and always before `/astro-kit-publish`.
It is fast enough that there is no reason to batch it to the end.
