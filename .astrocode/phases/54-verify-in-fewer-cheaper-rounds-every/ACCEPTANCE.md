# Acceptance: phase 54, verify in fewer, cheaper rounds

Check these in a scratch project (`ac init` in a fresh git repo under a temp dir), never against this repo's own `.astrocode/`
state. This phase's own CRITERIA.md carries no core/edge tags, so it cannot exercise deferral.

**Shared precondition, called "a tagged phase" below:**
- an astro-code project with one phase whose committed CRITERIA.md holds five criteria:
  - C1 untagged, with a `- **Cheap:** \`node -e "process.exit(0)"\`` line;
  - `### C2 [edge] — …`, naming `src/a.mjs` in backticks;
  - `### C3 [core] — …`;
  - C4 untagged;
  - `### C5 [suite] — …`, with the project's test command;
- a `PLAN.md` committed after CRITERIA.md;
- a clean tree.

- [ ] **The user can defer a failed edge criterion at a FAIL, and only that one.**
  *Precondition:* a tagged phase with a recorded FAIL (`ac verdict record`) in which C2, C3, C4 and C5 are unmet. Each
  failed entry carries a failing command and its output.
  *Check:*
  - The record output names C2, and only C2, as deferrable.
  - `ac verdict defer <n> C2` opens a fix. `ac fix list` shows it as deferred from C2, and `ac fix show <id>` holds the
    failing command and output.
  - `ac verdict defer <n> C3`, then `C4`, then `C5` each refuse with a reason and change nothing.

- [ ] **The user can verify and accept a phase with its edge failure deferred, and sees the open fix everywhere it
  matters.**
  *Precondition:* the state after the previous item, plus a new verdict in which C1, C3, C4 and C5 pass.
  *Check:*
  - `ac phase verify <n>` marks the phase verified.
  - `ac phase show <n>`, `ac status`, the phase band and `/astro-accept <n>` each name the open deferred fix.
  - `ac milestone complete` refuses and names the fix, even with `--force`.
  - After `ac fix accept <id>`, `ac milestone complete` no longer refuses on that account.

- [ ] **The user can see a cheap first check stop a doomed verify early and list every gap at once.**
  *Precondition:* a tagged phase where two criteria have `Cheap:` commands that exit 1.
  *Check:*
  - `ac verdict cheap <n>` exits non-zero and names both criteria.
  - `ac verdict history <n>` shows that run with both ids unmet.
  - `/astro-verify <n>` reports the FAIL without spawning the full verifier.

- [ ] **The user can see an unsupported "broad fix" claim refused, with the reason.**
  *Precondition:* a tagged phase with a FAIL on file and one later commit touching only `src/a.mjs`.
  *Check:*
  - `ac verdict plan <n> --broad-files README.md` stays narrowed and says why.
  - `ac verdict plan <n> --broad-files src/a.mjs` turns full.

- [ ] **The user can read a phase's verdict history and see a flip-flopping criterion flagged.**
  *Precondition:* a tagged phase with a recorded full PASS at one commit, then a FAIL with C2 unmet at a later commit
  that does not touch `src/a.mjs`.
  *Check:*
  - `ac verdict history <n>` lists both runs oldest-first, with status, commit and unmet ids.
  - The FAIL's record output and `ac verdict show <n>` mark C2 as previously passing with its files unchanged.
  - The recorded status and unmet list are the same as without the flag.

- [ ] **The user can declare an expensive setup step once and have it reused on the same commit.**
  *Precondition:* a scratch project with `ac config set setup.steps.build '{"command":"echo run >> /tmp/<scratch>/count && echo ok > $AC_SETUP_OUT/bin"}'`.
  *Check:*
  - `ac setup run build` twice runs the command once and reports a reuse the second time.
  - `--commit HEAD~1` runs it again.
  - `git status` shows nothing new.

- [ ] **The user can watch remediation start while the verifier is still checking, without the verifier seeing a moving
  tree.**
  *Precondition:* a project with `use_worktrees` on (the default) and a phase with at least four criteria, one of them
  failing, run through `/astro-execute <n>` at standard effort.
  *Check:*
  - The run log shows `remediate:` starting before the second verifier group finishes.
  - The remediation commit lands only after the verdict line (`verdict run N saved`).
  - With `ac config set use_worktrees false`, remediation starts only after the verdict.
