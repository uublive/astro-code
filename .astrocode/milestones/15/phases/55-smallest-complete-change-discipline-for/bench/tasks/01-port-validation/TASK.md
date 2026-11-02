# Task 01

`src/config.mjs` exports `parsePort(text)`, which turns the PORT environment text into a number. Today it returns `NaN` or nonsense for bad input, and the server then listens on a garbage port. Make `parsePort` accept only whole-number ports from 1 to 65535 (surrounding whitespace is allowed) and throw a `RangeError` for anything else. Keep the existing specs passing.
