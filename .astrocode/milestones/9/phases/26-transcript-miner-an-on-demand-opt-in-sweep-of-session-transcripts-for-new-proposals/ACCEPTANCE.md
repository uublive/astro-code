# Phase 26 — Transcript miner: acceptance (UAT)

Confirm each item on a real machine. Before you start, snapshot `ac principles list --all`
so you can see what changed. Every item names the state it assumes (ADR-050). If that state
is not on the machine, the item cannot be checked. Do not reuse phase-22–25 fixtures for
this, because they contain no transcripts.

- [ ] **Only this project, from every account.**
  - *Precondition:* this project has past Claude sessions in at least two Claude
    profiles/accounts, and you typed the same correction or preference in at least two of
    them. Separate sessions exist for at least one other (client) project.
  - *Check:* you can run `/astro-mine`. Its proposals come only from this project's
    sessions, drawn from both accounts. Nothing from the other project appears, unless you
    pass `--all` or `--project <path>`.
- [ ] **Proposed, never accepted, and traceable.**
  - *Precondition:* the item above ran and proposed at least one principle.
  - *Check:* `ac principles list --proposed` shows the new entries in the proposed state.
    Nothing was accepted without you. `ac principles show <id>` names the transcript session
    each entry came from.
- [ ] **Only your own words.**
  - *Precondition:* at least one mined session also contained tool output, a `/astro-*`
    command expansion, and a subagent or `claude -p` run whose text sounds like a rule.
  - *Check:* none of those machine-authored lines shows up as a candidate or a proposal.
    Only sentences you typed appear, including the arguments you typed after a slash
    command.
- [ ] **Secrets stay out.**
  - *Precondition:* a past correction you typed in this project contains a pasted API key
    or token.
  - *Check:* that correction's proposal and the `ac principles mine --json` output show
    `[REDACTED]` in place of the key. The key appears nowhere under `~/.astro/`.
- [ ] **Already-decided rules are not re-proposed.**
  - *Precondition:* the store holds one accepted and one rejected principle (with a
    reason), and past sessions of this project restate both.
  - *Check:* after `/astro-mine`, the accepted one has gained a sighting and was not
    duplicated. The rejected one is still rejected with its reason and is not back in the
    proposed queue.
- [ ] **Incremental, capped, nothing lost.**
  - *Precondition:* a sweep has already completed here.
  - *Check 1:* running `/astro-mine` again with no new sessions says "nothing new to mine".
  - *Check 2:* after one new session in which you stated a new rule ("from now on…"), only
    that rule is offered.
  - *Check 3:* with more than 10 qualifying steers pending, one sweep proposes at most 10
    and says `N more candidates — run again`, and the next sweep offers the rest.
- [ ] **A quiet nudge, never an automatic run.**
  - *Precondition:* this project has at least 10 Claude sessions that have not been swept
    since the last `/astro-mine`, and another project has fewer.
  - *Check:* the statusline shows one short `/astro-mine` hint in this project and none in
    the other. Opening sessions and working normally never creates a proposal on its own.
    After `/astro-mine` runs, the hint disappears.
