# Benchmark task criteria (pre-registered)

The bar for this task. Observe from the project root; `npm test` runs the seed's own specs and is NOT sufficient evidence on its own.


### C1 [core] — the email input exists and is typed
- **Observe:** `renderForm()` contains one `<input>` with `type="email"` and `name="email"`, marked `required`.
- **Fails if:** it is missing, has another type, or is not required.

### C2 [core] — the input has an accessible name
- **Observe:** the email input has an `id`, and a `<label for="…">` with that same id and non-empty visible text exists in the output (or the input is wrapped in a `<label>` that has text).
- **Fails if:** the label is missing, empty, or points at a different id; a `placeholder` alone does not count.

### C3 [core] — autofill hint and valid ids
- **Observe:** the email input has `autocomplete="email"`; every `id` in the output is unique.
- **Fails if:** the autocomplete hint is missing or two elements share an id.

### C4 [suite] — the existing name field and the seed specs
- **Observe:** the name field is still present and labelled as before; `npm test` exits 0 with a non-zero test count.
- **Fails if:** the name field changed or any spec fails.
