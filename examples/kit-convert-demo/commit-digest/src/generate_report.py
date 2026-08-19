#!/usr/bin/env python3
"""Generate the primary deliverable for the commit-digest kit.

Reads _report/state.json for the resolved `input_path` (written by the
recipe's `prepare` phase) and writes _report/digest.json by calling
`scripts/build_digest.py`'s pure functions directly — stdlib-only, no
subprocess needed since both modules live in this kit's src/ tree.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPORT_DIR = Path("_report")

# scripts/ is a sibling directory of this file — expose it on sys.path so
# build_digest can be imported without a package __init__.py, matching how
# tools/validate_manifest.py imports its sibling _schema_engine.
_THIS_DIR = Path(__file__).resolve().parent
_SCRIPTS_DIR = _THIS_DIR / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from build_digest import build_digest, load_commits  # noqa: E402


def main() -> int:
    state_path = REPORT_DIR / "state.json"
    if not state_path.is_file():
        print("error: _report/state.json not found — run the recipe's prepare "
              "phase first", file=sys.stderr)
        return 1
    state = json.loads(state_path.read_text(encoding="utf-8"))

    input_path = state.get("input_path")
    if not input_path:
        print("error: _report/state.json is missing 'input_path'", file=sys.stderr)
        return 1

    try:
        commits = load_commits(input_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    digest = build_digest(commits)

    out_path = REPORT_DIR / "digest.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(digest, f, indent=2, sort_keys=True)
        f.write("\n")

    print(f"wrote {out_path}: {digest['commit_count']} commits, {digest['unique_authors']} authors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
