# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — valid ports still parse
- **Observe:** import `parsePort` from `src/config.mjs`. `parsePort('8080')` is `8080`, `parsePort(' 443 ')` is `443`, `parsePort('1')` is `1`, `parsePort('65535')` is `65535`.
- **Fails if:** any of those returns something else or throws.

### C2 [core] — invalid ports throw RangeError
- **Observe:** call `parsePort` with `'abc'`, `''`, `'0'`, `'65536'`, `'-1'`, `'80.5'`, `'8080x'` and `'1e3'`.
- **Fails if:** any call returns a value, returns `NaN`, or throws something that is not a `RangeError`.

### C3 [suite] — the seed specs pass
- **Observe:** `npm test` in the project root exits 0 with a non-zero test count.
- **Fails if:** any spec fails or none run.
