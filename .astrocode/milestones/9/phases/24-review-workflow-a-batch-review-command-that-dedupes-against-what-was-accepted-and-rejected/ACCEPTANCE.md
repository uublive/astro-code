# Phase 24 — Acceptance (UAT)

Unless an item says otherwise, run it against a throwaway store so your real
`~/.astro/principles/` is left alone: `export HOME=$(mktemp -d)` (the store then lives at
`$HOME/.astro/principles`). Seed the store with `ac principles add …` exactly as each
precondition says.

- [ ] **The user can review the proposed queue in small batches with `/astro-review` and
  finish on one summary line.**
  *Precondition:* the store holds at least 5 `proposed` entries (`ac principles add "<s>"
  --kind preference --why "<w>" --propose --from-project demo --excerpt "<words>"`). One of
  them has been proposed a second time with different case and punctuation, so it carries 1
  sighting. One shares two or more content words with an `accepted` entry, and one does the
  same with a `rejected` entry that has a reason.
  Run `/astro-review`. Items come a few at a time (about 4 per question round). Each item
  shows its statement, why, kind/strength/scopes, source excerpt and "seen again N". It also
  names any accepted or rejected entry it overlaps and the shared words, and a rejected match
  shows its reason. Choose accept for one, edit-then-accept for one (type new wording),
  reject for one (you are asked for a reason and cannot skip it) and skip for one. The run
  ends with exactly one line, e.g. `reviewed 4 — 2 accepted, 1 rejected, 1 skipped`.
  `ac principles list --all` agrees with what you chose.

- [ ] **The user can merge two near-duplicate proposals from the review without losing
  either one's evidence.**
  *Precondition:* two `proposed` entries worded differently that share at least two content
  words (e.g. "Commit the pnpm lockfile on every dependency change" and "Always commit
  pnpm-lock files with dependency bumps"), each with its own `--from-project`/`--excerpt`.
  In `/astro-review` the two are shown together as a group with a merge option. Merge one
  into the other. `ac principles show <folded id>` still works, says `merged` and names the
  survivor. `ac principles show <survivor id>` lists the folded entry's project/excerpt as a
  sighting, and its statement is unchanged. The folded entry is no longer in
  `ac principles list --proposed`.

- [ ] **The user can re-capture something they already rejected and see that it is only
  recorded as seen again, then deliberately reopen it.**
  *Precondition:* one `rejected` entry with the reason "not my style".
  Propose the same statement again twice with different capitalisation, punctuation or dash
  style. Each call prints a "seen again" line, not a new proposal.
  `ac principles list --proposed` does not contain it. `ac principles show <id>` still says
  `rejected — not my style` and shows 2 sightings. `ac principles reopen <id>` with no reason
  is refused. `ac principles reopen <id> --reason "changed my mind"` puts the same id back
  in the proposed queue, and its history keeps both the rejection and the reopen.

- [ ] **The user can ask which existing entries a new statement resembles, and see why.**
  *Precondition:* an `accepted` entry "Use pnpm for every lockfile in JS repos".
  `ac principles match "Commit the pnpm lockfile on every dependency change"` names that
  entry and the words it matched on (`pnpm`, `lockfile`). Proposing that statement still
  creates a separate proposal, so similarity alone merges nothing.
  `ac principles match "Name tests as full sentences"` reports no candidates.

- [ ] **The user can reword a proposal while accepting it and see both steps in its
  history.**
  *Precondition:* one `proposed` entry "use tabs".
  `ac principles accept <id> --statement "Use two-space indentation"`, then
  `ac principles show <id>`. The history shows an `edited` line and an `accepted` line.
  `ac debt list` no longer lists `2026-09-24-accept-statement-edit-records-only-an`.

- [ ] **The user's existing, pre-phase store still reads and works.**
  *Precondition:* your REAL `~/.astro/principles/` as phases 22–23 left it (entries with no
  sightings; take a copy first: `cp -a ~/.astro/principles /tmp/principles-backup`). Do not
  set `HOME` for this item.
  `ac principles list --all` lists every entry you had and reports no damaged entries.
  `ac principles show <id>` works on an old accepted entry. Proposing a case-changed copy of
  one of your accepted statements records a sighting on it and changes nothing else about
  that entry (`git -C ~/.astro/principles diff` if the store is synced).

- [ ] **The user can let a capture moment catch a duplicate before it reaches the queue.**
  *Precondition:* an initialised project (`ac init`) and an `accepted` entry "Validate input
  at the boundary, never deep inside".
  Run `/astro-decision` and give a decision whose general rule is that same principle in
  different words. The capturing agent checks the store for matches first. Instead of a new
  proposal, the command's one reporting line counts it as seen again, and
  `ac principles show <id>` on the accepted entry shows the new sighting.
