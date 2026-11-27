# Reproduction

`node --test tests/kit_test_optional_outputs.test.mjs` builds scratch kits from the demo kit with a recipe whose
`answer` phase lists `_report/change_set.json` as `{path, optional: true}` and kit.json declaring it as an artifact.
Before the change: R-11/R-07 failures or parse errors on both parsers (11 of 13 cases fail); after: all pass.
