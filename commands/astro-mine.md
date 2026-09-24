---
description: Sweep this project's past sessions for principles you kept stating, on demand
argument-hint: "[--all | --project <path>] [--rescan]"
allowed-tools: Bash, Read
---

Sweep past session transcripts for steers you kept giving — corrections, preferences and
explicit rules — and turn the ones that recur into proposed personal principles. Never
runs on its own: no hook and no schedule call this, only the user asking for it.

## Steps

1. **Run the miner.** Run `ac principles mine --json`, passing through only the flags the
   user actually gave: `--all`, `--project <path>`, `--rescan`. If the result's
   `nothingNew` is true, say `nothing new to mine` in one line and stop. When
   `skipped` totals more than 0, add at most one line
   `⚠ skipped N transcript line(s)`.

2. **Record exact repeats.** For each item in `sightings[]`, run
   `ac principles sight <id> --from-session "<fromSession>" --from-ref "<fromRef>" --excerpt "<excerpt>"`.
   Say nothing here — the step 5 report line counts them.

3. **Lift the candidates.** Follow `` `$(ac path templates)/principle-capture.md` ``, its
   transcript-sweep row. Take `candidates[]` in the order the miner gave — already capped
   and strongest first — and pass `--from-session "<fromSession>" --from-ref "<fromRef>"`
   on each invocation. No number and no lift rule are restated here; the spec owns both.

4. **Advance the watermark.** Only when every call in steps 2–3 succeeded, run
   `ac principles mine --advance <sweep>`. On any failure, do not advance — the next
   sweep retries the same material. Say nothing here either way; step 5 reports.

5. **Report.** The spec's one line (§7, with the "seen again" extension), plus at most one
   `N more candidates — run again` line when `remaining > 0`, silent on it otherwise. A
   failure is the spec's single line `⚠ principle capture failed: <first error>`. Zero
   proposals and zero sightings → say nothing.

## Never

- Never open, read, `grep` or list transcript files or directories (`projects/`,
  `sessions/`, `*.jsonl`) — only the miner's own JSON output.
- Never write under `~/.astro/principles/` or `.local/mine/` directly.
- Never accept, reject, merge or reopen a principle from this command.
- Never run from a hook or on a schedule.
- Never pass `--rescan` unless the user asked for it.
