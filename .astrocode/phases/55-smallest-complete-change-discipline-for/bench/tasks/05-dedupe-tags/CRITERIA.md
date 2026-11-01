# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — case-insensitive de-duplication keeps the first spelling and order
- **Observe:** `normalizeTags(['Node','go','node','GO','Rust'])` is `['Node','go','Rust']`.
- **Fails if:** the result differs in content, spelling or order.

### C2 [core] — trimming and empties
- **Observe:** `normalizeTags(['  a ','','  ','A','b'])` is `['a','b']`; `normalizeTags([])` is `[]`.
- **Fails if:** the result differs.

### C3 [core] — the input is not mutated and non-arrays are rejected
- **Observe:** call it on an array and compare before/after; call `normalizeTags(undefined)` and `normalizeTags('a,b')`.
- **Fails if:** the input array changed, or a non-array input returns a value instead of throwing a `TypeError`.

### C4 [suite] — the seed specs pass
- **Observe:** `npm test` exits 0 with a non-zero test count.
- **Fails if:** any spec fails or none run.
