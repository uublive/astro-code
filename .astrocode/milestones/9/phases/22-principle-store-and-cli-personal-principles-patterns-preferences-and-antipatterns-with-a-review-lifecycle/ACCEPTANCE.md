# Acceptance — phase 22: Principle store and CLI

What a human confirms before this phase closes. Each item names the **precondition state**
it needs (ADR-050): this phase introduces a new data store, so no pre-existing fixture
covers it and every item builds its own state. Run them in order: each later item assumes
the state the earlier ones left behind.

**Base precondition for every item:** a throwaway home (`export HOME=$(mktemp -d)`, git
author/committer name and email set), and a scratch project (`git init` + `ac init`).
`$HOME/.astro/principles/` does not exist yet.

1. **The user can write down a principle of their own and it counts at once, without
   touching the project.**
   *Precondition:* empty store, no principles remote, project working tree clean.
   `ac principles add "Never mock the database in integration tests" --kind antipattern --strength rule --why "Mocks hid a broken migration" --stack Postgres --work test`
   prints a dated id. One readable Markdown file appears under `$HOME/.astro/principles/`;
   `git status` in the project shows nothing new; `ac principles list` shows it as accepted,
   and `ac principles show <id>` gives back every field (stack lowercased).

2. **The user can queue a proposal, then accept it (reworded), reject another with a
   reason, and see each group separately.**
   *Precondition:* the accepted entry from (1); nothing else in the store.
   `add "Use pnpm" --kind preference --propose` and `add "Prefer small PRs" --kind preference --propose`.
   `list --proposed` shows only those two. Accept "Use pnpm" with `--edit` (or
   `--statement "Always use pnpm"`) and reject the other with `--reason "too broad"`;
   rejecting without a reason is refused. `list --rejected` shows the rejected one with
   its file still on disk, and `list --all` shows all three.

3. **The user can amend, retire and supersede accepted entries — keeping the id and the
   history — and illegal moves are refused.**
   *Precondition:* the accepted entries from (1) and (2), one rejected entry from (2).
   `amend <id> --reason "clarified scope" --statement "…"` keeps the id and `show` lists
   the reason and the old wording. `retire` without a reason, accepting the rejected
   entry, and `supersede <id> --by <nonexistent>` are each refused with nothing changed;
   `supersede <old> --by <new>` names the successor in `show`.

4. **A damaged entry and a leaked secret are both handled safely.**
   *Precondition:* at least three entries in the store from (1)–(3).
   Delete the `status:` line from one entry file: `show` on it fails naming the file,
   `list --all` warns about it by name, and adding/amending other entries leaves that file
   untouched. Add an entry with `--excerpt` containing a fake `ghp_…` token, a fake
   `AKIA…` key, a `Bearer …` header and `https://alice:s3cr3tpass@git.example.com/r.git`:
   `grep -r` over the store finds none of them, and `show` displays the excerpt masked.

5. **The user's principles follow them to a second machine and survive going offline.**
   *Precondition:* the store from (1)–(4) on machine A; a local bare repo `remote.git`;
   a second fresh home for machine B.
   On A: `ac principles remote <path to remote.git>`. On B: the same command, then
   `list --all` shows A's entries. Add on B → A's next `list` shows it. Move `remote.git`
   aside: commands on A still succeed with at most one advisory line; move it back and the
   next command syncs, B sees A's offline work, nothing was lost from the remote.

6. **The same principle edited differently on both machines is reported, never silently
   lost.**
   *Precondition:* A and B converged as at the end of (5), sharing one accepted entry x.
   With `remote.git` moved aside, amend x differently on A and on B; restore it; run a
   command on A, then on B. A `⚠ conflict on <x>` line appears, both wordings are
   recoverable, `show x` still works, and `ac principles resolve x --take theirs` (or mine)
   clears the warning.

7. **The user can promote a personal principle into a project's canon, and it stays
   personal.**
   *Precondition:* a project with an `origin` bare remote and `ac registry init` run; two
   accepted entries in the store.
   `ac principles promote <id1>` adds a new ADR to the project's DECISIONS.md that also
   appears on the registry branch; `promote <id2> --as convention` appends to
   CONVENTIONS.md (old content intact), publishes nothing, and tells you to run
   `ac canon push`. Both entries stay accepted in `$HOME/.astro/principles/` and `show`
   lists their promotions.
