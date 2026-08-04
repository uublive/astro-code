"""Private stdlib draft-2020-12 subset engine for astro-kit v3 schemas.

Consumed by scripts/validate_manifest.py and scripts/validate_registry.py
(Phase 33 plans 01 and 03). Not a public API — the module name is prefixed
with an underscore and the contract is frozen by the plan's <interfaces>
block, not by any external user-facing documentation.

Supported JSON-Schema keywords (D-02):
    type, const, enum, pattern, minLength, required, properties,
    additionalProperties, items, oneOf, $ref, $defs, uniqueItems

Metadata keywords silently ignored:
    title, description, default, $schema, $id, $comment, examples

Any other keyword raises NotImplementedError at validation time — this
catches schema drift early (e.g., if a future phase adds allOf/if/minItems).

References:
    - Plan 33-01 <interfaces> block (authoritative contract)
    - RESEARCH.md §"Engine sketch" Patterns 1-4
    - CONTEXT.md §decisions D-01 through D-07
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass


_KNOWN_KEYWORDS = frozenset(
    {
        "type",
        "const",
        "enum",
        "pattern",
        "minLength",
        "required",
        "properties",
        "additionalProperties",
        "items",
        "oneOf",
        "$ref",
        "$defs",
        "uniqueItems",
    }
)

_METADATA_KEYWORDS = frozenset(
    {
        "title",
        "description",
        "default",
        "$schema",
        "$id",
        "$comment",
        "examples",
        "deprecated",  # JSON Schema 2019-09+ informational keyword; silently ignored
    }
)

_JSON_TYPE_MAP = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


@dataclass(frozen=True)
class Error:
    """One validation error.

    Attributes:
        path:   Dotted+bracketed instance path (e.g. "requires.tools[2].sha256")
                or "" for root-level violations.
        rule:   Short identifier for the violated JSON Schema keyword
                (e.g. "pattern", "required", "const", "oneOf/source",
                "type", "additionalProperties").
        reason: Human-readable description without trailing punctuation.
    """

    path: str
    rule: str
    reason: str


def _descend(path: str, key):
    """Append a key to an instance path using dotted+bracketed notation.

    int key (array index)   -> "<path>[<key>]"  (no separator before bracket)
    str key at root         -> "<key>"          (no leading dot)
    str key otherwise       -> "<path>.<key>"
    """
    if isinstance(key, int):
        return f"{path}[{key}]"
    if path == "":
        return str(key)
    return f"{path}.{key}"


def _resolve_ref(ref: str, root_schema: dict) -> dict:
    """Resolve an intra-file #/$defs/... reference, raising on external refs."""
    if not isinstance(ref, str) or not ref.startswith("#/"):
        raise NotImplementedError(f"external $ref not supported: {ref!r}")
    segments = ref[2:].split("/")
    node = root_schema
    for raw in segments:
        # JSON Pointer escapes: ~1 -> /, ~0 -> ~
        seg = raw.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or seg not in node:
            raise NotImplementedError(f"$ref target not found: {ref!r}")
        node = node[seg]
    if not isinstance(node, dict):
        raise NotImplementedError(f"$ref target is not an object: {ref!r}")
    return node


def validate(
    schema: dict,
    instance,
    path: str = "",
    *,
    root_schema: dict | None = None,
) -> list:
    """Validate an instance against a schema; return list of Error objects.

    Pure function: never raises on instance violations (those become Error
    entries). Raises NotImplementedError only on engine-level issues —
    unsupported keyword, external $ref, or missing $ref target.
    """
    if root_schema is None:
        root_schema = schema

    # $ref substitutes the entire schema (v3 has no sibling keywords to $ref).
    if "$ref" in schema:
        schema = _resolve_ref(schema["$ref"], root_schema)

    # Unknown-keyword guard (D-02). $defs and $ref are handled explicitly.
    for key in schema:
        if (
            key not in _KNOWN_KEYWORDS
            and key not in _METADATA_KEYWORDS
            and key != "$defs"
            and key != "$ref"
        ):
            raise NotImplementedError(
                f"schema engine does not support keyword {key!r} at path {path!r}"
            )

    errors: list = []

    # Dispatch supported keywords. Each applicator returns a list[Error].
    if "type" in schema:
        errors.extend(_check_type(schema, instance, path, root_schema))
    if "const" in schema:
        errors.extend(_check_const(schema, instance, path, root_schema))
    if "enum" in schema:
        errors.extend(_check_enum(schema, instance, path, root_schema))
    if "pattern" in schema:
        errors.extend(_check_pattern(schema, instance, path, root_schema))
    if "minLength" in schema:
        errors.extend(_check_min_length(schema, instance, path, root_schema))
    if "required" in schema:
        errors.extend(_check_required(schema, instance, path, root_schema))
    if "properties" in schema:
        errors.extend(_check_properties(schema, instance, path, root_schema))
    if "additionalProperties" in schema:
        errors.extend(
            _check_additional_properties(schema, instance, path, root_schema)
        )
    if "items" in schema:
        errors.extend(_check_items(schema, instance, path, root_schema))
    if "oneOf" in schema:
        errors.extend(_check_one_of(schema, instance, path, root_schema))
    if "uniqueItems" in schema:
        errors.extend(_check_unique_items(schema, instance, path, root_schema))

    return errors


