# PLAN — Phase 12: Kit conversion command (source → standard kit)

Goal: ship `astro-kit-convert` plus the parity machinery it depends on, and a REAL worked
conversion (sample source → golden fixtures → converted kit) so the pre-registered CRITERIA
(C1–C7) can actually be run and proven. CRITERIA C1–C7 all inspect "the converted kit" — an
un-demonstrated converter fails, so the worked conversion under `examples/kit-convert-demo/`
is a first-class deliverable, not a nicety.

Canon honored: ADR-024 (reuse `templates/kit/` scaffold, never fork — the parity harness lands
in the shared vendored `tools/`), ADR-025 (golden-fixture parity contract), ADR-023 (`astro-kit-<verb>`
naming), KIT-CONTRACT (exact pins, base-image allowlist, ≤1 `email_attachment`, deliverables from
scripts). All tasks are ADDITIVE (no deletions/renames) so every wave boundary compiles trivially
under `node --test`. Test tasks (t6, t7) are **test-after**: they `depends_on` the artifacts they
exercise so no wave boundary is ever red (ADR-020) — chosen deliberately since the harness is a
python subprocess with no JS symbol to dynamic-import (ADR-018 dynamic-import rule N/A here).

Waves: W1 = t1,t2,t3,t4 (parallel, disjoint files, empty depends_on) · W2 = t5 · W3 = t6,t7.

---

