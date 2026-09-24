# Phase 24 — Review workflow: pre-registered success criteria

Derived from the phase goal, CONTEXT.md (D1–D7) and canon (ADR-053, ADR-055, ADR-057,
ADR-058, ADR-059, CONVENTIONS). Plan-blind. Every `ac` run below uses a throwaway store:
`export ASTRO_PRINCIPLES_DIR=$(mktemp -d)` (plus `HOME=$(mktemp -d)` where a clean home
matters), and `node /Users/buu/Development/astro-code/bin/ac.mjs` as `ac`. Where a criterion
names a verb this phase introduces (match / reopen / merge), the verifier uses whatever name
and flags `ac help` (or the `ac principles` usage error) documents for that capability — the
criterion is the behaviour, not the spelling.

### C1 — Re-proposing a statement already in the proposed queue never creates a second entry; it is recorded as a sighting on the existing one
- **Observe:** `ac principles add --propose "Always use pnpm, never npm, for lockfiles" --kind preference --from-project p1 --excerpt "first"`; then propose three textual variants that differ only in case, punctuation, whitespace and dash style (e.g. `"always use PNPM — never npm for lockfiles."`, `"Always  use pnpm - never npm, for lockfiles"`), each with a different `--from-project`/`--excerpt`. Then `ac principles list --proposed --json` and `ac principles show <id> --json`.
- **Fails if:** more than one proposed entry exists for that statement; OR the surviving entry does not expose a sighting count of 3 (or 4 counting the original — the count must equal the number of captures observed) together with each later capture's project/excerpt as evidence; OR any capture is silently discarded (its source appears nowhere in the store).

### C2 — A capture matching an ACCEPTED entry is not re-queued and changes nothing on that entry except appending a sighting
- **Observe:** add an accepted entry (`ac principles add "Prefer node:test over any test framework" --kind preference --stack node`, and separately one accepted via `accept <id> --statement "…"` so it is human-edited). Snapshot each entry file under `$ASTRO_PRINCIPLES_DIR`. Propose a normalised-equal variant of each with new source evidence. Diff the entry files and run `ac principles list --proposed --json`.
- **Fails if:** a new proposed entry appears; OR the accepted entry's statement, why, status, kind, strength, scopes or prior history differ from the snapshot in any way other than appended sighting evidence and an increased sighting count; OR no sighting is recorded at all (the repeat was dropped silently).

### C3 — A capture matching a REJECTED entry is never re-queued, keeps the rejection reason, and makes recurrence visible
- **Observe:** propose an entry, `ac principles reject <id> --reason "not my style"`, then propose normalised-equal variants of it three times from different sources. Run `ac principles list --proposed --json` and `ac principles show <id> --json`.
- **Fails if:** the rejected wording re-enters the proposed queue (as a new entry or by flipping the rejected one back to proposed); OR the status is no longer `rejected` or the reason "not my style" is gone/changed; OR `show` does not report 3 new sightings with their evidence.

### C4 — Similarity alone never merges anything; overlap-only candidates are surfaced with an explainable reason for an agent/human to decide
- **Observe:** with an accepted entry "Use pnpm for every lockfile in JS repos", run the phase's candidate-lookup capability (e.g. a match verb, `--json`) for "Commit the pnpm lockfile on every dependency change" and for an unrelated statement "Name tests as full sentences". Then propose the overlapping statement.
- **Fails if:** the overlapping statement is folded into the existing entry as a sighting or otherwise merged/suppressed automatically (it must remain a distinct proposal unless a decision-maker says otherwise); OR the candidate lookup for the overlapping statement does not name the existing entry's id and the shared tokens it matched on (e.g. `pnpm`, `lockfile`); OR the unrelated statement returns that entry as a candidate; OR the lookup's output differs between two identical runs (non-deterministic / embedding-like scoring).

### C5 — Sighting evidence is redacted exactly like a fresh entry's evidence
- **Observe:** propose statement S1 as a new entry with `--excerpt "token AKIAIOSFODNN7EXAMPLE ghp_0123456789abcdefghijklmnopqrstuvwxyzAB leaked"` and inspect its file; then create entry S2 and propose a normalised-equal variant of S2 with the same excerpt so it lands as a sighting, and grep the whole store directory for the raw credential strings.
- **Fails if:** any credential shape masked in S1's stored excerpt appears unmasked anywhere in the store after the sighting (the sighting path bypassed redaction).

### C6 — A rejected entry comes back only through a deliberate, reasoned reopen that is recorded in history
- **Observe:** reject an entry, run the phase's reopen capability without a reason, then with `--reason "changed my mind"`; `ac principles show <id> --json` and `list --proposed`. Also attempt reopen on an accepted entry and on a still-proposed one.
- **Fails if:** reopen without a reason succeeds; OR after a reasoned reopen the entry is not `proposed` again (same id, not a copy), OR its history lacks a reopen line carrying the reason, OR the earlier rejection record/reason is erased from history; OR reopening an accepted or proposed entry silently succeeds or changes its status; OR any entry reaches `proposed` from `rejected` without that explicit verb (C3 already probes recapture).

