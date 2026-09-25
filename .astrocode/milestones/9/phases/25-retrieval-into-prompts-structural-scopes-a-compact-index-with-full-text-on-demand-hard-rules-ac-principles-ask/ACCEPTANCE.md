# Phase 25 — acceptance (human UAT)

Confirm each item yourself before `/astro-accept`. Each one names the state it needs first.

- [ ] **You can get a per-task shortlist that shows only what applies.**
  *Needs:* an astro project with a `package.json`, and your store holding at least one
  accepted hard rule (`--strength rule`) plus accepted defaults scoped to different stacks,
  work types and file globs, and one proposed entry.
  Run `ac principles brief --work code --files lib/x.mjs`. You see a line saying which stack
  tags were used, every hard rule in full with its why, and one line per in-scope default with
  no why. Out-of-scope defaults and the proposed entry are missing. `ac principles show <id>`
  on an index line shows the full text.

- [ ] **You can ask your principles a question and see why each result matched.**
  *Needs:* accepted entries on at least two unrelated topics.
  `ac principles ask "<a question about one topic>"` lists that topic's entries first, each
  with the matched words. A question about something you never wrote down says there are no
  matches.

- [ ] **You can open a Claude session in a project and it already knows your hard rules.**
  *Needs:* the same store as the first item, astro-code installed (`ac install`).
  Start a fresh session in the project and ask Claude which hard rules apply. It names them
  and knows about the compact index without running anything. With an empty store the
  session starts exactly as before, with no errors.

- [ ] **You can see which principles agents ignore and which never come up.**
  *Needs:* a store with in-scope and out-of-scope accepted defaults, and at least one
  `/astro-execute` (or a few `ac principles brief` runs plus one `ac principles cite <id>`)
  since this phase landed.
  `ac principles list --usage` lists served-but-never-cited entries and never-served entries.
  A cited entry is in neither list.

- [ ] **You can spot a principle that clashes with project canon, and nothing changes it for you.**
  *Needs:* an accepted principle that overlaps an in-force ADR or a CONVENTIONS.md bullet in
  this project.
  `ac principles brief` and `ac principles list` flag it with `canon may override: ADR-…`
  (or `CONVENTIONS §…`), and its text and status stay the same. After you
  `ac principles promote` it into this project, the flag goes away.

- [ ] **You can override the detected stack for a project.**
  *Needs:* a project whose manifests suggest the wrong stack, and accepted entries scoped to
  the right stack and the wrong one.
  `ac config set stack '["rust"]'`, then run the brief again. The tags line says `rust`
  (config override), and only the rust-scoped entries are served.

- [ ] **You can run discuss/plan with no forge tools, and your principles never enter the repo.**
  *Needs:* a store with at least one accepted principle containing a word you can grep for.
  `/astro-discuss` and `/astro-plan` run `ac principles ask`/`brief` instead of a forge query.
  AGENTS.md tells other hosts to run `ac principles brief`. After a full plan/execute cycle,
  grepping the project for your word finds nothing, and `git status` shows no principle text.