## t1 — Parity harness (stdlib-only) in the vendored scaffold
- **id:** t1
- **title:** Add the reusable golden-fixture parity checker every converted kit ships
- **file:** `templates/kit/tools/parity_check.py`
- **depends_on:** (none)
- **What:** New `python3`, **stdlib-only** tool (json, difflib, re, hashlib, subprocess, argparse,
  pathlib — NO requests/jsondiff/deepdiff/PyYAML), matching the hand-rolled style of the sibling
  `validate_manifest.py`/`publish_kit.py`. It reads a fixtures manifest `tools/parity/parity.json`
  that declares, per case: the run command template (`{input}`/`{output}` placeholders), the produced
  output file, the recorded `expected_output` file, and a **declared normalization list** (regex
  substitutions + JSON key paths for timestamps/run-ids/temp-paths/unordered collections, optional
  float tolerance). For each fixture it EXECUTES the kit on the input (`subprocess.run`, timeout),
  loads produced vs expected output, applies ONLY the declared normalizations to BOTH sides, diffs
  canonical JSON (`json.dumps(sort_keys=True)` + declared-unordered handling), and prints a per-fixture
  report line (`matched` / `MISMATCH <path>`) plus fixture count and the exact list of normalized
  fields it applied. If the kit produced no output file for a fixture, that fixture is reported NOT
  matched (never an always-pass stub). Exit codes reuse the local convention: `0` all matched /
  `1` any mismatch or missing-output / `2` usage/IO error. Header docstring documents the `parity.json`
  format and the invocation `python3 tools/parity_check.py --manifest tools/parity/parity.json` so
  t2 and t5 reference one contract. This is the ONE generic comparator (de-risk #10) so kits reuse
  rather than reinvent normalization.

## t2 — The `astro-kit-convert` command spec
- **id:** t2
- **title:** Author `commands/astro-kit-convert.md` orchestration spec
- **file:** `commands/astro-kit-convert.md`
- **depends_on:** (none)
- **What:** Markdown command spec modeled on `commands/astro-kit-new.md` (same numbered-prose shape,
  end by pointing at `/astro-discuss 1` by number). Frontmatter: `description` (one line, convert an
  existing non-kit implementation into a standard Astro kit at verified parity), `argument-hint:
  [source path]`, `allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Grep, Glob, Agent`.
  Body steps: (1) **Map the source** — spawn the read-only `astro-mapper` agent against the source
  (reuse the `astro-adopt.md` primitive, do not invent mapping). (2) **Propose the capability map**
  grounded in concrete entrypoints (`console_scripts`/`pyproject`/`package.json bin`/`__main__`/
  argparse subcommands/Dockerfile `ENTRYPOINT`, OpenAPI operations for services), README only as
  fallback; user confirms; a kit = ONE coherent capability (de-risk #6/#9 — default to a single-phase
  recipe unless the source has natural stages). (3) **Auto-derive the manifest** — kit id (dir/repo
  name), description (README/docstrings), deps from lockfiles-over-manifests resolved to **exact pins**
  (record `pip freeze`/`npm ls --json` at capture time so pins match what produced the fixtures —
  de-risk #2), runtime `python3`, entrypoints→recipe phases, produced files→`outputs.artifacts`;
  **filter the base-image allowlist** (`bash coreutils grep sed awk jq git curl wget tar unzip`) out
  of declared tools (de-risk #3); interview ONLY genuine gaps + which single deliverable is the
  `email_attachment` (0-or-1). (4) **Prefer wrap-over-reimplement**: vendor the original as a pinned
  `requires.tools[]` entry + thin python3 wrapper when redistributable; full reimplement only when it
  cannot be pinned/redistributed (de-risk #1). (5) **Scaffold via `$KIT_TPL = $(ac path templates)/kit/`**
  exactly as `astro-kit-new.md` line 16 — copy tree, fill `{{PLACEHOLDER}}`s, drop `.tmpl`, copy
  `tools/` **verbatim** (incl. `parity_check.py`), `chmod +x`, sanity-check
  `python3 tools/validate_manifest.py kit.json` (mirror the indirection, never hardcode the tree —
  de-risk #14). (6) **Capture golden fixtures**: try local `subprocess.run(..., timeout=…, capture_output=True)`
  first; escalate to `host <cmd>` (never raw `ssh`, never touch the astro-forge stack, and SURFACE
  every host command in the summary) only for genuine env reasons; else fall back to **user-attested**
  fixtures explicitly labeled lower-confidence. Prefer deterministic/offline fixture inputs; stamp each
  fixture with source version/commit + exact capture command + timestamp (de-risk #4/#5/#13). Before
  writing anything, grep source + captured outputs for secret patterns and never copy `.env`/creds
  (de-risk #8). (7) **Wire the parity contract**: write `tools/parity/parity.json` + fixtures and the
  declared normalization list; surface the normalized fields to the user so parity isn't silently
  loosened. (8) **Flag the non-self-contained rest**: static-scan the source for network/db/subprocess-to-infra/
  credential-shaped `os.environ` reads and list every capability that can't be made self-contained as
  explicit flagged follow-up REQs/notes in `.astrocode/PROJECT.md` (never silently dropped — C6/de-risk #7).
  (9) **Seed the project** exactly as `astro-kit-new` steps 4–8: `ac init`, PROJECT.md (vision = parity
  with the named source; REQs = source capabilities + kit-contract + one falsifiable parity REQ **per
  fixture** (de-risk #11) + flagged items under Out-of-scope), CONVENTIONS from KIT-CONTRACT,
  `ac registry init`, propose phases, `ac phase add`, show `ac status`, point at `/astro-discuss 1`.

## t3 — Sample non-kit source (the conversion input)
- **id:** t3
- **title:** Add a real, deterministic sample source with a flaggable network/secret capability
- **file:** `examples/kit-convert-demo/source/` (`commit_digest.py`, `requirements.txt`, `README.md`, `sample-commits.json`)
- **depends_on:** (none)
- **What:** A small standalone `commit-digest` tool = the non-kit source `astro-kit-convert` converts.
  `commit_digest.py` reads a JSON list of commits (`{hash,author,type,date,subject}`) and writes a
  deterministic `digest.json` (counts by type, unique authors, per-author counts, first/last date).
  It declares ONE real pinned pip dep in `requirements.txt` (`python-dateutil==2.8.2`, used for date
  parsing) so dependency-derivation is genuinely demonstrable for C7 (non-allowlist pip dep). It has a
  SECOND capability — `--publish` POSTs the digest to `$DIGEST_WEBHOOK_URL` with `$DIGEST_TOKEN` via
  stdlib `urllib.request` — that is network+secret-bound (introduces NO extra dep), giving C6 a concrete
  capability that must be flagged and excluded. `README.md` documents both capabilities and the
  produced `digest.json`. `sample-commits.json` is a small deterministic fixture input. No secrets in
  the repo; the source is fully runnable offline for its core path.

## t4 — Docs: list the command
- **id:** t4
- **title:** Add `astro-kit-convert` to `/astro-help` and README alongside the other kit commands
- **file:** `commands/astro-help.md`, `README.md`
- **depends_on:** (none)
- **What:** In `commands/astro-help.md` add a `- /astro-kit-convert — …` bullet under **Set up &
  navigate** right after the `astro-kit-new`/`astro-kit-publish` bullets (lines ~38–39). In `README.md`
  add a matching `/astro-kit-convert [source path]   …` row in the same table block (lines ~55–56).
  One-liners match the existing voice. (Two disjoint files, one owner — kept in a single task so no
  two same-file tasks race.)

## t5 — The worked converted kit (with golden fixtures + parity wiring)
- **id:** t5
- **title:** Produce the `commit-digest` Astro kit from the sample source at real parity
- **file:** `examples/kit-convert-demo/commit-digest/` (`kit.json`, `registry-entry.json`, `.gitignore`,
  `KIT-CONTRACT.md`, `PROJECT.md`, `src/CLAUDE.md`, `src/README.md`, `src/EXAMPLES.md`,
  `src/generate_report.py`, `src/recipes/commit-digest.yaml`, `src/scripts/build_digest.py`,
  `src/schemas/digest.schema.json`, `tools/**` (verbatim copies incl. `parity_check.py`),
  `tools/parity/parity.json`, `tools/parity/fixtures/**`, `dist/kit.zip`)
- **depends_on:** t1, t3
- **What:** The end-to-end worked conversion the CRITERIA target. Scaffold from `$(ac path templates)/kit/`
  (copy `tools/` verbatim INCLUDING t1's `parity_check.py`), port the source's CORE capability into
  `src/scripts/build_digest.py` producing `_report/digest.json` (the single deliverable; tag it
  `email_attachment` — exactly one). The core runs **pure-stdlib / offline** (parse dates with a
  `datetime.fromisoformat` path so the kit executes in a clean verifier env with no installs and no
  network — C1/C5), while `kit.json requires.tools[]` still declares the derived pinned dep
  `python-dateutil==2.8.2` to mirror the source (C7 exact-pin match; base-image allowlist excluded).
  Capture golden fixtures by running the source (t3) on ≥2 representative inputs (incl. `sample-commits.json`);
  store each under `tools/parity/fixtures/<case>/{input.json,expected_output.json,meta.json}` where
  `meta.json` stamps source version + capture command + timestamp. Write `tools/parity/parity.json`
  declaring the run command (`python3 src/scripts/build_digest.py --in {input} --out {output}`), the
  output file, and the normalization list (e.g. `generated_at` timestamp, any run id — declared, minimal,
  surfaced). `PROJECT.md` records vision = parity with `commit-digest`, one falsifiable parity REQ per
  fixture, kit-contract REQs, and — under Out-of-scope / flagged follow-ups — the `--publish` webhook
  capability marked deferred (network+secret, cannot be self-contained, C6). Run
  `python3 tools/validate_manifest.py kit.json` (0) and `./tools/build_kit.sh` (0) to fill `contents[]`+
  `sha256` and produce `dist/kit.zip`; commit the zip. Everything under this one directory → single owner,
  no intra-wave file race, internal `kit.json`/zip consistency preserved (why this is one atomic task).

## t6 — Behavioral test: the parity harness actually measures parity
- **id:** t6
- **title:** `tests/parity.test.mjs` — falsifiability guards for the harness (C1/C2/C3 shape)
- **file:** `tests/parity.test.mjs`
- **depends_on:** t1, t5
- **Whatः** Node `node --test` file (matches repo convention) that shells out to `python3` against the
  worked kit's fixtures. Asserts: (a) unmodified fixtures → exit 0 with per-fixture `matched` lines and
  fixture count > 0 (C1); (b) deleting/renaming the produced output for one run → that fixture is NOT
  matched (C1 anti-stub); (c) mutating a semantic (non-normalized) value in a recorded
  `expected_output.json` → exit non-zero naming the diverging fixture/field (C2); (d) a diff confined to
  a declared-benign field → still passes AND the harness output surfaces the normalized field set (C3);
  (e) a diff in a field NOT on the normalization list → fails (C3). **Test-after** (depends_on t1,t5) so
  the boundary is green; each run works on a temp copy of the fixtures (scratch dir) so it never mutates
  committed fixtures.

## t7 — Regression guard: command spec + docs invariants
- **id:** t7
- **title:** `tests/kit_convert.test.mjs` — lock the command contract & doc listing
- **file:** `tests/kit_convert.test.mjs`
- **depends_on:** t2, t4
- **What:** Node `node --test` file asserting `commands/astro-kit-convert.md` frontmatter has
  `argument-hint: [source path]` and an `allowed-tools` list including `AskUserQuestion` and `Agent`,
  and the body (i) indirects scaffolding through `ac path templates` / `$KIT_TPL` (never a hardcoded
  tree — ADR-024/de-risk #14), (ii) references the parity contract / golden fixtures / normalization,
  (iii) requires flagging non-self-contained (network/secret) parts as follow-ups, (iv) references
  `astro-mapper`, and (v) ends by pointing at a numbered `/astro-discuss 1`. Also asserts
  `commands/astro-help.md` and `README.md` both list `astro-kit-convert`. **Test-after** (depends_on t2,t4).
