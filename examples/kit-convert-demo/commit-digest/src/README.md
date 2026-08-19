# Commit Digest

Summarize a JSON list of commits into a deterministic digest.json (counts by
type, per-author commit counts, unique authors, first/last commit date).

## What it does

- Reads a JSON array of commits (`{hash, author, type, date, subject}`).
- Counts commits per conventional-commit-style `type` (feat, fix, docs, ...).
- Counts commits per `author` and the number of unique authors.
- Finds the first and last commit dates.
- Writes the result to `_report/digest.json`, the kit's single deliverable.

## Usage

Ask Astro to summarize a commit list, e.g. "summarize these commits" or
"build a commit digest", passing the path to a JSON commits array.

## Outputs

| Artifact | Description |
|----------|-------------|
| `_report/digest.json` | Primary deliverable (email attachment) |

## Requirements

- Runtime: `python3`.
- `kit.json` declares `python-dateutil==2.8.2` under `requires.tools[]` to
  mirror the converted source's real dependency (C7 parity), though this
  kit's own script path parses dates with pure stdlib
  (`datetime.fromisoformat`) so it runs offline with no installs.

## Estimated duration

Under 1 minute.

## Conversion note

This kit is a converted port of the standalone `commit_digest.py` sample
source (`examples/kit-convert-demo/source/`), reproduced at verified parity —
see `tools/parity/parity.json` and the golden fixtures under
`tools/parity/fixtures/`. The source's second capability, `--publish` (POST
the digest to a webhook using a bearer token from the environment), is
network+secret-bound and cannot be made self-contained; it is deliberately
NOT reproduced here — see `.astrocode/PROJECT.md` for the flagged follow-up.
