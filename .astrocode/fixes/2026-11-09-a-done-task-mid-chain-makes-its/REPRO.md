# Reproduction

`node --test tests/fix_waves_done_mid_chain.test.mjs` — the issue's 38-task chain (rb1, rb2, rb17, rb19
done) through the real `buildWaves`. Before the fix: `not ok 1` (first wave rb3, rb18, rb20). After: every
wave holds one task, in chain order; the other two cases (all-done head; no done map = old behaviour) pass.
