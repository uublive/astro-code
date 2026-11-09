# Task 02

`src/store.mjs` exports `saveJson(file, value)`, which writes a JSON file. A crash or full disk in the middle of a write currently leaves a truncated file and the previous data is lost. Change `saveJson` so that a failed or interrupted save never destroys the previous contents of `file`. Keep the existing specs passing.
