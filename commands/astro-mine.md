---
description: Sweep this project's past sessions for principles you kept stating, on demand
argument-hint: "[--all | --project <path>] [--rescan]"
allowed-tools: Bash, Read
---

Sweep past session transcripts for steers you kept giving — corrections, preferences and
explicit rules — and turn the ones that recur into proposed personal principles. Never
runs on its own: no hook and no schedule call this, only the user asking for it.

The miner only hands over the turns the human typed; every judgement of meaning — which
turns are steers, which say the same thing in any language, which qualify — is yours,
made by the capture spec's transcript-sweep rules.

## Steps

1. **Run the miner.** Run `ac principles mine --json`, passing through only the flags the
   user actually gave: `--all`, `--project <path>`, `--rescan`. If the result's
   `nothingNew` is true, stop and say nothing — the spec's zero-proposal silence (§7)
   covers it, and an empty sweep is not news. Note the
   `skipped` counts for step 5; say nothing about them here.

2. **Record exact repeats.** For each entry in `sightings[]`, run
   `ac principles sight <id> --from-session "<fromSession>" --from-ref "<fromRef>" --excerpt "<excerpt>"`.
   Say nothing here — the step 5 report line counts them.

3. **Group, qualify and lift.** Follow `` `$(ac path templates)/principle-capture.md` ``:
   its transcript-sweep grouping and threshold section decides which of `items[]` form
   groups and which groups qualify, its volume section caps and orders them, and its
   transcript-sweep evidence row says what to pass — `--from-session "<fromSession>"
   --from-ref "<fromRef>"` on each invocation, from one item of the group. Note the ids
   the spec says to carry forward. No number and no rule is restated here; the spec owns
   them all.

4. **Advance the watermark.** Only when every call in steps 2–3 succeeded, run
   `ac principles mine --advance <sweep> --keep <ids>`, with the ids step 3 noted to
   carry forward (drop `--keep` when there are none). On any failure, do not advance —
   the next sweep retries the same material. Say nothing here either way; step 5
   reports.

5. **Report.** The spec's one line (its reporting section, with the "seen again" and
   "skipped" extensions), plus at most one `N more turns — run again` line when `remaining > 0`,
   silent on it otherwise. A failure is the spec's single line
   `⚠ principle capture failed: <first error>`. Nothing proposed, sighted or skipped →
   say nothing.

## Never

- Never open, read, `grep` or list transcript files or directories (`projects/`,
  `sessions/`, `*.jsonl`) — only the miner's own JSON output.
- Never write under `~/.astro/principles/` or `.local/mine/` directly.
- Never accept, reject, merge or reopen a principle from this command.
- Never run from a hook or on a schedule.
- Never pass `--rescan` unless the user asked for it.
