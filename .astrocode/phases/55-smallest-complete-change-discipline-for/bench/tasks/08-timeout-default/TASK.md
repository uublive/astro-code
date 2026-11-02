# Task 08

`src/settings.mjs` exports `loadSettings(env)`, which returns `{ host, port }` from an environment object. Add `timeoutMs`: it defaults to `5000`, and the `TIMEOUT_MS` environment variable overrides it. A `TIMEOUT_MS` that is not a positive whole number (text, zero, negative, fractional or empty) must not produce `NaN` or a bad value: fall back to the default. Keep the existing fields and specs unchanged.
