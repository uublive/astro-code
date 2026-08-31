#!/usr/bin/env python3
"""kit_run_local.py — Tier 2: run THIS kit against a local Astro, without
publishing it anywhere.

Tier 1 (kit_test.py) proves a kit is well-formed. It cannot prove the kit
works. This does: it stands up a one-kit registry on localhost, seeds the kit
straight from `src/`, and hands the whole thing to a local Astro agent — the
same registry fetch, the same UseKit load, the same recipe discovery the
hosted instance performs.

How it works (all four hooks already exist in astro; none are test-only):

  1. `ASTROKIT_REGISTRY_URL` has no default and points anywhere, so a
     `kits.json` served from a temp dir IS a registry. `registry-entry.json`
     is already exactly one v4 entry, so the registry is that file in a list.
  2. `UseKit load` skips the download when the kit dir already exists
     (it probes for CLAUDE.md / recipes/), so a seeded working copy is used
     in place and `download_url` is never fetched.
  3. `ASTRO_KIT_BASE_DIR` overrides the container-only `/workspace/.kits`.
  4. The agent CLI runs locally: `npm run dev -- "<task>" --dir <workdir>`.

## Invocation

    # set up + verify the kit resolves and loads, print the run command:
    python3 tools/kit_run_local.py --astro-root ~/Development/astro

    # ...and actually run the agent (spends API tokens — opt in explicitly):
    python3 tools/kit_run_local.py --astro-root ~/Development/astro --execute \
        --task "summarize these commits: fixtures/commits.json"

`--astro-root` may also come from $ASTRO_ROOT.

## Exit codes

    0  the kit resolved and loaded (and, with --execute, every declared phase
       output was produced)
    1  the kit failed to resolve/load, or a phase produced none of its outputs
    2  usage / environment error (no astro checkout, no registry-entry.json)
"""

from __future__ import annotations

import sys

if sys.version_info < (3, 10):
    print(
        f"error: Python 3.10+ required, got "
        f"{sys.version_info.major}.{sys.version_info.minor}",
        file=sys.stderr,
    )
    sys.exit(2)

import argparse
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from kit_test import load_recipe, RecipeParseError  # reuse the recipe reader
except ImportError:  # pragma: no cover - kit_test.py should sit beside us
    load_recipe = None
    RecipeParseError = Exception


PROBE = r'''
import { fetchKitRegistry, findKitById, getKitDir, loadKitInstructions } from "%(astro)s/apps/astro/src/kits/registry.js";
import { KIT_BASE_DIR } from "%(astro)s/apps/astro/src/kits/kit-base-dir.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const want = %(kit)s;
const out = { base: KIT_BASE_DIR, ok: false, steps: [] };
const reg = await fetchKitRegistry();
out.steps.push(["registry", `${reg.kits.length} kit(s): ${reg.kits.map(k => k.id).join(", ") || "-"}`]);
const kit = reg.kits.length ? findKitById(want, reg.kits) : null;
if (!kit) { out.steps.push(["resolve", `FAILED: "${want}" not in the local registry`]); console.log(JSON.stringify(out)); process.exit(1); }
out.steps.push(["resolve", `${kit.id} v${kit.version}`]);
const dir = getKitDir(kit.id);
const seeded = existsSync(join(dir, "CLAUDE.md")) || existsSync(join(dir, "recipes"));
out.steps.push(["seed", seeded ? `${dir} (download skipped)` : `FAILED: ${dir} not seeded`]);
if (!seeded) { console.log(JSON.stringify(out)); process.exit(1); }
const inst = await loadKitInstructions(kit.id, dir);
out.steps.push(["CLAUDE.md", inst.claudeMd ? `${inst.claudeMd.length} chars` : "FAILED: missing"]);
out.steps.push(["EXAMPLES.md", inst.examplesMd ? `${inst.examplesMd.length} chars` : "absent"]);
out.steps.push(["recipes", `${inst.recipes.length} discovered`]);
out.ok = Boolean(inst.claudeMd) && inst.recipes.length > 0;
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);
'''


