# commit-digest

## Vision

Reproduce the standalone `commit_digest.py` sample source
(`examples/kit-convert-demo/source/`) as a standard Astro kit at **verified
feature parity** — the kit must produce outputs equivalent to the source's own
real captured outputs on representative inputs, proven by a golden-fixture
parity check, not a human "looks right" (ADR-025).

## Requirements

- **REQ-001** — Given a JSON array of commits (`{hash, author, type, date,
  subject}`), the kit writes `_report/digest.json` with `commit_count`,
  `by_type`, `authors`, `unique_authors`, `first_date`, `last_date`, matching
  the source's `build_digest()` field-for-field.
- **REQ-002** — `kit.json` is a valid manifest v4: `python3
  tools/validate_manifest.py kit.json` exits 0.
- **REQ-003** — `./tools/build_kit.sh` exits 0 and produces `dist/kit.zip`
  with `sha256` + `contents[]` filled in.
- **REQ-004** — The kit is self-contained: it runs offline, with no installs
  and no network access, in a clean verifier environment.
- **REQ-005** — At most one deliverable carries the `email_attachment` tag
  (`_report/digest.json` — the kit's only artifact).
- **REQ-006 (parity, fixture `sample-1`)** — `tools/parity_check.py
  --manifest tools/parity/parity.json` reports fixture `sample-1`
  (`tools/parity/fixtures/sample-1/`, the source's own `sample-commits.json`)
  as `matched`.
- **REQ-007 (parity, fixture `sample-2`)** — the same parity check reports
  fixture `sample-2` (`tools/parity/fixtures/sample-2/`, a second
  representative input with unsorted, cross-timezone commit dates) as
  `matched`.
- **REQ-008** — `kit.json`'s declared tool dependency (`python-dateutil`
  `2.8.2`, pip, exact pin) matches the source's own `requirements.txt`
  exactly — the only real third-party dependency the source declares.

## Out-of-scope / flagged follow-ups

- **FOLLOWUP-001 — `--publish` webhook capability (deferred, not
  self-contained).** The source's `commit_digest.py --publish` flag POSTs the
  computed digest to `$DIGEST_WEBHOOK_URL`, authenticated with a bearer token
  read from `$DIGEST_TOKEN`. This capability is network-bound (an external
  HTTP endpoint) and secret-bound (a live credential read from the
  environment), so it cannot be reproduced inside a self-contained kit
  (REQ-004) without either reaching the network or requiring a secret at
  runtime — both of which would violate the kit contract's self-containment
  bar. It is deliberately **not** implemented in this kit (never silently
  dropped, never wired in as a hidden external dependency, C6) and is
  recorded here as an explicit manual follow-up: a future phase could add an
  optional, clearly-labeled "publish" step that a user opts into and
  supplies credentials for at invocation time, outside the kit's
  self-contained core.

## Constraints

- Manifest v4, exact tool-dependency pins only (no ranges), base-image
  allowlist (`bash coreutils grep sed awk jq git curl wget tar unzip`) never
  redeclared as a tool dependency.
- Runtime output stays under `_report/`; deliverables come from scripts
  (`generate_report.py` / `scripts/build_digest.py`), never hand-written.
- Parity normalization is limited to the declared list in
  `tools/parity/parity.json` (currently: `generated_at`, blanked) — never
  broadened to mask a real output difference.
