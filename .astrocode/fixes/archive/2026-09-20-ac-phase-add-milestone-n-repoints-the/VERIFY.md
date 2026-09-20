# Verification

## The reproduction test now passes

`node --test tests/phase_milestone.test.mjs` — **9 / 9 pass** (8 of 9 failed at HEAD
before the change; see REPRO.md).

## The full suite is green

`npm test` — **699 / 699 pass, 0 fail**. It was 690/690 before this fix; the 9 added are
this file. No pre-existing failures, and none introduced.

## End-to-end, the reporter's exact sequence

Real project, real bare-remote registry, `ac` driven as a subprocess:

```console
$ ac phase add "alpha"
✓ phase 1 "alpha" (milestone 1) [registry: astro-registry]

$ ac phase add "beta" --milestone 3
✓ phase 2 "beta" (milestone 3) [registry: astro-registry]
  scheduled for milestone 3 — the project stays on milestone 1

$ ac status | head -3
Milestone: 1                      # ← was 3 before the fix

$ ac phase milestone 2            # read
3
$ ac phase milestone 2 2          # correct
✓ phase 2 "beta" → milestone 2
  the project's active milestone is unchanged — use `ac milestone new` to move it

$ ac status | head -3
Milestone: 1                      # ← correcting a phase moves only the phase

$ ac phase milestone 2 zero
✖ milestone must be a positive integer, got "zero"   (exit 1, nothing written)
```

## Reported publicly

Replied on the issue with the confirmed cause, the correction to the reporter's
`debt pay` diagnosis, what landed and what was deliberately declined:
https://github.com/uublive/astro-code/issues/16#issuecomment-5750659972 — issue labelled
`bug` and left **open** until the fix is released.
