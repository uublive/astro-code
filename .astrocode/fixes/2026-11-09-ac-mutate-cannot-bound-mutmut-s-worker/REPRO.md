# Reproduction

`node --test tests/fix_mutmut_max_children.test.mjs` (stub mutmut logging its argv): with
`mutation.max_children` set, the `run` argv carried no `--max-children` (both tests failed). After: `run
--max-children 3`, the phase key (2) beats the project key, an invalid value warns and passes nothing, and
mutmut 2 warns that the key does not apply. A real many-core run is not reproduced here (no mutmut on this
machine); the flag itself is checked against the captured real mutmut 3.8 help.
