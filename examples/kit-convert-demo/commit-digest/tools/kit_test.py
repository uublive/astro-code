#!/usr/bin/env python3
"""kit_test.py — Tier 1 offline kit test: everything checkable WITHOUT a
hosted Astro instance.

Publishing a kit to test it is a slow feedback loop, and most kit breakage is
not subtle: a recipe phase that declares no output, a deliverable nothing
produces, an EXAMPLES.md missing the sections Astro reads, a report script
that does not even compile. This tool catches that class in under a second,
on the developer's machine, before anything is uploaded.

Scope — deliberately NOT the whole story:

  Tier 1 (this tool)  static: manifest, recipe, EXAMPLES, scripts, parity
  Tier 2              run the recipe against a local Astro + local registry
  Tier 3              run it inside the worker image with the tools installed

Tier 1 proves the kit is WELL-FORMED. It cannot prove the kit WORKS — only
running it does that. Every check here is mechanical and deterministic; no
check depends on an agent's judgement.

Stdlib-only, matching validate_manifest.py / parity_check.py (no requests,
no jsondiff). PyYAML is used when importable because it is authoritative,
but is NOT required — a restricted parser covers the recipe subset the kit
template emits, and refuses (loudly) to guess at anything outside it.

## Invocation

    python3 tools/kit_test.py                 # from the kit root
    python3 tools/kit_test.py --kit-root .
    python3 tools/kit_test.py --json          # machine-readable report

## Exit codes (matching validate_manifest.py, D-07)

    0  clean — no failures; warnings alone are still 0
    1  one or more checks FAILED
    2  usage / I/O error (not a kit root, unreadable file)
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
import py_compile
import re
import subprocess
import tempfile
from pathlib import Path

try:  # authoritative when present; never required
    import yaml as _pyyaml
except ImportError:  # pragma: no cover - depends on the host env
    _pyyaml = None


# ── Result model ──────────────────────────────────────────────────────────

FAIL = "FAIL"
WARN = "WARN"
PASS = "PASS"


class Report:
    """Ordered check results. `failed` drives the exit code; warnings do not."""

    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str, str]] = []  # (status, group, id, message)

    def add(self, status: str, group: str, check_id: str, message: str) -> None:
        self.rows.append((status, group, check_id, message))

    def ok(self, group: str, check_id: str, message: str) -> None:
        self.add(PASS, group, check_id, message)

    def warn(self, group: str, check_id: str, message: str) -> None:
        self.add(WARN, group, check_id, message)

    def fail(self, group: str, check_id: str, message: str) -> None:
        self.add(FAIL, group, check_id, message)

    @property
    def failed(self) -> list[tuple[str, str, str, str]]:
        return [r for r in self.rows if r[0] == FAIL]

    @property
    def warned(self) -> list[tuple[str, str, str, str]]:
        return [r for r in self.rows if r[0] == WARN]


# ── Minimal recipe-YAML reader ────────────────────────────────────────────

class RecipeParseError(Exception):
    """The recipe uses YAML this restricted reader will not guess at."""


def _strip_comment(line: str) -> str:
    """Drop a trailing ` #comment`. Respects quotes so a '#' inside a quoted
    scalar survives. Not a general YAML lexer — good enough for the subset,
    and anything ambiguous is rejected upstream rather than guessed."""
    out: list[str] = []
    quote: str | None = None
    for i, ch in enumerate(line):
        if quote:
            out.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in ('"', "'"):
            quote = ch
            out.append(ch)
            continue
        if ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        return v[1:-1]
    return v


def parse_recipe_min(text: str) -> dict:
    """Parse the recipe subset the kit template emits:

        name: <scalar>
        description: >
          folded block
        version: <scalar>
        phases:
          - name: <scalar>
            goal: >
              folded block
            constraints:
              - "quoted string"
            input: []
            output:
              - path/to/file

    Raises RecipeParseError on anything outside that shape rather than
    silently mis-reading it — a wrong parse would produce confident, wrong
    findings, which is worse than no findings.
    """
    lines = text.splitlines()
    doc: dict = {}
    phases: list[dict] = []
    i = 0
    n = len(lines)

    def indent_of(s: str) -> int:
        return len(s) - len(s.lstrip(" "))

    def read_block(start: int, base_indent: int) -> tuple[str, int]:
        """Consume an indented folded/literal block scalar."""
        parts: list[str] = []
        j = start
        while j < n:
            raw = lines[j]
            if not raw.strip():
                parts.append("")
                j += 1
                continue
            if indent_of(raw) <= base_indent:
                break
            parts.append(raw.strip())
            j += 1
        return ("\n".join(parts).strip(), j)

    def read_list(start: int, base_indent: int) -> tuple[list[str], int]:
        """Consume a block sequence of scalars."""
        items: list[str] = []
        j = start
        while j < n:
            raw = _strip_comment(lines[j])
            if not raw.strip():
                j += 1
                continue
            ind = indent_of(raw)
            if ind <= base_indent:
                break
            s = raw.strip()
            if not s.startswith("- "):
                raise RecipeParseError(
                    f"line {j + 1}: expected a '- ' list item, got: {s[:60]!r}"
                )
            items.append(_unquote(s[2:]))
            j += 1
        return (items, j)

    while i < n:
        raw = _strip_comment(lines[i])
        if not raw.strip():
            i += 1
            continue
        ind = indent_of(raw)
        s = raw.strip()

        if ind != 0:
            raise RecipeParseError(
                f"line {i + 1}: unexpected indentation at top level: {s[:60]!r}"
            )
        if ":" not in s:
            raise RecipeParseError(f"line {i + 1}: expected 'key: value', got {s[:60]!r}")

        key, _, rest = s.partition(":")
        key = key.strip()
        rest = rest.strip()

        if key == "phases":
            if rest:
                raise RecipeParseError(
                    f"line {i + 1}: inline 'phases:' value is not supported"
                )
            i += 1
            # Each phase begins with a '- ' at some consistent indent.
            cur: dict | None = None
            phase_indent: int | None = None
            while i < n:
                raw2 = _strip_comment(lines[i])
                if not raw2.strip():
                    i += 1
                    continue
                ind2 = indent_of(raw2)
                if ind2 == 0:
                    break  # back to a top-level key
                s2 = raw2.strip()

                if s2.startswith("- "):
                    if phase_indent is None:
                        phase_indent = ind2
                    cur = {}
                    phases.append(cur)
                    s2 = s2[2:].strip()
                    ind2 = ind2 + 2

                if cur is None:
                    raise RecipeParseError(
                        f"line {i + 1}: content before the first '- ' phase item"
                    )
                if ":" not in s2:
                    raise RecipeParseError(
                        f"line {i + 1}: expected 'key: value' inside a phase, got {s2[:60]!r}"
                    )
                k2, _, v2 = s2.partition(":")
                k2 = k2.strip()
                v2 = v2.strip()

                if v2 in (">", "|", ">-", "|-", ">+", "|+"):
                    val, i = read_block(i + 1, ind2)
                    cur[k2] = val
                    continue
                if v2 == "[]":
                    cur[k2] = []
                    i += 1
                    continue
                if v2 == "":
                    items, i = read_list(i + 1, ind2)
                    cur[k2] = items
                    continue
                cur[k2] = _unquote(v2)
                i += 1
            doc["phases"] = phases
            continue

        if rest in (">", "|", ">-", "|-", ">+", "|+"):
            val, i = read_block(i + 1, ind)
            doc[key] = val
            continue
        if rest == "":
            items, i = read_list(i + 1, ind)
            doc[key] = items
            continue
        doc[key] = _unquote(rest)
        i += 1

    return doc


def load_recipe(path: Path) -> tuple[dict, str]:
    """Return (recipe_dict, parser_name). PyYAML wins when available."""
    text = path.read_text(encoding="utf-8")
    if _pyyaml is not None:
        data = _pyyaml.safe_load(text)
        if not isinstance(data, dict):
            raise RecipeParseError("recipe did not parse to a mapping")
        return (data, "PyYAML")
    return (parse_recipe_min(text), "builtin")


# ── Path helpers ──────────────────────────────────────────────────────────

_WILDCARD = re.compile(r"[*?\[\]]")


def escapes_root(rel: str) -> bool:
    """True if `rel` is absolute or climbs out of its root — mirrors the
    containment guard in astro's recipe-executor.validatePhaseOutputs
    (T-73-02), so a recipe rejected there is rejected here first."""
    p = rel.strip()
    if not p or p.startswith("/") or p.startswith("~"):
        return True
    parts = Path(p).parts
    depth = 0
    for part in parts:
        if part == "..":
            depth -= 1
            if depth < 0:
                return True
        elif part not in (".",):
            depth += 1
    return False


# ── Checks ────────────────────────────────────────────────────────────────

REQUIRED_EXAMPLE_SECTIONS = [
    "Quick Start",
    "Examples",
    "Argument Reference",
    "Common Patterns",
]

# KIT-CONTRACT.md: Astro's base image already ships these; declaring them is
# noise at best and a version conflict at worst.
BASE_IMAGE_TOOLS = {
    "bash", "coreutils", "grep", "sed", "awk", "jq",
    "git", "curl", "wget", "tar", "unzip",
}

SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")


def check_manifest(root: Path, rep: Report) -> dict | None:
    """Delegate manifest validation to the vendored validator — never
    reimplement it here; one source of truth (it owns the v3/v4 schemas)."""
    kit_json = root / "kit.json"
    if not kit_json.is_file():
        rep.fail("manifest", "M-01", "kit.json not found at the kit root")
        return None

    try:
        manifest = json.loads(kit_json.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        rep.fail("manifest", "M-01", f"kit.json is not valid JSON: {exc}")
        return None

    validator = root / "tools" / "validate_manifest.py"
    if validator.is_file():
        proc = subprocess.run(
            [sys.executable, str(validator), str(kit_json)],
            capture_output=True, text=True, cwd=str(root),
        )
        if proc.returncode == 0:
            rep.ok("manifest", "M-02", "validate_manifest.py clean")
        else:
            detail = (proc.stderr or proc.stdout or "").strip().splitlines()
            head = detail[0] if detail else f"exit {proc.returncode}"
            rep.fail("manifest", "M-02", f"validate_manifest.py failed: {head}")
    else:
        rep.warn("manifest", "M-02", "tools/validate_manifest.py missing — manifest shape unchecked")

    # Base-image allowlist (contract rule, not currently schema-enforced).
    for tool in (manifest.get("requires", {}) or {}).get("tools", []) or []:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name", "")).lower()
        if tool.get("source") == "apt" and name in BASE_IMAGE_TOOLS:
            rep.warn(
                "manifest", "M-03",
                f"requires.tools declares base-image tool {name!r} — the contract says do not declare it",
            )

    return manifest


def check_recipe(root: Path, manifest: dict | None, rep: Report) -> None:
    recipes_dir = root / "src" / "recipes"
    if not recipes_dir.is_dir():
        rep.fail("recipe", "R-01", "src/recipes/ not found — the kit has no execution contract")
        return

    files = sorted(p for p in recipes_dir.glob("*.yaml"))
    if not files:
        rep.fail("recipe", "R-01", "no *.yaml in src/recipes/")
        return
    rep.ok("recipe", "R-01", f"found {len(files)} recipe(s)")

    for rpath in files:
        rel = rpath.relative_to(root)
        try:
            recipe, parser = load_recipe(rpath)
        except RecipeParseError as exc:
            rep.fail("recipe", "R-02", f"{rel}: cannot parse — {exc}")
            continue
        except Exception as exc:  # PyYAML errors
            rep.fail("recipe", "R-02", f"{rel}: YAML error — {exc}")
            continue
        rep.ok("recipe", "R-02", f"{rel}: parses ({parser})")

        # Required top-level fields — mirrors astro's recipe-schema.ts.
        for field in ("name", "description"):
            if not str(recipe.get(field, "")).strip():
                rep.fail("recipe", "R-03", f"{rel}: '{field}' is required and non-empty")

        phases = recipe.get("phases")
        if not isinstance(phases, list) or not phases:
            rep.fail("recipe", "R-03", f"{rel}: 'phases' must be a non-empty list")
            continue

        seen_names: set[str] = set()
        produced: set[str] = set()  # outputs of all PRECEDING phases
        all_outputs: set[str] = set()

        for idx, ph in enumerate(phases):
            label = f"{rel} phase[{idx}]"
            if not isinstance(ph, dict):
                rep.fail("recipe", "R-04", f"{label}: not a mapping")
                continue

            name = str(ph.get("name", "")).strip()
            if not name:
                rep.fail("recipe", "R-04", f"{label}: 'name' is required")
            else:
                label = f"{rel} phase '{name}'"
                if name in seen_names:
                    rep.fail("recipe", "R-05", f"{label}: duplicate phase name")
                seen_names.add(name)
                if not SNAKE_CASE.match(name):
                    rep.warn("recipe", "R-05", f"{label}: name is not snake_case")

            if not str(ph.get("goal", "")).strip():
                rep.fail("recipe", "R-06", f"{label}: 'goal' is required and non-empty")

            outputs = ph.get("output") or []
            if not isinstance(outputs, list) or not outputs:
                # astro's schema: output.min(1). A phase with no output can
                # never be validated as complete by the recipe executor.
                rep.fail(
                    "recipe", "R-07",
                    f"{label}: must declare at least one 'output' "
                    "(astro validates phase completion by output existence)",
                )
                outputs = []

            inputs = ph.get("input") or []
            if not isinstance(inputs, list):
                rep.fail("recipe", "R-08", f"{label}: 'input' must be a list")
                inputs = []

            for out in outputs:
                if escapes_root(str(out)):
                    rep.fail("recipe", "R-09", f"{label}: output {out!r} escapes the work dir")
            for inp in inputs:
                if escapes_root(str(inp)):
                    rep.fail("recipe", "R-09", f"{label}: input {inp!r} escapes the work dir")

            # Dataflow: an input should come from an earlier phase or ship in
            # src/. WARN, not FAIL — a kit may legitimately read something the
            # invocation supplied at runtime.
            for inp in inputs:
                si = str(inp)
                if si in produced:
                    continue
                if (root / "src" / si).exists() or (root / si).exists():
                    continue
                rep.warn(
                    "recipe", "R-10",
                    f"{label}: input {si!r} is not produced by an earlier phase "
                    "and does not ship in src/ — runtime-supplied?",
                )

            produced.update(str(o) for o in outputs)
            all_outputs.update(str(o) for o in outputs)

        rep.ok(
            "recipe", "R-04",
            f"{rel}: {len(phases)} phase(s) well-formed "
            f"({', '.join(sorted(seen_names)) or 'unnamed'})",
        )

        # The contract's definition of done: "every declared artifact is
        # actually produced by the workflow the recipe describes". Until now
        # that was a human eyeball; here it is mechanical.
        if manifest:
            artifacts = (manifest.get("outputs", {}) or {}).get("artifacts", []) or []
            reachable = 0
            for art in artifacts:
                apath = art.get("path") if isinstance(art, dict) else art
                if not apath:
                    continue
                apath = str(apath)
                if apath in all_outputs:
                    reachable += 1
                    continue
                if _WILDCARD.search(apath):
                    rep.warn(
                        "recipe", "R-11",
                        f"artifact {apath!r} contains a wildcard — cannot match it to a phase output",
                    )
                    continue
                rep.fail(
                    "recipe", "R-11",
                    f"artifact {apath!r} (kit.json outputs.artifacts) is produced by NO "
                    f"phase in {rel} — the kit would finish with nothing to deliver",
                )
            if reachable:
                rep.ok(
                    "recipe", "R-11",
                    f"{reachable}/{len(artifacts)} declared artifact(s) produced by a phase",
                )
            if artifacts:
                tagged = [
                    a for a in artifacts
                    if isinstance(a, dict) and "email_attachment" in (a.get("tags") or [])
                ]
                if len(tagged) > 1:
                    rep.fail(
                        "recipe", "R-12",
                        f"{len(tagged)} artifacts carry 'email_attachment' — at most ONE may",
                    )


def check_examples(root: Path, rep: Report) -> None:
    path = root / "src" / "EXAMPLES.md"
    if not path.is_file():
        rep.fail("examples", "E-01", "src/EXAMPLES.md missing (Astro reads it to learn how to invoke the kit)")
        return
    text = path.read_text(encoding="utf-8")
    headings = {
        m.group(1).strip().lower()
        for m in re.finditer(r"^#{1,3}\s+(.+?)\s*$", text, re.MULTILINE)
    }
    missing = [s for s in REQUIRED_EXAMPLE_SECTIONS if s.lower() not in headings]
    if missing:
        rep.fail("examples", "E-02", f"EXAMPLES.md missing required section(s): {', '.join(missing)}")
    else:
        rep.ok("examples", "E-02", "EXAMPLES.md has all 4 required sections")

    # Each example carries 4 labelled fields. The house format bolds the colon
    # too (`**Prompt:**`), so match the label with an optional inner colon.
    missing_fields = []
    for field in ("Prompt", "Arguments", "Expected workflow", "Produces"):
        pattern = r"\*\*\s*" + re.escape(field) + r"\s*:?\s*\*\*"
        if not re.search(pattern, text, re.IGNORECASE):
            missing_fields.append(field)
    if missing_fields:
        rep.warn(
            "examples", "E-03",
            f"EXAMPLES.md examples missing labelled field(s): {', '.join(missing_fields)}",
        )
    else:
        rep.ok("examples", "E-03", "examples carry all 4 labelled fields")


def check_required_docs(root: Path, rep: Report) -> None:
    for name in ("CLAUDE.md", "README.md"):
        if (root / "src" / name).is_file():
            rep.ok("docs", "D-01", f"src/{name} present")
        else:
            rep.fail("docs", "D-01", f"src/{name} missing (required by the kit contract)")


def check_scripts(root: Path, rep: Report) -> None:
    src = root / "src"
    if not src.is_dir():
        rep.fail("scripts", "S-01", "src/ not found")
        return
    pys = sorted(src.rglob("*.py"))
    if not pys:
        rep.warn("scripts", "S-01", "no python scripts under src/ — deliverables must be script-generated")
        return
    broken = 0
    with tempfile.TemporaryDirectory() as tmp:
        for py in pys:
            try:
                py_compile.compile(
                    str(py),
                    cfile=str(Path(tmp) / (py.stem + ".pyc")),
                    doraise=True,
                )
            except py_compile.PyCompileError as exc:
                broken += 1
                first = str(exc).strip().splitlines()
                rep.fail(
                    "scripts", "S-02",
                    f"{py.relative_to(root)}: syntax error — {first[-1] if first else exc}",
                )
    if not broken:
        rep.ok("scripts", "S-02", f"{len(pys)} python file(s) compile")


def check_parity(root: Path, rep: Report) -> None:
    manifest = root / "tools" / "parity" / "parity.json"
    checker = root / "tools" / "parity_check.py"
    if not manifest.is_file():
        rep.warn("parity", "P-01", "no tools/parity/parity.json — no golden-fixture coverage of the scripts")
        return
    if not checker.is_file():
        rep.fail("parity", "P-01", "parity.json present but tools/parity_check.py missing")
        return
    proc = subprocess.run(
        [sys.executable, str(checker), "--manifest", str(manifest)],
        capture_output=True, text=True, cwd=str(root),
    )
    if proc.returncode == 0:
        rep.ok("parity", "P-02", "parity_check.py clean")
    else:
        detail = (proc.stdout or proc.stderr or "").strip().splitlines()
        rep.fail("parity", "P-02", f"parity_check.py failed: {detail[-1] if detail else proc.returncode}")


def check_build(root: Path, rep: Report) -> None:
    zip_path = root / "dist" / "kit.zip"
    if zip_path.is_file():
        rep.ok("build", "B-01", "dist/kit.zip present")
    else:
        rep.warn("build", "B-01", "dist/kit.zip not built yet — run ./tools/build_kit.sh")


# ── Reporting ─────────────────────────────────────────────────────────────

SYMBOL = {PASS: "✓", WARN: "!", FAIL: "✗"}


def render(rep: Report, root: Path) -> None:
    print(f"kit-test — {root}")
    print()
    group = None
    for status, grp, cid, msg in rep.rows:
        if grp != group:
            print(f"  {grp}")
            group = grp
        print(f"    {SYMBOL[status]} [{cid}] {msg}")
    print()
    nf, nw = len(rep.failed), len(rep.warned)
    npass = len([r for r in rep.rows if r[0] == PASS])
    print(f"  {npass} passed, {nw} warning(s), {nf} failure(s)")
    if nf:
        print()
        print("  Tier 1 FAILED — fix the above before publishing.")
    else:
        print()
        print("  Tier 1 clean. Note: this proves the kit is well-formed, NOT that it works —")
        print("  only a real run (Tier 2/3) does that.")


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="kit_test.py",
        description="Tier 1 offline kit test — static checks, no Astro instance required.",
    )
    parser.add_argument("--kit-root", default=".", help="kit root directory (default: cwd)")
    parser.add_argument("--json", action="store_true", help="emit a machine-readable report on stdout")
    parser.add_argument("--skip-parity", action="store_true", help="do not run parity_check.py")
    args = parser.parse_args()

    root = Path(args.kit_root).resolve()
    if not root.is_dir():
        print(f"error: not a directory: {root}", file=sys.stderr)
        return 2
    if not (root / "kit.json").is_file() and not (root / "src").is_dir():
        print(f"error: {root} does not look like a kit root (no kit.json, no src/)", file=sys.stderr)
        return 2

    rep = Report()
    manifest = check_manifest(root, rep)
    check_required_docs(root, rep)
    check_recipe(root, manifest, rep)
    check_examples(root, rep)
    check_scripts(root, rep)
    if not args.skip_parity:
        check_parity(root, rep)
    check_build(root, rep)

    if args.json:
        print(json.dumps({
            "kit_root": str(root),
            "results": [
                {"status": s, "group": g, "id": c, "message": m}
                for s, g, c, m in rep.rows
            ],
            "failures": len(rep.failed),
            "warnings": len(rep.warned),
        }, indent=2))
    else:
        render(rep, root)

    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
