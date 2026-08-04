#!/usr/bin/env python3
"""Zip a kit's src/ into dist/kit.zip with root-relative paths, reproducibly.

Stdlib-only replacement for AstroKit's `zip -r -X` step so kit builds work
anywhere python3 exists (no `zip` binary needed). Reproducible: entries are
sorted and timestamps zeroed to a fixed epoch, so the same content always
yields the same sha256.

Usage: _zip_src.py <src-dir> <zip-path>
Exits non-zero if src/ is missing, empty, or lacks a root CLAUDE.md.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

# Excluded junk — mirrors build_kit.sh excludes in AstroKit.
EXCLUDE_NAMES = {".DS_Store", ".env"}
EXCLUDE_SUFFIXES = (".pyc", ".log", ".tmp", ".env")
EXCLUDE_DIRS = {"__pycache__"}

# Fixed DOS timestamp for reproducible archives (1980-01-01, zipfile's minimum).
FIXED_DATE = (1980, 1, 1, 0, 0, 0)


def included(rel: Path) -> bool:
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        return False
    if rel.name in EXCLUDE_NAMES:
        return False
    if rel.name.endswith(EXCLUDE_SUFFIXES):
        return False
    return True


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: _zip_src.py <src-dir> <zip-path>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1]).resolve()
    zip_path = Path(sys.argv[2]).resolve()
    if not src.is_dir():
        print(f"error: source directory not found: {src}", file=sys.stderr)
        return 1

    files = sorted(
        rel
        for rel in (p.relative_to(src) for p in src.rglob("*") if p.is_file())
        if included(rel)
    )
    if not files:
        print(f"error: no files to zip under {src}", file=sys.stderr)
        return 1
    if Path("CLAUDE.md") not in files:
        print("error: CLAUDE.md not found at src/ root — every kit must include it",
              file=sys.stderr)
        return 1

    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in files:
            info = zipfile.ZipInfo(rel.as_posix(), date_time=FIXED_DATE)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, (src / rel).read_bytes())

    print(f"{len(files)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
