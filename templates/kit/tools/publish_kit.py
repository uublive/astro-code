#!/usr/bin/env python3
"""publish_kit.py — package a kit and upload it to a hosted Astro instance.

The hosted kit registry (POST /api/kit-packages) takes ONE file: the kit zip
with `kit.json` (manifest v4) at its ROOT. That differs from `dist/kit.zip`
built by build_kit.sh, which ships only `src/` (the manifest lives beside it,
not inside). This tool builds the *upload* package — every `src/` file
root-relative PLUS `kit.json` at the root — then logs in and uploads it.

The in-zip `kit.json` is the kit's *registry* manifest (the shape the Astro
registry schema validates: `id`, `name`, `description`, `version`, `tags`, …),
which is what `registry-entry.json` already holds. So the manifest source is,
in order: --manifest, else registry-entry.json, else kit.json (whose `name` is
treated as the id). `download_url` and `sha256` are assigned by the server and
ignored here.

Stdlib only (zipfile + urllib) so it runs anywhere python3 exists.

Usage:
  publish_kit.py --base URL --email E --password P
                 [--kit-root DIR] [--manifest FILE] [--note TEXT]
                 [--replace] [--dry-run] [--out FILE]

Exit codes: 0 ok; 2 usage/build error; 3 auth failed; 4 upload rejected;
5 version conflict (use --replace); 6 network/instance error.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import quote

# Mirrors the server's KIT_ID_RE / VERSION_RE in kit-packages.ts.
KIT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.\-+_]*$")

# Junk excluded from the package — mirrors tools/_zip_src.py.
EXCLUDE_NAMES = {".DS_Store", ".env"}
EXCLUDE_SUFFIXES = (".pyc", ".log", ".tmp", ".env")
EXCLUDE_DIRS = {"__pycache__"}
FIXED_DATE = (1980, 1, 1, 0, 0, 0)  # reproducible archives

C_RED, C_GRN, C_CYN, C_BOLD, C_NC = "\033[0;31m", "\033[0;32m", "\033[0;36m", "\033[1m", "\033[0m"


def log(msg: str) -> None:
    print(f"{C_CYN}[publish]{C_NC} {msg}")


def ok(msg: str) -> None:
    print(f"{C_GRN}[publish]{C_NC} {msg}")


def warn(msg: str) -> None:
    print(f"{C_RED}[publish]{C_NC} warning: {msg}", file=sys.stderr)


def die(code: int, msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"{C_RED}[publish]{C_NC} {msg}", file=sys.stderr)
    sys.exit(code)


def _included(rel: Path) -> bool:
    if any(part in EXCLUDE_DIRS for part in rel.parts):
        return False
    if rel.name in EXCLUDE_NAMES:
        return False
    if rel.name.endswith(EXCLUDE_SUFFIXES):
        return False
    # kit.json is injected at the root from the manifest, never taken from src/.
    if rel.as_posix() == "kit.json":
        return False
    return True


def load_manifest(kit_root: Path, explicit: Path | None) -> tuple[dict, Path]:
    """Return (manifest dict, source path). Prefer registry-entry.json — it is
    already the registry-schema shape the upload validates against."""
    candidates = []
    if explicit:
        candidates = [explicit]
    else:
        candidates = [kit_root / "registry-entry.json", kit_root / "kit.json"]
    for c in candidates:
        if c.is_file():
            try:
                return json.loads(c.read_text()), c
            except json.JSONDecodeError as e:
                die(2, f"{c} is not valid JSON: {e}")
    die(2, f"no manifest found (looked for {', '.join(str(c) for c in candidates)})")


def build_upload_manifest(raw: dict, source: Path) -> dict:
    """Normalize a kit manifest into the registry shape the server expects.

    `id` comes from `id` (registry-entry.json) or `name` (kit.json, whose name
    IS the id). Missing `tags` are synthesized from `category` so the schema's
    required `tags` is satisfied. download_url/sha256 are left to the server."""
    m = dict(raw)
    kit_id = m.get("id") or m.get("name") or ""
    if not KIT_ID_RE.match(str(kit_id)):
        die(2, f"kit id '{kit_id}' is invalid — must match {KIT_ID_RE.pattern} "
               f"(source: {source.name}; kit.json uses 'name' as the id, "
               f"registry-entry.json uses 'id')")
    version = str(m.get("version") or "")
    if not VERSION_RE.match(version):
        die(2, f"version '{version}' is invalid — must match {VERSION_RE.pattern}")

    m["id"] = str(kit_id)
    # If the source was kit.json, 'name' held the id; give the registry a real
    # display name only if one isn't already distinct. Keep author intent otherwise.
    m.setdefault("name", str(kit_id))
    if not m.get("name"):
        m["name"] = str(kit_id)
    if not m.get("description"):
        warn("manifest has no 'description' — the registry entry will show empty")
        m["description"] = ""
    tags = m.get("tags")
    if not isinstance(tags, list) or not tags:
        derived = [m["category"]] if m.get("category") else ["kit"]
        warn(f"manifest has no 'tags' — defaulting to {derived}")
        m["tags"] = derived

    blob = json.dumps(m)
    if "{{" in blob:
        warn("manifest still contains {{PLACEHOLDER}} values — finish filling "
             "registry-entry.json before publishing a real kit")
    return m


def build_package(kit_root: Path, manifest: dict) -> tuple[bytes, int]:
    """Build the upload zip: src/ root-relative + kit.json at root. Returns
    (zip bytes, file count). Reproducible (sorted, fixed timestamps)."""
    src = kit_root / "src"
    if not src.is_dir():
        die(2, f"source directory not found: {src}")
    files = sorted(
        rel for rel in (p.relative_to(src) for p in src.rglob("*") if p.is_file())
        if _included(rel)
    )
    if Path("CLAUDE.md") not in files:
        die(2, "CLAUDE.md not found at src/ root — every kit must include it")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Manifest first, at the root, named kit.json.
        info = zipfile.ZipInfo("kit.json", date_time=FIXED_DATE)
        info.external_attr = 0o644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        zf.writestr(info, json.dumps(manifest, indent=2))
        for rel in files:
            info = zipfile.ZipInfo(rel.as_posix(), date_time=FIXED_DATE)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, (src / rel).read_bytes())
    return buf.getvalue(), len(files) + 1


def _request(method: str, url: str, *, data: bytes | None = None,
             headers: dict | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        die(6, f"cannot reach {url}: {e.reason}")


def _json_body(body: bytes) -> dict:
    try:
        return json.loads(body) if body else {}
    except json.JSONDecodeError:
        return {}


def login(base: str, email: str, password: str) -> str:
    log(f"Logging in as {email}…")
    status, body = _request(
        "POST", f"{base}/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json"},
    )
    j = _json_body(body)
    if status == 200 and j.get("accessToken"):
        ok("Authenticated")
        return j["accessToken"]
    if status == 401:
        die(3, "invalid email or password")
    if status == 403:
        die(3, "this account is disabled")
    if status == 503:
        die(3, "auth is not configured on this Astro instance")
    die(3, f"login failed ({status}): {j.get('message') or body[:300].decode(errors='replace')}")


def delete_version(base: str, token: str, kit_id: str, version: str) -> None:
    log(f"Removing existing {kit_id} v{version}…")
    status, body = _request(
        "DELETE", f"{base}/api/kit-packages/{quote(kit_id)}/versions/{quote(version)}",
        headers={"Authorization": f"Bearer {token}"},
    )
    if status in (204, 404):
        return
    if status == 403:
        die(4, "admin role required to replace a kit version")
    die(4, f"could not delete existing version ({status}): {body[:300].decode(errors='replace')}")


def upload(base: str, token: str, zip_bytes: bytes, note: str | None) -> tuple[int, dict]:
    qs = f"?note={quote(note)}" if note else ""
    status, body = _request(
        "POST", f"{base}/api/kit-packages{qs}", data=zip_bytes,
        headers={"Content-Type": "application/zip", "Authorization": f"Bearer {token}"},
    )
    return status, _json_body(body) if body else {}


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Package and publish a kit to a hosted Astro instance. "
                    "--base/--email/--password fall back to $ASTRO_BASE_URL / "
                    "$ASTRO_ADMIN_EMAIL / $ASTRO_ADMIN_PASSWORD so secrets need "
                    "not appear in argv.")
    ap.add_argument("--base", default=os.environ.get("ASTRO_BASE_URL"),
                    help="Astro instance base URL (e.g. https://astro.example.com); "
                         "env: ASTRO_BASE_URL")
    ap.add_argument("--email", default=os.environ.get("ASTRO_ADMIN_EMAIL"),
                    help="Admin email (env: ASTRO_ADMIN_EMAIL; required unless --dry-run)")
    ap.add_argument("--password", default=os.environ.get("ASTRO_ADMIN_PASSWORD"),
                    help="Admin password (env: ASTRO_ADMIN_PASSWORD; required unless --dry-run)")
    ap.add_argument("--kit-root", default=".", help="Kit repo root (default: current dir)")
    ap.add_argument("--manifest", help="Explicit manifest file (default: registry-entry.json, else kit.json)")
    ap.add_argument("--note", help="Free-text note stored on this uploaded version")
    ap.add_argument("--replace", action="store_true", help="If the id+version already exists, delete it then re-upload")
    ap.add_argument("--dry-run", action="store_true", help="Build the package and print a summary; do not upload")
    ap.add_argument("--out", help="Also write the built package to this path")
    args = ap.parse_args()

    if not args.base:
        die(2, "no Astro instance URL — pass --base or set $ASTRO_BASE_URL")
    base = args.base.rstrip("/")
    if not re.match(r"^https?://", base):
        base = "https://" + base

    kit_root = Path(args.kit_root).resolve()
    manifest_path = Path(args.manifest).resolve() if args.manifest else None
    raw, source = load_manifest(kit_root, manifest_path)
    manifest = build_upload_manifest(raw, source)

    log(f"Kit: {C_BOLD}{manifest['id']}{C_NC} v{manifest['version']}  (manifest: {source.name})")
    zip_bytes, count = build_package(kit_root, manifest)
    sha = hashlib.sha256(zip_bytes).hexdigest()
    ok(f"Package built — {count} files, {len(zip_bytes)} bytes, sha256 {sha[:12]}…")

    if args.out:
        Path(args.out).write_bytes(zip_bytes)
        log(f"Wrote package to {args.out}")

    if args.dry_run:
        ok("Dry run — not uploading.")
        return 0

    if not args.email or not args.password:
        die(2, "--email and --password are required to upload (or pass --dry-run)")

    token = login(base, args.email, args.password)

    log(f"Uploading to {base}/api/kit-packages …")
    status, j = upload(base, token, zip_bytes, args.note)

    if status == 409 and args.replace:
        delete_version(base, token, manifest["id"], manifest["version"])
        status, j = upload(base, token, zip_bytes, args.note)

    if status == 201:
        ok(f"Published {C_BOLD}{j.get('id')}{C_NC} v{j.get('version')}")
        print(f"    sha256:      {j.get('sha256')}")
        print(f"    size:        {j.get('sizeBytes')} bytes")
        print(f"    uploaded by: {j.get('uploadedByEmail')}  at {j.get('uploadedAt')}")
        if j.get("note"):
            print(f"    note:        {j.get('note')}")
        return 0
    if status == 409:
        die(5, f"kit '{manifest['id']}' v{manifest['version']} already exists — "
               f"bump the version in {source.name} (and re-run build_kit.sh) or re-run with --replace")
    if status == 422:
        drops = j.get("drops")
        detail = f"  drops: {json.dumps(drops)}" if drops else ""
        die(4, f"manifest v4 validation failed: {j.get('message') or 'invalid manifest'}{detail}")
    if status == 413:
        die(4, "package exceeds the 50 MB limit")
    if status == 403:
        die(4, "admin role required — this account cannot upload kits")
    if status == 400:
        die(4, "the server did not accept the package as a readable zip")
    if status == 503:
        die(6, "the hosted kit registry is not configured on this Astro instance")
    die(4, f"upload failed ({status}): {j.get('message') or json.dumps(j)[:300]}")


if __name__ == "__main__":
    sys.exit(main())
