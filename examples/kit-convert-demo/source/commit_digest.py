#!/usr/bin/env python3
"""commit_digest.py — summarize a JSON list of commits into a deterministic digest.

This is a **standalone, non-kit** sample tool: the source `astro-kit-convert`'s
worked demo (`examples/kit-convert-demo/`) converts into a standard Astro kit. It
has two capabilities, deliberately shaped so the demo can exercise both halves of
the conversion contract (ADR-025):

  1. **Core (self-contained, offline).** Read a JSON array of commits
     (`{hash, author, type, date, subject}`) and write a deterministic
     `digest.json`: counts by commit `type`, per-author commit counts, the
     number of unique authors, and the first/last commit date. Dates are
     parsed with `python-dateutil` (`requirements.txt` pins
     `python-dateutil==2.8.2`) — a REAL third-party dependency so
     `astro-kit-convert`'s dependency-derivation (C7) has something genuine to
     find rather than every declared dep being stdlib-only. This path needs
     no network and no secret and is fully runnable offline.

  2. **`--publish` (network + secret bound — NOT self-contained).** POST the
     computed digest as JSON to `$DIGEST_WEBHOOK_URL`, authenticated with a
     bearer token read from `$DIGEST_TOKEN`, via stdlib `urllib.request` (no
     extra dependency introduced). This capability can never be reproduced in
     a self-contained kit — it exists so the converter has a concrete,
     flaggable capability to surface as an explicit manual follow-up rather
     than silently drop or wire in as a hidden external dependency (C6).

Neither `$DIGEST_WEBHOOK_URL` nor `$DIGEST_TOKEN` is read unless `--publish` is
passed, and no secret ever lives in this repo — both are read from the
environment at call time only.

## Usage

    python3 commit_digest.py --in sample-commits.json --out digest.json
    python3 commit_digest.py --in sample-commits.json --out digest.json --publish

## Output shape (digest.json)

    {
      "generated_at": "<ISO 8601 UTC timestamp — the one nondeterministic field>",
      "commit_count": <int>,
      "by_type": {"<type>": <count>, ...},
      "authors": {"<author>": <count>, ...},
      "unique_authors": <int>,
      "first_date": "<ISO 8601 date>",
      "last_date": "<ISO 8601 date>"
    }

Every field except `generated_at` is a pure function of the input commit list —
same input always yields the same digest, which is what makes it usable as a
golden-fixture parity target.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone

from dateutil import parser as date_parser


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
    `generated_at`), which is exactly the property a parity fixture needs."""
    by_type: Counter = Counter()
    authors: Counter = Counter()
    parsed_dates = []
    for commit in commits:
        by_type[commit["type"]] += 1
        authors[commit["author"]] += 1
        parsed_dates.append(date_parser.isoparse(commit["date"]))
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


def publish(digest: dict) -> int:
    """POST `digest` to the configured webhook. Network + secret bound — this
    is the capability `astro-kit-convert` must flag rather than reproduce."""
    url = os.environ.get("DIGEST_WEBHOOK_URL")
    token = os.environ.get("DIGEST_TOKEN")
    if not url:
        raise SystemExit("error: --publish requires $DIGEST_WEBHOOK_URL to be set")
    if not token:
        raise SystemExit("error: --publish requires $DIGEST_TOKEN to be set")
    body = json.dumps(digest).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 — deliberate demo capability
        return resp.status


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="commit_digest",
        description="Summarize a JSON list of commits into a deterministic digest.json.",
    )
    parser.add_argument("--in", dest="input_path", required=True, help="path to the input commits JSON array")
    parser.add_argument("--out", dest="output_path", required=True, help="path to write digest.json")
    parser.add_argument(
        "--publish",
        action="store_true",
        help="also POST the digest to $DIGEST_WEBHOOK_URL (requires $DIGEST_WEBHOOK_URL and $DIGEST_TOKEN)",
    )
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

    if args.publish:
        try:
            status = publish(digest)
        except urllib.error.URLError as exc:
            print(f"error: publish failed: {exc}", file=sys.stderr)
            return 1
        print(f"published digest to {os.environ['DIGEST_WEBHOOK_URL']} (status {status})")

    print(f"wrote {args.output_path}: {digest['commit_count']} commits, {digest['unique_authors']} authors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