# ---------------------------------------------------------------------------
# Keyword applicators. All accept (schema, instance, path, root_schema) and
# return list[Error]. None raise on instance violations.
# ---------------------------------------------------------------------------


def _check_type(schema, instance, path, root_schema):
    expected = schema["type"]
    # Guard bool vs int: JSON Schema considers True/False a boolean, not an integer.
    if expected == "integer":
        if isinstance(instance, bool) or not isinstance(instance, int):
            return [
                Error(
                    path,
                    "type",
                    f"expected integer, got {type(instance).__name__}",
                )
            ]
        return []
    if expected == "number":
        if isinstance(instance, bool) or not isinstance(instance, (int, float)):
            return [
                Error(
                    path,
                    "type",
                    f"expected number, got {type(instance).__name__}",
                )
            ]
        return []
    py_type = _JSON_TYPE_MAP.get(expected)
    if py_type is None:
        raise NotImplementedError(
            f"schema engine does not support type {expected!r} at path {path!r}"
        )
    # dict check must not also match subclasses like bool (Python bool is int, not dict; safe).
    if expected == "boolean":
        if not isinstance(instance, bool):
            return [
                Error(
                    path,
                    "type",
                    f"expected boolean, got {type(instance).__name__}",
                )
            ]
        return []
    if not isinstance(instance, py_type):
        return [
            Error(
                path,
                "type",
                f"expected {expected}, got {type(instance).__name__}",
            )
        ]
    return []


def _check_const(schema, instance, path, root_schema):
    expected = schema["const"]
    if instance != expected:
        return [
            Error(
                path,
                "const",
                f"expected const {expected!r}, got {instance!r}",
            )
        ]
    return []


def _check_enum(schema, instance, path, root_schema):
    enum_list = schema["enum"]
    if instance not in enum_list:
        return [
            Error(
                path,
                "enum",
                f"expected one of {enum_list!r}, got {instance!r}",
            )
        ]
    return []


def _check_pattern(schema, instance, path, root_schema):
    # Only strings have a pattern constraint; non-strings are a separate type error.
    if not isinstance(instance, str):
        return []
    pattern = schema["pattern"]
    # Plan 33-01 mandates `re.fullmatch` (NOT `re.match`) to close the
    # `$`-before-trailing-newline hole that would let `sha256 = "a"*64 + "\n"`
    # pass under `re.match`. Phase 32 schemas, however, use one unanchored-on-
    # the-right pattern ("^https://") relying on JSON Schema's ECMA-262 search
    # semantics. Using fullmatch against that pattern literally would reject
    # every real https URL. Bridge: normalise the pattern to a fullmatch-
    # equivalent form — replace trailing `$` with `\Z` (strict EOS), and if
    # there is no end-anchor, append `.*` so fullmatch accepts any suffix.
    # This preserves JSON Schema unanchored intent AND fullmatch strictness.
    # See 33-01-SUMMARY.md (Rule 1 deviation — Phase 32 schema patterns).
    effective = _fullmatch_pattern(pattern)
    if re.fullmatch(effective, instance) is None:
        return [
            Error(
                path,
                "pattern",
                f"does not match pattern {pattern!r}",
            )
        ]
    return []


def _fullmatch_pattern(pattern: str) -> str:
    """Return a pattern equivalent to JSON Schema's unanchored `search` intent
    when consumed by `re.fullmatch`.

    Rules:
        - If pattern ends with an unescaped `$`, replace with `\\Z` (strict
          end of string; blocks the trailing-newline regex quirk).
        - If pattern ends with `\\Z`, leave alone (already strict).
        - Otherwise, append `.*` so fullmatch accepts any suffix.
        - If pattern starts with `^`, keep it (fullmatch anchors the start
          anyway, so `^` is redundant but harmless).
        - If pattern has no leading `^`, prepend `.*` so fullmatch accepts
          any prefix (honours JSON Schema unanchored-on-left intent).

    Since v3 schemas use `$` only at pattern end and never escape it, and
    `^` only at pattern start, the simple tail/head checks below are enough.
    If future schemas mix `$`/`^` at other positions, extend this helper.
    """
    # End-anchor handling.
    if pattern.endswith(r"\Z"):
        tail = pattern
    elif pattern.endswith("$"):
        # Count trailing backslashes; odd count means the `$` is escaped.
        bs = 0
        for i in range(len(pattern) - 2, -1, -1):
            if pattern[i] == "\\":
                bs += 1
            else:
                break
        if bs % 2 == 1:
            # Escaped `$` — treat as literal, append .* for fullmatch.
            tail = pattern + ".*"
        else:
            tail = pattern[:-1] + r"\Z"
    else:
        tail = pattern + ".*"
    # Start-anchor handling.
    if tail.startswith("^"):
        return tail
    return ".*" + tail


