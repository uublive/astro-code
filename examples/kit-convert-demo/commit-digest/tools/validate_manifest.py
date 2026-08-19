#!/usr/bin/env python3
"""Validate one-or-more kit.json files against schemas/kit-manifest.v3.schema.json or
kit-manifest.v4.schema.json, selected automatically based on the declared
manifest_version field. Supports manifest_version 3 and 4.

Stdlib-only CLI wrapper around scripts/_schema_engine.py. Produces
line-precise error messages on stderr (D-04) and optional structured
JSON on stdout (D-06). Warns (exit 0) when apt tools omit `version`
(VALID-06). Exit codes follow Unix conventions (D-07):

    0  clean — no errors; warnings alone are still 0
    1  validation errors present (user's kit.json is broken, or malformed JSON)
    2  usage / I/O error (missing file, bad flag, schema file broken)

Invoked directly by build_kit.sh at preflight (Phase 33 plan 02) and by
scripts/test_validator.py as subprocess for the corpus test runner.
"""

from __future__ import annotations

import sys

# Python version guard — must run BEFORE any 3.10-only syntax below.
if sys.version_info < (3, 10):
    print(
        f"error: Python 3.10+ required, got "
        f"{sys.version_info.major}.{sys.version_info.minor}",
        file=sys.stderr,
    )
    sys.exit(2)

import argparse
import json
import re
from pathlib import Path

# Expose scripts/ on sys.path so `_schema_engine` can be imported as a sibling
# module without requiring a package `__init__.py`.
_THIS_DIR = Path(__file__).resolve().parent
if str(_THIS_DIR) not in sys.path:
    sys.path.insert(0, str(_THIS_DIR))

from _schema_engine import validate, Error  # noqa: E402


# Vendored from AstroKit (scripts/validate_manifest.py) into a standalone kit
# project: schemas live next to this file (tools/schemas/), not at a repo root.
SCHEMA_DIR = Path(__file__).resolve().parent / "schemas"
SCHEMA_V3_PATH = SCHEMA_DIR / "kit-manifest.v3.schema.json"
SCHEMA_V4_PATH = SCHEMA_DIR / "kit-manifest.v4.schema.json"
_SUPPORTED_VERSIONS = {3, 4}


# ---------------------------------------------------------------------------
# Error-message shaping (D-04 / D-17 canonical formats)
# ---------------------------------------------------------------------------


def format_error(file_path: str, err: Error) -> str:
    """Render an engine Error as a single stderr line per D-04.

    Empty instance path (root-level violation) elides the path segment so
    the line reads `<file>: <reason>` instead of `<file>:: <reason>`.
    """
    if err.path == "":
        return f"{file_path}: {err.reason}"
    return f"{file_path}:{err.path}: {err.reason}"


def format_warning(file_path: str, warn: Error) -> str:
    """Render a warning (D-17) — identical shape to errors with a `warning:` tag."""
    if warn.path == "":
        return f"{file_path}: warning: {warn.reason}"
    return f"{file_path}:{warn.path}: warning: {warn.reason}"


# ---------------------------------------------------------------------------
# Manifest & schema loading (RESEARCH.md pitfall 4)
# ---------------------------------------------------------------------------


def _load_schema(manifest_version: int) -> dict:
    """Select and load the schema file for the given manifest version.

    Raises SystemExit(2) on astro-kit-side failures (missing/malformed schema file).
    Raises SystemExit(1) with a user-facing message for unsupported versions.
    Version dispatch per D-04:
        3 -> kit-manifest.v3.schema.json
        4 -> kit-manifest.v4.schema.json
        other -> fail fast with canonical error message
    """
    if manifest_version == 3:
        path = SCHEMA_V3_PATH
    elif manifest_version == 4:
        path = SCHEMA_V4_PATH
    else:
        print(
            f"error: unsupported manifest_version: {manifest_version}. Expected 3 or 4.",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"error: schema file missing: {path}", file=sys.stderr)
        sys.exit(2)
    except json.JSONDecodeError as exc:
        print(
            f"error: schema file malformed at {path}: "
            f"line {exc.lineno} col {exc.colno}: {exc.msg}",
            file=sys.stderr,
        )
        sys.exit(2)


