# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — pages slice correctly and report totals
- **Observe:** for `items = [1..25]`: `page(items)` has items `[1..10]`, `page: 1`, `perPage: 10`, `total: 25`, `totalPages: 3`; `page(items, {page: 3})` has items `[21..25]`; `page(items, {page: 2, perPage: 5})` has items `[6..10]` and `totalPages: 5`.
- **Fails if:** any field differs.

### C2 [core] — past the end and empty input
- **Observe:** `page(items, {page: 4})` has `items: []` and does not throw; `page([])` has `total: 0`, `totalPages: 0`, `items: []`.
- **Fails if:** it throws or any field differs.

### C3 [core] — invalid paging throws RangeError
- **Observe:** call `page(items, {page: 0})`, `{page: -1}`, `{page: 1.5}`, `{perPage: 0}`, `{perPage: -5}`, `{perPage: 'x'}` and `{page: NaN}`.
- **Fails if:** any call returns or throws something other than a `RangeError`.

### C4 [suite] — `listItems` and the seed specs
- **Observe:** `npm test` exits 0 with a non-zero test count, and `listItems` still returns every item.
- **Fails if:** any spec fails, none run, or `listItems` changed behavior.
