# Task 06

`src/list.mjs` exports `listItems(items)`, which returns every item. Add a named export `page(items, { page = 1, perPage = 10 } = {})` that returns `{ items, page, perPage, total, totalPages }` for the requested page (1-based). `page` and `perPage` must be positive integers; otherwise throw a `RangeError`. A page past the end returns an empty `items` list, not an error. Keep `listItems` and the existing specs unchanged.
