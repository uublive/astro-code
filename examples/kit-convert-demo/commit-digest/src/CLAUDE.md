# Commit Digest — Kit Instructions

Summarize a JSON list of commits into a deterministic digest.json (counts by
type, per-author commit counts, unique authors, first/last commit date).

## Mission

Given a JSON array of commit objects (`{hash, author, type, date, subject}`),
produce `_report/digest.json`: a single deterministic summary an Astro user
can review at a glance or attach to an email reply. This kit is a converted
port of the standalone `commit_digest.py` sample source, at verified parity
(golden-fixture parity check under `tools/`) — its network+secret-bound
`--publish` capability is explicitly out of scope, see `.astrocode/PROJECT.md`.

## How to run

1. Read `recipes/commit-digest.yaml` — it is the execution contract. Execute
   its phases **in order**; each phase's `goal`, `constraints`, `input`, and
   `output` are binding.
2. Stay in the current working directory. All runtime output goes under
   `_report/` — never scatter files elsewhere.
3. Track progress in `_report/state.json` so an interrupted run can resume.
4. The deliverable is produced by `generate_report.py` (which calls
   `scripts/build_digest.py`) — if it fails, debug and fix it; do NOT create
   the artifact by hand.

## Arguments

`$ARGUMENTS` must contain the path to a JSON file holding an array of commit
objects, each with `hash`, `author`, `type`, `date` (ISO 8601), and `subject`.
If the path is missing or doesn't exist, print usage and STOP.

## Deliverables

| Artifact | Description |
|----------|-------------|
| `_report/digest.json` | The commit digest (email attachment) |

## Reference material

`schemas/digest.schema.json` documents the exact shape of `digest.json`.
There is no `reference/` data — the digest is computed purely from the input.
