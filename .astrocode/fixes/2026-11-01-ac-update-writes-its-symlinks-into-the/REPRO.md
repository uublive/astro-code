# Reproduction

Test: `tests/fix_install_other_checkout.test.mjs`
Run: `node --test tests/fix_install_other_checkout.test.mjs`

Setup: a second astro-code checkout (`package.json` name `astro-code`, `bin/ac.mjs`, real
`commands/astro-status.md` and `agents/astro-executor.md`); a config dir whose `commands/` and
`agents/` are symlinks into it; `installClaude(<this repo>)`.

Observed before the fix:

    not ok 1 - install never writes into a config subdir that is another astro-code checkout
      error: 'the dev checkout command stays a regular file'

i.e. `symlinkInto` rmSync'd the checkout's tracked file and replaced it with a link into
`~/.astro/code` — exactly the typechange wall seen in /Users/buu/Development/astro-code.
