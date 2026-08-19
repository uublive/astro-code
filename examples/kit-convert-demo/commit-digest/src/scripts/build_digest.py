#!/usr/bin/env python3
"""build_digest.py — summarize a JSON list of commits into a deterministic digest.

Ported from the standalone `commit_digest.py` sample source
(`examples/kit-convert-demo/source/commit_digest.py`) — the CORE, self-contained
capability only (ADR-025). The source's second capability, `--publish` (POST the
digest to a webhook using a bearer token from the environment), is network+secret
bound and cannot be made self-contained; it is deliberately NOT reproduced here
and is instead flagged as a manual follow-up in `.astrocode/PROJECT.md` (C6).

Unlike the source, this port parses dates with pure-stdlib
`datetime.fromisoformat` (a trailing "Z" is rewritten to "+00:00" first, since
`fromisoformat` on Python < 3.11 doesn't accept the "Z" designator) rather than
`python-dateutil`, so the kit runs offline with no installs in a clean verifier
environment (C1/C5). `kit.json` still declares the derived `python-dateutil==2.8.2`
pin under `requires.tools[]` to mirror what the source actually depends on (C7) —
it is simply not needed by THIS script's own execution path.

Every field of the produced digest except `generated_at` is a pure function of
the input commit list — same input, same digest — which is what makes it usable
as a golden-fixture parity target (`tools/parity/parity.json`).

## Output shape (see src/schemas/digest.schema.json)

    {
      "generated_at": "<ISO 8601 UTC timestamp — the one nondeterministic field>",
      "commit_count": <int>,
      "by_type": {"<type>": <count>, ...},
      "authors": {"<author>": <count>, ...},
      "unique_authors": <int>,
      "first_date": "<ISO 8601 date>",
      "last_date": "<ISO 8601 date>"
    }

## Usage

    python3 src/scripts/build_digest.py --in <commits.json> --out <digest.json>
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone


def parse_iso(date_str: str) -> datetime:
    """Parse an ISO 8601 timestamp with pure stdlib. Accepts a trailing "Z"
    (UTC designator) by rewriting it to the "+00:00" offset `fromisoformat`
    understands on every supported Python version."""
    if date_str.endswith("Z"):
        date_str = date_str[:-1] + "+00:00"
    return datetime.fromisoformat(date_str)


def load_commits(path: str) -> list:
    """Read and minimally shape-check the input commits array."""
    with open(path, "r", encoding="utf-8") as f:
        commits = json.load(f)
    if not isinstance(commits, list):
        raise ValueError(f"{path} must contain a JSON array of commits")
    for i, commit in enumerate(commits):
        for key in ("hash", "author", "type", "date", "subject"):
            if key not in commit:
                raise ValueError(f"commits[{i}] is missing required field '{key}'")
    return commits


def build_digest(commits: list) -> dict:
    """Pure function: same commit list always yields the same digest (modulo
    `generated_at`) — exactly the property a parity fixture needs. Mirrors the
    source's `build_digest()` field-for-field."""
    by_type: Counter = Counter()
    authors: Counter = Counter()
    parsed_dates = []
    for commit in commits:
        by_type[commit["type"]] += 1
        authors[commit["author"]] += 1
        parsed_dates.append(parse_iso(commit["date"]))
    parsed_dates.sort()
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "commit_count": len(commits),
        "by_type": dict(sorted(by_type.items())),
        "authors": dict(sorted(authors.items())),
        "unique_authors": len(authors),
        "first_date": parsed_dates[0].date().isoformat() if parsed_dates else None,
        "last_date": parsed_dates[-1].date().isoformat() if parsed_dates else None,
    }


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="build_digest",
        description="Summarize a JSON list of commits into a deterministic digest.json.",
    )
    parser.add_argument("--in", dest="input_path", required=True, help="path to the input commits JSON array")
    parser.add_argument("--out", dest="output_path", required=True, help="path to write digest.json")
    args = parser.parse_args(argv)

    try:
        commits = load_commits(args.input_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    digest = build_digest(commits)

    with open(args.output_path, "w", encoding="utf-8") as f:
        json.dump(digest, f, indent=2, sort_keys=True)
        f.write("\n")

    print(f"wrote {args.output_path}: {digest['commit_count']} commits, {digest['unique_authors']} authors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
