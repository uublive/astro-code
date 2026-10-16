# Acceptance — phase 45: targeted re-verify after a FAIL

Run these in a scratch project:
- `mktemp -d`, `git init`, `ac init`, `ac phase add "Demo"`;
- a `CRITERIA.md` with 9 criteria, `### C1 — …` to `### C9 — …`, in that phase folder;
- one commit.

Use `ac` from this branch.

1. **A FAIL leaves a saved, committed verdict.**
   - You can run `ac verdict record 1 --result '{"mode":"full","criteria":[…C3 and C7 false, the rest true…]}'`.
   - You then see `.astrocode/phases/<slug>/VERDICT.json` beside CRITERIA.md, already committed.
     It lists all 9 criteria with passed or failed, the commit, a `sha256:` fingerprint, the
     mode `full`, and a timestamp.
   - *Precondition:* the scratch project above, with no VERDICT.json yet.

2. **The next re-verify narrows to what failed.**
   - After one more commit that leaves CRITERIA.md untouched, you can run
     `ac verdict plan 1`.
   - You see one line saying narrowed, re-check C3, C7 first, citing run 1 and its commit.
   - With `--full`, the line says full.
   - *Precondition:* item 1's saved FAIL verdict ({C3, C7} failed), plus one later commit.

3. **The automatic fallbacks force a full run.**
   - Starting from item 2's state, you can do any one of these:
     - edit one character of CRITERIA.md;
     - record a FAIL with 4 criteria unmet;
     - check out a branch from before the verdict's commit and commit there;
     - overwrite the verdict file with garbage, with canon-guard off.
   - Each time, `ac verdict plan 1` says full, with a one-line reason, and nothing crashes.
   - *Precondition:* item 2's narrowable state, restored before each variant.

4. **No phase reaches `verified` on carried or partial evidence.**
   - After recording a narrowed verdict (one that carries the criteria it did not re-check), you
     can run `ac phase verify 1`. It refuses with the reason, and `ac phase show 1` is still not
     `verified`.
   - After recording a full verdict with all 9 passed, the same command succeeds.
   - A phase without CRITERIA.md still verifies as before.
   - *Precondition:*
     - a phase whose latest VERDICT.json is narrowed, with criteria carried from run 1;
     - then one with a full all-passed verdict;
     - plus a second phase with no CRITERIA.md.

5. **A hand-run `/astro-verify` narrows, and a pass costs one run.**
   - In a real astro-code project with a phase that failed verification on 1–2 criteria and
     then got a fix commit, you can run `/astro-verify <n>`.
   - The verifier checks those criteria first.
     - If one is still unmet, the FAIL lists every previously unmet criterion, plus one line
       counting the carried ones (with run and commit).
     - If they now pass, the same single verifier run goes on to all criteria and marks the
       phase verified.
   - `/astro-verify <n> --full` always checks everything.
   - *Precondition:* a phase with a CRITERIA.md and a committed FAIL VERDICT.json recorded by
     this branch's `ac`, plus one fix commit since.

6. **Hand edits of the verdict are blocked.**
   - With `ac mods enable canon-guard`, you can ask the assistant to edit
     `.astrocode/phases/<slug>/VERDICT.json` directly, or to `echo {} >` into it. It is denied,
     and the message names `ac verdict record`.
   - Editing a scratch note in the same folder is not blocked.
   - *Precondition:* canon-guard enabled; a phase folder holding a VERDICT.json and CRITERIA.md.