def load_manifest(path_str: str) -> tuple[dict | None, Error | None, int]:
    """Load a kit.json. Returns (manifest, fatal_error, exit_override).

    On FileNotFoundError: exit_override = 2 (usage error — wrong path given).
    On malformed JSON: exit_override = 1 with a single synthetic Error
        formatted per D-04 (user-kit is broken, not an astro-kit bug).
    On success: (manifest, None, 0).
    """
    p = Path(path_str)
    try:
        text = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        print(f"error: manifest file not found: {path_str}", file=sys.stderr)
        return None, None, 2
    except OSError as exc:
        print(f"error: cannot read {path_str}: {exc}", file=sys.stderr)
        return None, None, 2
    try:
        return json.loads(text), None, 0
    except json.JSONDecodeError as exc:
        err = Error(
            path="",
            rule="json",
            reason=f"invalid JSON: line {exc.lineno} col {exc.colno}: {exc.msg}",
        )
        return None, err, 1


# ---------------------------------------------------------------------------
# sha256 error rewrite (D-04 canonical exemplar)
# ---------------------------------------------------------------------------


_PATH_SEGMENT_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]")


def _value_at_path(manifest, path: str):
    """Walk `manifest` by a dotted+bracketed path (e.g. "requires.tools[0].sha256").

    Returns None if any segment is missing or a type mismatch occurs. Never
    raises on malformed paths — best effort for message rewrite only.
    """
    if path == "":
        return manifest
    node = manifest
    for match in _PATH_SEGMENT_RE.finditer(path):
        key, idx = match.group(1), match.group(2)
        if idx is not None:
            if not isinstance(node, list):
                return None
            i = int(idx)
            if i >= len(node):
                return None
            node = node[i]
        else:
            if not isinstance(node, dict) or key not in node:
                return None
            node = node[key]
    return node


def _rewrite_sha256_errors(errors: list, manifest: dict) -> list:
    """Replace generic pattern errors on sha256 fields with the canonical
    D-04 phrasing: `expected 64-char lowercase hex, got <value>`.

    The engine stays generic; this layer produces the domain-specific message.
    Values are rendered via `json.dumps` so the exemplar's double-quoted form
    (`got ""`) is preserved literally — Python's `!r` would emit single quotes.
    """
    out = []
    for err in errors:
        if err.rule == "pattern" and err.path.endswith(".sha256"):
            value = _value_at_path(manifest, err.path)
            rendered = json.dumps(value) if isinstance(value, str) else repr(value)
            out.append(
                Error(
                    path=err.path,
                    rule=err.rule,
                    reason=f"expected 64-char lowercase hex, got {rendered}",
                )
            )
        else:
            out.append(err)
    return out


# ---------------------------------------------------------------------------
# Warning collection (VALID-06 / D-16)
# ---------------------------------------------------------------------------


def collect_warnings(manifest: dict) -> list:
    """Produce VALID-06 warnings for apt tools missing `version`.

    Phase 33 intentionally narrows warnings to this one check (D-16);
    broader lint-style warnings are deferred to Phase 36 kit-test rules.
    """
    warnings: list = []
    tools = (
        manifest.get("requires", {}).get("tools", [])
        if isinstance(manifest, dict)
        else []
    )
    if not isinstance(tools, list):
        return warnings
    for i, tool in enumerate(tools):
        if not isinstance(tool, dict):
            continue
        if tool.get("source") == "apt" and "version" not in tool:
            name = tool.get("name", "")
            warnings.append(
                Error(
                    path=f"requires.tools[{i}]",
                    rule="apt-no-version",
                    reason=(
                        f"apt tool {name!r} has no version pin — "
                        f"supply-chain risk, consider pinning"
                    ),
                )
            )
    return warnings


# ---------------------------------------------------------------------------
# Cross-artifact invariant (D-05 / R-AK-02)
# ---------------------------------------------------------------------------


def check_email_attachment_invariant(kit_id: str, artifacts: list[dict]) -> list:
    """Post-parse cross-artifact invariant: at most one artifact per kit may carry
    the email_attachment tag. JSON Schema cannot express this without awkward
    if/then/else or contains/maxContains gymnastics (D-05). Enforced here.

    Returns a list of Error objects (empty = invariant satisfied).
    Error message format matches spec R-AK-02 exactly.
    """
    tagged_indices = [
        i for i, a in enumerate(artifacts)
        if "email_attachment" in a.get("tags", [])
    ]
    if len(tagged_indices) > 1:
        return [
            Error(
                path="outputs.artifacts",
                rule="email-attachment-invariant",
                reason=(
                    f'kit "{kit_id}" declares email_attachment on artifacts '
                    f'{tagged_indices} — only one permitted'
                ),
            )
        ]
    return []


