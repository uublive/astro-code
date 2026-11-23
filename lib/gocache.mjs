// The private Go build cache of a mutation run (phase 59, ADR-096).
//
// Why: every mutant is a recompile, so a Gremlins run leaves a huge pile in the user's `go-build`
// cache (89 GB measured; the linker alone wrote 34 GB in 11 minutes). A mutation run therefore gets
// its own `GOCACHE` at `<home>/gocache`, kept between runs so warm builds survive, and size-capped
// (`heavy.go_cache_max_mb`, default 5120). `GOMODCACHE` and `GOPATH` stay the user's own, so
// dependencies are never downloaded twice.
//
// The trim evicts the OLDEST files first and stops as soon as the total is within the cap: a cache
// under its cap is never touched (a full wipe each run would make every run build from cold and slow
// an idle machine). Go refreshes the mtime of entries it uses, so mtime is the LRU signal. Symlinks
// are never followed (`lstat`), so a stray link cannot lead the trim outside the cache.
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';

export const DEFAULT_GO_CACHE_MB = 5120;

export function goCacheDir(home) {
  return join(home, 'gocache');
}

export function goCacheMaxMb(root, warnings = []) {
  const raw = loadConfig(root)?.heavy?.go_cache_max_mb;
  if (raw === undefined) return DEFAULT_GO_CACHE_MB;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  warnings.push(`heavy.go_cache_max_mb "${raw}" is not a number > 0 — ignored`);
  return DEFAULT_GO_CACHE_MB;
}

function walk(dir, out) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const p = join(dir, name);
    let st;
    try { st = lstatSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
  }
}

export function trimGoCache(dir, maxBytes) {
  const files = [];
  walk(dir, files);
  const before = files.reduce((s, f) => s + f.size, 0);
  let total = before;
  let evicted = 0;
  let evictedBytes = 0;
  if (total > maxBytes) {
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (total <= maxBytes) break;
      try { rmSync(f.path, { force: true }); } catch { continue; }
      total -= f.size;
      evicted += 1;
      evictedBytes += f.size;
    }
  }
  return { before_bytes: before, after_bytes: total, evicted, evicted_bytes: evictedBytes };
}