def _check_min_length(schema, instance, path, root_schema):
    if not isinstance(instance, str):
        return []
    n = schema["minLength"]
    if len(instance) < n:
        return [
            Error(
                path,
                "minLength",
                f"string length {len(instance)} is shorter than minLength {n}",
            )
        ]
    return []


def _check_required(schema, instance, path, root_schema):
    if not isinstance(instance, dict):
        return []
    errors = []
    for field in schema["required"]:
        if field not in instance:
            errors.append(
                Error(
                    path,
                    "required",
                    f"missing required field {field!r}",
                )
            )
    return errors


def _check_properties(schema, instance, path, root_schema):
    if not isinstance(instance, dict):
        return []
    errors = []
    props = schema["properties"]
    for key, value in instance.items():
        if key in props:
            errors.extend(
                validate(
                    props[key],
                    value,
                    _descend(path, key),
                    root_schema=root_schema,
                )
            )
    return errors


def _check_additional_properties(schema, instance, path, root_schema):
    if not isinstance(instance, dict):
        return []
    ap = schema["additionalProperties"]
    if ap is True:
        return []
    if ap is False:
        known = set(schema.get("properties", {}).keys())
        errors = []
        for key in instance.keys():
            if key not in known:
                errors.append(
                    Error(
                        _descend(path, key),
                        "additionalProperties",
                        f"unknown field {key!r} not allowed",
                    )
                )
        return errors
    # Subschema form not used in v3 schemas — raise so drift is caught.
    raise NotImplementedError(
        f"schema engine does not support additionalProperties subschema at path {path!r}"
    )


def _check_items(schema, instance, path, root_schema):
    if not isinstance(instance, list):
        return []
    item_schema = schema["items"]
    errors = []
    for i, item in enumerate(instance):
        errors.extend(
            validate(item_schema, item, _descend(path, i), root_schema=root_schema)
        )
    return errors


def _check_one_of(schema, instance, path, root_schema):
    """oneOf with source discriminator short-circuit (Pattern 3).

    Only the branch whose properties.source.const matches instance["source"]
    is evaluated. This keeps error output line-precise: a pip tool with a
    bad name emits ONE error (the pip name pattern) instead of errors from
    every branch's failed source-const check.
    """
    if not isinstance(instance, dict):
        return [
            Error(
                path,
                "type",
                f"expected object, got {type(instance).__name__}",
            )
        ]
    branches = schema["oneOf"]
    if "source" not in instance:
        return [
            Error(
                path,
                "required",
                "missing required field 'source' (must be one of: apt, pip, npm, url)",
            )
        ]
    source_value = instance["source"]
    # Resolve each branch (may be a $ref) and find the matching one.
    valid_sources = []
    for branch in branches:
        resolved = branch
        if "$ref" in resolved:
            resolved = _resolve_ref(resolved["$ref"], root_schema)
        try:
            const_val = resolved["properties"]["source"]["const"]
        except (KeyError, TypeError):
            # Branch with no source discriminator — fall back to validating directly.
            continue
        valid_sources.append(const_val)
        if const_val == source_value:
            # Validate against the matched branch; its errors are the only ones reported.
            return validate(resolved, instance, path, root_schema=root_schema)
    # No branch matched — emit one targeted source-enum error.
    return [
        Error(
            _descend(path, "source"),
            "oneOf/source",
            f"expected one of {sorted(valid_sources)!r}, got {source_value!r}",
        )
    ]


def _check_unique_items(schema, instance, path, root_schema):
    if not schema["uniqueItems"]:
        return []
    if not isinstance(instance, list):
        return []
    # JSON-serialize items for hashability (items may be dicts/lists).
    seen = set()
    for item in instance:
        key = json.dumps(item, sort_keys=True)
        if key in seen:
            return [
                Error(
                    path,
                    "uniqueItems",
                    "array items must be unique",
                )
            ]
        seen.add(key)
    return []