def _check_email_attachment_invariant_for_manifest(
    manifest: dict, path_str: str
) -> list:
    """Extract artifacts from a parsed manifest and run the invariant check.

    Returns Error list (empty = invariant satisfied). The kit_id is derived
    from the manifest's 'name' field; falls back to the file path if absent.
    """
    kit_id = manifest.get("name") or path_str
    outputs = manifest.get("outputs", {})
    if not isinstance(outputs, dict):
        return []
    artifacts = outputs.get("artifacts", [])
    if not isinstance(artifacts, list):
        return []
    # Filter to only dict artifacts — plain-string artifacts already rejected
    # by schema validation; we skip them here to avoid a second error.
    dict_artifacts = [a for a in artifacts if isinstance(a, dict)]
    return check_email_attachment_invariant(kit_id, dict_artifacts)


# ---------------------------------------------------------------------------
# Per-file validation pipeline
# ---------------------------------------------------------------------------


def validate_one(path_str: str, schema: dict, manifest: dict | None = None) -> tuple[list, list, int]:
    """Validate a single kit.json. Returns (errors, warnings, fatal_exit).

    If `manifest` is provided (pre-loaded by main), skips the file read.
    `fatal_exit` is 2 when the file is unreadable (propagates to main as
    a usage error); otherwise 0 and the caller inspects errors/warnings.
    """
    if manifest is None:
        manifest, fatal, exit_code = load_manifest(path_str)
        if exit_code == 2:
            return [], [], 2
        if manifest is None:
            return [fatal], [], 0
    raw_errors = validate(schema, manifest, "", root_schema=schema)
    errors = _rewrite_sha256_errors(raw_errors, manifest)
    warnings = collect_warnings(manifest)
    return errors, warnings, 0


# ---------------------------------------------------------------------------
# Output emission
# ---------------------------------------------------------------------------


def emit_text(path_str: str, errors: list, warnings: list) -> None:
    for err in errors:
        print(format_error(path_str, err), file=sys.stderr)
    for warn in warnings:
        print(format_warning(path_str, warn), file=sys.stderr)


def emit_json(path_str: str, errors: list, warnings: list) -> None:
    payload = {
        "file": path_str,
        "errors": [
            {"path": e.path, "rule": e.rule, "reason": e.reason} for e in errors
        ],
        "warnings": [
            {"path": w.path, "rule": w.rule, "reason": w.reason} for w in warnings
        ],
    }
    json.dump(payload, sys.stdout)
    print()


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="validate_manifest",
        description=(
            "Validate kit.json against schemas/kit-manifest.v3.schema.json or "
            "kit-manifest.v4.schema.json based on the declared manifest_version. "
            "Supports manifest_version 3 and 4."
        ),
    )
    parser.add_argument("paths", nargs="+", help="one or more kit.json paths")
    parser.add_argument("--json", action="store_true",
                        help="emit structured JSON to stdout")
    args = parser.parse_args()

    had_errors = False
    usage_exit = 0

    for path_str in args.paths:
        # Pre-read to detect manifest_version before schema selection.
        manifest, fatal, exit_code = load_manifest(path_str)
        if exit_code == 2:
            usage_exit = 2
            continue
        if manifest is None:
            # Malformed JSON — fatal has the synthetic error; emit and continue.
            emit_text(path_str, [fatal], [])
            had_errors = True
            continue

        # Version detection: missing or non-integer version fails fast.
        raw_version = manifest.get("manifest_version")
        if not isinstance(raw_version, int):
            err = Error(
                path="manifest_version",
                rule="type",
                reason=(
                    f"manifest_version must be an integer (3 or 4), "
                    f"got {type(raw_version).__name__}"
                ),
            )
            emit_text(path_str, [err], [])
            had_errors = True
            continue

        schema = _load_schema(raw_version)  # exits on unsupported version
        errors, warnings, fatal = validate_one(path_str, schema, manifest=manifest)
        if fatal == 2:
            usage_exit = 2
            continue
        # v4-only: run cross-artifact invariant post-parse
        if raw_version == 4:
            inv_errors = _check_email_attachment_invariant_for_manifest(manifest, path_str)
            errors = errors + inv_errors
        emit_text(path_str, errors, warnings)
        if args.json:
            emit_json(path_str, errors, warnings)
        if errors:
            had_errors = True

    if usage_exit == 2:
        return 2            # I/O errors always win; schema errors were already emitted
    if had_errors:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
