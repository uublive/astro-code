# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — a successful save writes the new value and leaves nothing behind
- **Observe:** in a scratch directory call `saveJson` on a new path and again on the same path with a different value. Read the file back with `JSON.parse`. List the directory.
- **Fails if:** the content is not the latest value, or any extra file (a temp or backup file) is left in the directory.

### C2 [core] — the previous contents survive a failed save
- **Observe:** save `{ok: 1}`, then call `saveJson` with a value that cannot be serialized (a circular object). Catch the error. Read the file back.
- **Fails if:** the call does not throw, the file no longer holds `{ok: 1}`, or a temp file is left behind.

### C3 [core] — the target is never opened for truncation
- **Observe:** read `src/store.mjs`. The data is written to a different path in the same directory and then renamed over the target (or an equivalent that never truncates the target before the new bytes are complete).
- **Fails if:** the target path is opened or written directly with the new data.

### C4 [suite] — the seed specs pass
- **Observe:** `npm test` exits 0 with a non-zero test count.
- **Fails if:** any spec fails or none run.