def die(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):  # noqa: D102 - silence the access log
        pass


def serve(directory: Path) -> tuple[socketserver.TCPServer, int]:
    port = free_port()
    handler = lambda *a, **kw: _QuietHandler(*a, directory=str(directory), **kw)  # noqa: E731
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def declared_outputs(kit_root: Path) -> list[tuple[str, list[str]]]:
    """[(phase_name, [output, ...])] across every recipe — what a real run
    must produce for the recipe executor to consider each phase complete."""
    if load_recipe is None:
        return []
    found: list[tuple[str, list[str]]] = []
    for rp in sorted((kit_root / "src" / "recipes").glob("*.yaml")):
        try:
            recipe, _ = load_recipe(rp)
        except Exception:
            continue
        for ph in recipe.get("phases") or []:
            if isinstance(ph, dict):
                found.append((str(ph.get("name", "?")), [str(o) for o in (ph.get("output") or [])]))
    return found


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="kit_run_local.py",
        description="Tier 2 — run this kit against a local Astro, without publishing.",
    )
    ap.add_argument("--kit-root", default=".", help="kit root (default: cwd)")
    ap.add_argument("--astro-root", default=os.environ.get("ASTRO_ROOT", ""),
                    help="path to the astro checkout (or $ASTRO_ROOT)")
    ap.add_argument("--execute", action="store_true",
                    help="actually invoke the agent — SPENDS API TOKENS")
    ap.add_argument("--serve", action="store_true",
                    help="hold the local registry up and block, so you can drive the agent yourself")
    ap.add_argument("--task", default="",
                    help="the prompt to run (required with --execute)")
    ap.add_argument("--workdir", default="",
                    help="agent working dir (default: a temp dir, kept on failure)")
    ap.add_argument("--keep", action="store_true", help="keep the scratch dirs")
    args = ap.parse_args()

    kit_root = Path(args.kit_root).resolve()
    entry_path = kit_root / "registry-entry.json"
    if not entry_path.is_file():
        die(f"no registry-entry.json at {kit_root} — run from the kit root (build_kit.sh creates it)")
    if not args.astro_root:
        die("no astro checkout: pass --astro-root or set $ASTRO_ROOT")
    astro = Path(args.astro_root).expanduser().resolve()
    if not (astro / "apps/astro/src/kits/registry.ts").is_file():
        die(f"{astro} does not look like the astro checkout")
    if not (astro / "apps/astro/src/kits/kit-base-dir.ts").is_file():
        die(f"{astro} predates ASTRO_KIT_BASE_DIR — update the astro checkout "
            "(kits/kit-base-dir.ts is required for local kit runs)")
    if args.execute and not args.task:
        die("--execute needs --task \"<prompt>\" (try the Quick Start prompt from src/EXAMPLES.md)")

    entry = json.loads(entry_path.read_text(encoding="utf-8"))
    kit_id = entry.get("id") or entry.get("name")
    if not kit_id:
        die("registry-entry.json has no id")

    scratch = Path(tempfile.mkdtemp(prefix=f"kit-local-{kit_id}-"))
    reg_dir = scratch / "registry"
    base_dir = scratch / "kits"
    reg_dir.mkdir(parents=True)
    (base_dir / kit_id).mkdir(parents=True)

    # 1. one-kit registry, straight from the entry the build already emits
    (reg_dir / "kits.json").write_text(json.dumps({"schema_version": 4, "kits": [entry]}, indent=2))
    # 2. seed the kit from src/ — this is what makes UseKit skip the download
    shutil.copytree(kit_root / "src", base_dir / kit_id, dirs_exist_ok=True)

    httpd, port = serve(reg_dir)
    reg_url = f"http://127.0.0.1:{port}/kits.json"
    env = {
        **os.environ,
        "ASTROKIT_REGISTRY_URL": reg_url,
        "ASTRO_KIT_BASE_DIR": str(base_dir),
    }

    print(f"kit          {kit_id} v{entry.get('version', '?')}")
    print(f"registry     {reg_url}")
    print(f"kit base     {base_dir}")
    print(f"astro        {astro}")
    print()

    rc = 0
    try:
        # 3. verify astro itself resolves + loads the kit (real modules)
        probe = scratch / "probe.mts"
        probe.write_text(PROBE % {"astro": astro, "kit": json.dumps(kit_id)})
        res = subprocess.run(
            ["npx", "tsx", str(probe)],
            cwd=str(astro), env=env, capture_output=True, text=True,
        )
        payload = None
        for line in (res.stdout or "").splitlines():
            line = line.strip()
            if line.startswith("{"):
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    pass
        if payload is None:
            print("  ✗ probe produced no result", file=sys.stderr)
            print((res.stderr or res.stdout or "").strip()[-2000:], file=sys.stderr)
            return 1
        for name, detail in payload.get("steps", []):
            mark = "✗" if str(detail).startswith("FAILED") else "✓"
            print(f"  {mark} {name:<12} {detail}")
        if not payload.get("ok"):
            print("\n  Tier 2 FAILED at load — astro could not use this kit.")
            return 1
        print("\n  ✓ astro resolved and loaded the kit without it being published.")

        if args.serve:
            # Hold the registry up so the user can drive the agent themselves
            # from another terminal. The server dies with this process, so the
            # env below is only valid while this is running — which is exactly
            # why this mode blocks instead of printing and exiting.
            args.keep = True
            work = args.workdir or "<a scratch dir>"
            print()
            print("  Registry is UP and will stay up until you Ctrl-C this process.")
            print("  In another terminal:")
            print()
            print(f"    cd {astro} && \\")
            print(f"      ASTROKIT_REGISTRY_URL={reg_url} \\")
            print(f"      ASTRO_KIT_BASE_DIR={base_dir} \\")
            print(f"      npm run dev -- \"kit:{kit_id} <your task>\" --dir {work}")
            print()
            print("  Edits to src/ are NOT picked up automatically — re-run this to reseed.")
            try:
                threading.Event().wait()
            except KeyboardInterrupt:
                print("\n  stopped.")
            return 0

        if not args.execute:
            print()
            print("  Set up only — no agent was run (that spends API tokens).")
            print("  The local registry has already been torn down.")
            print()
            print("  To run the agent for real:")
            print()
            print(f"    python3 tools/kit_run_local.py --astro-root {astro} \\")
            print('        --execute --task "<the Quick Start prompt from src/EXAMPLES.md>"')
            print()
            print("  To drive the agent yourself, hold the registry up instead:")
            print()
            print(f"    python3 tools/kit_run_local.py --astro-root {astro} --serve")
            return 0

        # 4. real run
        work = Path(args.workdir).resolve() if args.workdir else (scratch / "work")
        work.mkdir(parents=True, exist_ok=True)
        print(f"\n  running agent in {work} …\n")
        run = subprocess.run(
            ["npm", "run", "dev", "--", f"kit:{kit_id} {args.task}", "--dir", str(work)],
            cwd=str(astro), env=env, text=True,
        )
        print()
        if run.returncode != 0:
            print(f"  ✗ agent exited {run.returncode}")
            rc = 1

        # 5. the assertion that matters: did each phase produce its outputs?
        phases = declared_outputs(kit_root)
        if not phases:
            print("  ! no recipe outputs to check (recipe unreadable)")
        else:
            print("  declared phase outputs:")
            for phase, outs in phases:
                for o in outs:
                    hit = (work / o).exists()
                    print(f"    {'✓' if hit else '✗'} {phase:<20} {o}")
                    if not hit:
                        rc = 1
        print()
        print("  Tier 2 " + ("PASSED" if rc == 0 else "FAILED"))
        if rc:
            print(f"  workdir kept for inspection: {work}")
            args.keep = True
    finally:
        httpd.shutdown()
        if args.keep:
            print(f"  scratch kept: {scratch}")
        else:
            shutil.rmtree(scratch, ignore_errors=True)

    return rc


if __name__ == "__main__":
    sys.exit(main())
