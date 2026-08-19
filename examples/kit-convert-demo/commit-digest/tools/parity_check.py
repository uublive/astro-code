#!/usr/bin/env python3
"""parity_check.py — the reusable golden-fixture parity checker every kit
converted by `astro-kit-convert` ships (ADR-025).

Kit conversion proves feature parity against a source's REAL captured
outputs, not a human "looks right" — this tool is the ONE generic
comparator so kits reuse it rather than reinvent normalization
(de-risk #10). Stdlib-only (json, re, hashlib, subprocess, argparse,
pathlib — NO requests/jsondiff/deepdiff/PyYAML), matching the hand-rolled
style of the sibling validate_manifest.py / publish_kit.py.

## Fixtures manifest format (tools/parity/parity.json)

    {
      "fixtures": [
        {
          "name": "sample-1",
          "command": "python3 src/scripts/build_digest.py --in {input} --out {output}",
          "input": "tools/parity/fixtures/sample-1/input.json",
          "output": "tools/parity/fixtures/sample-1/actual_output.json",
          "expected_output": "tools/parity/fixtures/sample-1/expected_output.json",
          "timeout": 30,
          "normalize": {
            "regex": [
              {"pattern": "\\"generated_at\\": \\"[^\\"]*\\"", "replacement": "\\"generated_at\\": \\"<TS>\\""}
            ],
            "fields": [
              {"path": "generated_at", "kind": "blank"},
              {"path": "meta.run_id", "kind": "blank"},
              {"path": "authors", "kind": "unordered"}
            ],
            "float_tolerance": 6
          }
        }
      ]
    }

All paths are resolved relative to the current working directory (the kit
root — invoke this tool FROM the kit root, matching build_kit.sh /
validate_manifest.py). `command` is a template: `{input}`/`{output}` are
substituted with the fixture's `input`/`output` paths before the kit is
executed via `subprocess.run` (with `timeout`, default 30s).

`normalize` is a per-fixture DECLARED list — the only nondeterminism this
tool will ever tolerate (ADR-025). It is applied identically to BOTH the
produced and the expected output before comparison, never used to invent
a looser match after the fact:

  - `regex`: substitutions run on the raw JSON text of both sides BEFORE
    parsing — for benign values embedded inside a larger string.
  - `fields`: dotted JSON key paths (e.g. `meta.run_id`), each with a
    `kind`: `"blank"` replaces the value with a constant sentinel
    (timestamps/run-ids/temp-paths); `"unordered"` sorts a list value by
    its canonical JSON form so element order stops mattering.
  - `float_tolerance`: optional int — float leaves are rounded to that
    many decimal places on both sides before comparison.

## Invocation

    python3 tools/parity_check.py --manifest tools/parity/parity.json

## Real-execution guarantee (C1)

Before running a fixture's command, any stale file at its declared
`output` path is deleted. The command is always executed. If no output
file exists afterward the fixture is reported NOT matched — this can
never become an always-pass stub that merely diffs two static files
without actually running the kit.

## Exit codes

    0  every fixture matched
    1  at least one fixture mismatched or produced no output
    2  usage / IO error (manifest missing/malformed, no fixtures declared,
       a declared file cannot be read)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_MANIFEST = "tools/parity/parity.json"
DEFAULT_TIMEOUT = 30


class UsageError(Exception):
    """Raised for manifest/fixture-declaration problems — maps to exit 2."""


# ---------------------------------------------------------------------------
# Manifest loading
# ---------------------------------------------------------------------------


def load_manifest(path: Path) -> dict:
    """Load and minimally shape-check the fixtures manifest.

    Raises UsageError (never a bare exception) so main() can report a
    clean one-line message and exit 2, matching validate_manifest.py's
    usage-error convention.
    """
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise UsageError(f"manifest not found: {path}") from exc
    except OSError as exc:
        raise UsageError(f"cannot read manifest {path}: {exc}") from exc
    try:
        manifest = json.loads(text)
    except json.JSONDecodeError as exc:
        raise UsageError(
            f"manifest {path} is not valid JSON: line {exc.lineno} col {exc.colno}: {exc.msg}"
        ) from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("fixtures"), list):
        raise UsageError(f"manifest {path} must be an object with a 'fixtures' array")
    fixtures = manifest["fixtures"]
    if not fixtures:
        # C1: a parity check that "passes" with zero fixtures proves nothing —
        # treat as a usage error, never a silent 0-fixture green.
        raise UsageError(f"manifest {path} declares no fixtures")
    for i, fx in enumerate(fixtures):
        if not isinstance(fx, dict):
            raise UsageError(f"fixtures[{i}] must be an object")
        for key in ("name", "command", "input", "output", "expected_output"):
            if not fx.get(key):
                raise UsageError(f"fixtures[{i}] is missing required field '{key}'")
    return manifest


# ---------------------------------------------------------------------------
# Normalization — applied identically to BOTH sides, never invented ad hoc
# ---------------------------------------------------------------------------


def apply_regex_normalization(text: str, rules: list) -> str:
    """Run declared regex substitutions on raw JSON text, in order."""
    for rule in rules:
        pattern = rule.get("pattern", "")
        replacement = rule.get("replacement", "")
        text = re.sub(pattern, replacement, text)
    return text


def _navigate(obj, dotted_path: str):
    """Walk `obj` by a dotted key path. Returns (parent, last_key) so the
    caller can read or overwrite the leaf, or (None, None) if the path
    isn't present — normalizing a field the output happens not to have is a
    silent no-op, never a fatal error (fixture-to-fixture shape can vary)."""
    parts = dotted_path.split(".")
    node = obj
    for part in parts[:-1]:
        if not isinstance(node, dict) or part not in node:
            return None, None
        node = node[part]
    last = parts[-1]
    if not isinstance(node, dict) or last not in node:
        return None, None
    return node, last


def apply_field_normalization(obj, fields: list) -> None:
    """Mutate `obj` in place per declared field normalizations."""
    for entry in fields:
        path = entry.get("path", "")
        kind = entry.get("kind", "blank")
        parent, key = _navigate(obj, path)
        if parent is None:
            continue
        if kind == "blank":
            parent[key] = "<normalized>"
        elif kind == "unordered":
            value = parent[key]
            if isinstance(value, list):
                parent[key] = sorted(value, key=lambda v: json.dumps(v, sort_keys=True))


def apply_float_tolerance(obj, decimals: int):
    """Recursively round every float leaf to `decimals` places (both sides
    get the same treatment, so near-equal floats stop diverging on noise)."""
    if isinstance(obj, float):
        return round(obj, decimals)
    if isinstance(obj, dict):
        return {k: apply_float_tolerance(v, decimals) for k, v in obj.items()}
    if isinstance(obj, list):
        return [apply_float_tolerance(v, decimals) for v in obj]
    return obj


def normalize(raw_text: str, normalize_decl: dict) -> tuple[object, str]:
    """Apply the full declared normalization pipeline to one side's raw
    file text. Returns (normalized_object, canonical_json_string)."""
    text = apply_regex_normalization(raw_text, normalize_decl.get("regex", []))
    obj = json.loads(text)
    apply_field_normalization(obj, normalize_decl.get("fields", []))
    tolerance = normalize_decl.get("float_tolerance")
    if tolerance is not None:
        obj = apply_float_tolerance(obj, int(tolerance))
    return obj, json.dumps(obj, sort_keys=True)


def normalized_field_summary(normalize_decl: dict) -> list:
    """The exact list of normalizations declared for a fixture, rendered as
    short human-readable tokens — surfaced in the report so C3's 'the
    normalized field set must be discoverable' can never be satisfied by
    hiding it inside the diff logic."""
    tokens = []
    for entry in normalize_decl.get("fields", []):
        tokens.append(f"{entry.get('path')} ({entry.get('kind', 'blank')})")
    for rule in normalize_decl.get("regex", []):
        tokens.append(f"regex:{rule.get('pattern')}")
    tolerance = normalize_decl.get("float_tolerance")
    if tolerance is not None:
        tokens.append(f"float_tolerance={tolerance}")
    return tokens


# ---------------------------------------------------------------------------
# Structural diff — pinpoints the diverging JSON path(s), not just "differs"
# ---------------------------------------------------------------------------


def diff_paths(a, b, path: str = "") -> list:
    """Return the dotted/bracketed JSON paths where `a` and `b` diverge
    (empty = equal). Recurses through dicts/lists so a mismatch names the
    actual field, matching the repo's existing dotted-path error style
    (see validate_manifest.py format_error). Leaves (and any dict/list vs.
    scalar type mismatch) are compared by their canonical JSON form, kept
    consistent with the top-level `json.dumps(sort_keys=True)` equality
    check so a leaf never reports "equal" while the canonical strings
    that drove the mismatch differ (e.g. int 2 vs float 2.0)."""
    if isinstance(a, dict) and isinstance(b, dict):
        diffs = []
        for key in sorted(set(a) | set(b)):
            sub = f"{path}.{key}" if path else key
            if key not in a or key not in b:
                diffs.append(sub)
                continue
            diffs.extend(diff_paths(a[key], b[key], sub))
        return diffs
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [path or "<root>"]
        diffs = []
        for i, (av, bv) in enumerate(zip(a, b)):
            diffs.extend(diff_paths(av, bv, f"{path}[{i}]"))
        return diffs
    equal = json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    return [] if equal else [path or "<root>"]


# ---------------------------------------------------------------------------
# Fixture execution
# ---------------------------------------------------------------------------


def run_fixture(fixture: dict, root: Path) -> tuple[bool, str, list]:
    """Execute one fixture end-to-end. Returns (matched, reason, normalized_tokens).

    `reason` is "" on a match, else a short cause ('missing-output',
    'timeout', or a comma-joined list of diverging paths).
    """
    name = fixture["name"]
    input_path = root / fixture["input"]
    output_path = root / fixture["output"]
    expected_path = root / fixture["expected_output"]
    normalize_decl = fixture.get("normalize", {}) or {}
    timeout = fixture.get("timeout", DEFAULT_TIMEOUT)
    tokens = normalized_field_summary(normalize_decl)

    # Real-execution guarantee (C1): never let a stale leftover fake a match.
    if output_path.exists():
        output_path.unlink()

    command = fixture["command"].format(input=str(input_path), output=str(output_path))
    try:
        subprocess.run(
            command, shell=True, cwd=str(root), timeout=timeout,
            capture_output=True, check=False,
        )
    except subprocess.TimeoutExpired:
        return False, "timeout", tokens

    if not output_path.exists():
        return False, "missing-output", tokens

    try:
        produced_raw = output_path.read_text(encoding="utf-8")
    except OSError as exc:
        raise UsageError(f"fixture '{name}': cannot read produced output {output_path}: {exc}")
    try:
        expected_raw = expected_path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise UsageError(f"fixture '{name}': recorded expected_output not found: {expected_path}") from exc
    except OSError as exc:
        raise UsageError(f"fixture '{name}': cannot read {expected_path}: {exc}") from exc

    try:
        produced_obj, produced_canon = normalize(produced_raw, normalize_decl)
    except json.JSONDecodeError as exc:
        return False, f"produced output is not valid JSON: {exc}", tokens
    try:
        expected_obj, expected_canon = normalize(expected_raw, normalize_decl)
    except json.JSONDecodeError as exc:
        raise UsageError(f"fixture '{name}': recorded expected_output is not valid JSON: {exc}") from exc

    if produced_canon == expected_canon:
        return True, "", tokens
    diverging = diff_paths(expected_obj, produced_obj)
    return False, ", ".join(diverging) or "<unspecified difference>", tokens


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="parity_check",
        description="Run a kit against its golden fixtures and check the "
                    "produced outputs match the source's captured outputs, "
                    "within only the declared normalization (ADR-025).",
    )
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST,
                        help=f"fixtures manifest path (default: {DEFAULT_MANIFEST})")
    parser.add_argument("--root", default=".",
                        help="kit root that fixture paths + commands are relative to (default: cwd)")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    manifest_path = Path(args.manifest)
    if not manifest_path.is_absolute():
        manifest_path = root / manifest_path

    try:
        manifest = load_manifest(manifest_path)
    except UsageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    fixtures = manifest["fixtures"]
    matched_count = 0
    all_tokens: list = []
    any_mismatch = False

    for fixture in fixtures:
        name = fixture["name"]
        try:
            matched, reason, tokens = run_fixture(fixture, root)
        except UsageError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        for token in tokens:
            if token not in all_tokens:
                all_tokens.append(token)
        if matched:
            matched_count += 1
            print(f"{name}: matched")
        else:
            any_mismatch = True
            print(f"{name}: MISMATCH {reason}")

    total = len(fixtures)
    print(f"{total} fixtures checked, {matched_count} matched, {total - matched_count} mismatched")
    if all_tokens:
        print(f"normalized fields: {', '.join(all_tokens)}")
    else:
        print("normalized fields: (none declared)")

    return 1 if any_mismatch else 0


if __name__ == "__main__":
    sys.exit(main())
