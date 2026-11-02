# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — the default and the override
- **Observe:** `loadSettings({}).timeoutMs` is `5000`; `loadSettings({TIMEOUT_MS: '250'}).timeoutMs` is `250`.
- **Fails if:** either differs, or the value is a string.

### C2 [core] — bad values fall back to the default
- **Observe:** `loadSettings({TIMEOUT_MS: v}).timeoutMs` for `v` in `'abc'`, `''`, `'0'`, `'-5'`, `'1.5'`, `'NaN'`.
- **Fails if:** any result is not `5000`, is `NaN`, or the call throws.

### C3 [core] — existing fields are unchanged
- **Observe:** `loadSettings({}).host` is `'localhost'` and `.port` is `3000`; `loadSettings({HOST: 'h', PORT: '81'})` gives host `'h'`, port `81`.
- **Fails if:** any differs.

### C4 [suite] — the seed specs pass
- **Observe:** `npm test` exits 0 with a non-zero test count.
- **Fails if:** any spec fails or none run.
