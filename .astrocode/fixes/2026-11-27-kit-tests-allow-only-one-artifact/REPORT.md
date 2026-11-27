Request from envirotech-fuel-surcharge-d8, approved by Matteo (27 Nov): please allow MORE THAN ONE kit.json artifact tagged `email_attachment`. Halo 0.8.3 already attaches every tagged artifact by literal path (astro-port confirmed), but the kit template still allows only one.

Use case: the FSC kit attaches the sign-off pack AND a fixed-name monthly PDF (_report/fsc_monthly.pdf).

## Fix

- validate_manifest.py `check_email_attachment_invariant` (M-02) and kit_test.py R-12: 0..N artifacts may carry the
  tag; each tagged path must be literal (no `*`/`?`/`[ ]` glob, no `{x}`/`{{x}}`/`<x>`/`$X` placeholder) and no
  two tagged artifacts may share a path. Every other check is unchanged.
- KIT-CONTRACT.md §outputs.artifacts, commands/astro-kit-new.md, commands/astro-kit-convert.md and the v4 schema
  descriptions say 0..N instead of at most one.

## Verification

- `tests/kit_email_attachments.test.mjs` (5 cases, both tools): the FSC two-attachment case failed before, passes
  after; duplicate, glob and placeholder paths fail; an untagged glob artifact is not judged by this rule.
- Kit, command and contract tests: 291 pass, 0 fail.
