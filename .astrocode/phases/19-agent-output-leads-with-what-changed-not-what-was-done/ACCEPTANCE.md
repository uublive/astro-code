# Acceptance — Phase 19: Agent output leads with what changed, not what was done

User acceptance, not unit tests. Each item names the **precondition state** it assumes — the
state the repo or a scaffolded project must already be in for the item to be checkable
(ADR-050). If a precondition cannot be produced, the item is not passed by analogy.

- [ ] **The user can run `/astro-execute` on a phase and see the verdict first.**
      *Precondition:* a phase with a committed `PLAN.md` whose tasks are executable, run to a
      verdict (PASS or FAIL). The report opens with one line — PASS/FAIL and the cause — the
      next command follows, and the fold-ins (leaked refs, debt filed, fixture check, capture)
      are each at most the one line they promise, or absent. The per-criterion evidence is
      reachable (`/workflows`) but is not pasted into the chat.

- [ ] **The user can read `/astro-verify`'s FAIL and know what to do without scrolling.**
      *Precondition:* a phase with a pre-registered `CRITERIA.md` where at least one criterion
      genuinely does not hold, verified with `/astro-verify`. The failure is one line per unmet
      criterion plus where the verifier's full evidence can be found — and, on asking for it,
      that full evidence is still there in the verifier's return. Nothing was made shorter by
      producing less.

- [ ] **The user can open `.astrocode/CONVENTIONS.md` and get opposite answers for the two
      audiences.** *Precondition:* the repo at this phase's HEAD. Asking "how dense should a
      code comment be?" still answers *high, explanatory density*; asking "how should I write a
      report to a human?" answers *lead with the change, evidence short and beneath it*. Each
      answer names who it governs, and the rule says `PLAN.md` / `CRITERIA.md` stay dense.

- [ ] **The user can scaffold a fresh project and find the rule already in its own canon.**
      *Precondition:* an empty directory, `git init`, then `ac init --name <anything>` — a
      project with no prior `.astrocode/` and no connection to astro-code. Its
      `.astrocode/CONVENTIONS.md` has a `## Voice` section containing the actual rule (not a
      blank stem, not a `{{…}}` placeholder, not a pointer to astro-code), and its `AGENTS.md`
      carries the narration rule.

- [ ] **The user can delete a brevity instruction from a loop command and the suite catches
      it, by name.** *Precondition:* a clean checkout with `npm test` green. Removing the
      line-budget or silence wording from a reporting slot in any of
      `astro-{discuss,plan,execute,verify,accept,status,debt}.md` turns the suite red with a
      message naming that command and slot; `git checkout --` restores green.

- [ ] **The user can write more prose in a loop command without the suite objecting.**
      *Precondition:* the same clean, green checkout. Adding a few paragraphs of ordinary
      explanation to a loop command, while leaving every stated bound intact, keeps `npm test`
      at exit 0 — the phase enforces the shape of a slot, never how much anyone wrote.

- [ ] **The user can see where enforcement stops, stated rather than implied.**
      *Precondition:* the shipped text at HEAD — `.astrocode/CONVENTIONS.md`,
      `templates/CONVENTIONS.md`, both `AGENTS.md` files, and the guard test's header. Each
      statement of the free-form-narration rule says plainly that nothing checks it, and no
      shipped sentence claims the guard covers prose quality or commands outside the seven.