### C7 — Merging duplicate proposals keeps one survivor, folds the other's evidence into it, deletes nothing, and does not act as a rejection
- **Observe:** create two distinct proposed entries A and B that are near-duplicates (different wording, overlapping tokens), each with its own source. Run the phase's merge capability folding B into A. Then `ac principles show <B> --json`, `show <A> --json`, `list --proposed --json`, count files in the store, and afterwards propose B's exact original wording again.
- **Fails if:** B's file/id disappears or `show <B>` errors (ids must stay citable); OR B still appears in the proposed queue, or is shown as `rejected`; OR B does not point at A as its survivor; OR A does not carry B's source evidence as a sighting; OR A's statement changed without the user supplying new text; OR re-proposing B's wording afterwards is treated as a rejected match (blocked with no route back) rather than landing on the survivor or the queue.

### C8 — Sightings appended on two machines to the same entry merge cleanly through the store's sync
- **Observe:** create a bare git repo (`git init --bare`) as the remote; store X adds an entry and runs `ac principles remote <bare path>`; store Y (separate `ASTRO_PRINCIPLES_DIR` + `HOME`) is attached to the same remote and syncs so it holds the entry. Offline from each other, X records a sighting from project px and Y one from project py on that same entry (by proposing a normalised-equal variant in each). Sync X, then Y, then X again. Inspect both stores and any `conflicts/` directory.
- **Fails if:** either store ends without BOTH sightings (px and py) and a count reflecting both; OR a conflict file is produced or the sync refuses/requires `ac principles resolve` for this case; OR conflict markers appear in the entry file; OR the entry's status or text changed.

### C9 — Entries written before this phase still read and act correctly
- **Observe:** extract the pre-phase CLI from git (`git archive <phase-base-commit> bin lib | tar -x -C $(mktemp -d)`) and use it to create proposed, accepted and rejected entries in a store with no sightings. With the new `ac`, run `list --all --json`, `show` each, then propose a normalised-equal variant of each and `accept`/`reject` a remaining old proposed entry.
- **Fails if:** any old entry fails to parse, is reported as damaged, or loses a field; OR a sighting cannot be added to an old entry; OR the new format written back is rejected by the new parser on re-read (strict parse must still hold — a hand-mangled header key order is still reported as damage).

### C10 — An edited acceptance records both the edit (with prior text) and the acceptance
- **Observe:** propose "use tabs", then `ac principles accept <id> --statement "Use two-space indentation"`; `ac principles show <id> --json`. Also run `ac debt list` (or `ac debt show 2026-09-24-accept-statement-edit-records-only-an`).
- **Fails if:** history lacks an `accepted` record; OR lacks an `edited` record carrying the prior text "use tabs"; OR the debt item `2026-09-24-accept-statement-edit-records-only-an` is still open.

### C11 — Everything the review does is scriptable through non-interactive `ac` verbs, with the data needed to decide
- **Observe:** with stdin closed (`</dev/null`), drive a full review by CLI alone: list the proposed queue as JSON, accept one, edit-then-accept one, reject one with a reason, merge a duplicate, reopen a rejected one. Inspect the proposed-queue JSON for one item that has sightings and matches a rejected entry.
- **Fails if:** any decision requires an interactive prompt or hangs on stdin; OR the queue data a reviewer needs is not obtainable from `ac` output — per item: statement, why, kind, strength, scopes, source excerpt, sighting count, and any match against an accepted or rejected entry (with the rejection reason); OR `reject` succeeds without a reason.

### C12 — `/astro-review` walks the proposed queue in small batches and ends with a one-line count summary
- **Observe:** read the review slash-command spec as the instructions an agent would follow. It must: batch the proposed queue (a handful per question round) with the four choices accept / edit-then-accept / reject (reason required) / skip; show near-duplicates grouped with a merge option; show sighting count and any accepted/rejected match (e.g. "rejected (reason), seen again N times") per item; carry out every decision via an `ac principles` verb; and end with exactly one summary line naming counts (e.g. `reviewed 7 — 4 accepted, 2 rejected, 1 skipped`). Run `node --test /Users/buu/Development/astro-code/tests/` to confirm any reporting-slot guard covering it passes.
- **Fails if:** the command writes entry files directly or mutates state other than through `ac`; OR any of the four choices is missing, or reject does not require a reason; OR duplicates are not grouped / cannot be merged from the review; OR the end-of-run report is not bounded to a single summary line (ADR-055); OR it offers to reopen or accept a rejected match automatically without an explicit user choice.

### C13 — Capturing agents consult candidates before proposing, so near-duplicates are caught at capture time
- **Observe:** read the phase-23 capture instructions (the single-source capture spec that discuss/decision/accept/milestone-close follow, as merged) as an agent would.
- **Fails if:** the instructions do not direct the capturing agent to look up candidate matches before proposing and to decide same-or-different on overlap-only candidates (recording a sighting on the existing entry when it is the same, proposing new when different); OR they tell the agent to re-propose regardless, or to merge on similarity alone; OR the instructions are duplicated into several diverging copies instead of one source.

### C14 — The whole suite stays green with zero dependencies
- **Observe:** `cd /Users/buu/Development/astro-code && node --test tests/` and `node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).length)"`.
- **Fails if:** any test fails; OR the dependency count is non-zero (REQ-001 / CONVENTIONS: zero runtime and dev deps, no embeddings).
