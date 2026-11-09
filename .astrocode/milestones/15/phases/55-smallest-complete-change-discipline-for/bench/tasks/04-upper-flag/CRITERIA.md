# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — the flag upper-cases the greeting
- **Observe:** `run(['--name','ada'])` is `Hello, ada!` as before; `run(['--name','ada','--upper'])` is `HELLO, ADA!`; `run(['--upper','--name','ada'])` is also `HELLO, ADA!`.
- **Fails if:** any result differs.

### C2 [core] — defaults and help
- **Observe:** `run([])` is `Hello, world!`; `run(['--upper'])` is `HELLO, WORLD!`; `run(['--help'])` mentions `--upper` as well as `--name`.
- **Fails if:** any result differs or the help does not list `--upper`.

### C3 [suite] — the seed specs pass
- **Observe:** `npm test` exits 0 with a non-zero test count.
- **Fails if:** any spec fails or none run.
