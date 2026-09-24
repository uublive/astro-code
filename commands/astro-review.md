---
description: Walk the proposed personal principles in batches — accept, edit, reject or skip, and merge duplicates
argument-hint: ""
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

Batch-review the proposed personal principles queue, deduping against what accepted and
rejected entries already settled.

The store fills itself — captures at `/astro-discuss`, `/astro-decision`, `/astro-accept`
and `/astro-complete-milestone` all propose (ADR-058) — so this command exists for the
other half: turning proposals into a decided queue, one batch at a time.

## Steps

1. **Read the queue.** Run `ac principles list --proposed --json`. If the queue is empty,
   say so in one line and stop.

2. **Group and batch.** Near-duplicate groups come from each item's `groupWith`, and a
   group is always presented together, never split across batches. Batches hold about 4
   items per round, with a group counting as one item toward that count.

3. **Present each batch** — per item: statement, why, kind/strength/scopes, the source
   excerpt, "seen again N" when N > 0, and each match against a non-proposed entry (for
   example `rejected (<reason>), seen again N times` or `overlaps accepted <id> on pnpm,
   lockfile`). Each item gets at most 4 lines. Detail beyond that lives in
   `ac principles show <id>`, not in this presentation.

4. **Ask, one round per batch.** One `AskUserQuestion` call per batch, one question per
   item, with the options accept / edit-then-accept / reject / skip. A group gets one
   question instead, with the options "merge into <id>" (one choice per member), "review
   separately" and skip. Then run one follow-up round that collects the new wording for
   every edit-then-accept and a **required** reason for every reject — a reject with no
   reason is re-asked, never defaulted.

5. **Act through `ac` only.** The verbs are `ac principles accept <id>`,
   `ac principles accept <id> --statement "…" [--why "…"]` for edit-then-accept,
   `ac principles reject <id> --reason "…"` and `ac principles merge <dup> --into <id>`.
   This command never writes under `~/.astro/principles/` directly, and never runs
   amend/retire/supersede. A verb that fails (typically `cannot … — it is accepted`,
   because the queue changed under the snapshot) does not stop the batch: report it in
   one line per failure, `⚠ <id>: <first error line>`, and count it as skipped.

6. **Rejected entries seen again.** Run `ac principles list --rejected --json` and find
   the entries with a sighting whose `at` is later than their last `rejected` history
   line. Show each in one line: `rejected (<reason>), seen again N times`. Ask one
   question offering "leave rejected" (listed first) or "reopen <id>". Reopen only runs
   on that explicit choice, through `ac principles reopen <id> --reason "<the user's
   words>"`. When there are none, say nothing at all. Nothing is ever reopened or
   accepted automatically.

7. **Report.** Exactly one line:
   `reviewed N — A accepted, R rejected, S skipped` plus `, M merged` and `, O reopened`
   only when they are non-zero. The line always leads; any `⚠` failure lines from step 5
   follow it.

## Never

- Never write under `~/.astro/principles/` directly — every change goes through
  `ac principles`.
- Never run in readline/interactive `ac` mode; there is none, and this command does not
  add one.
- Never reopen or accept a rejected match without the user explicitly choosing it in
  step 6 or step 4.
- Never reject without a reason the user actually typed.
- Never merge two proposals on similarity alone without the user choosing it in step 4.
