# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — returns exactly the last n items
- **Observe:** `lastN([1,2,3,4], 2)` is `[3,4]`; `lastN([1,2,3,4], 1)` is `[4]`; `lastN([1,2,3,4], 4)` is `[1,2,3,4]`.
- **Fails if:** any result differs.

### C2 [core] — the edges
- **Observe:** `lastN([1,2,3], 0)` is `[]`; `lastN([1,2,3], 10)` is `[1,2,3]`; `lastN([], 3)` is `[]`.
- **Fails if:** any result differs.

### C3 [core] — the input is not mutated
- **Observe:** call `lastN` on an array and compare the array before and after.
- **Fails if:** the input array changed.

### C4 [suite] — the seed specs pass
- **Observe:** `npm test` exits 0 with a non-zero test count.
- **Fails if:** any spec fails or none run.
