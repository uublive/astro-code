# Reproduction

Test: `tests/fix_stats_dedupe_subagents.test.mjs` — the issues' own fixture: `sess1.jsonl` with
msg_A twice (same usage) and msg_B; `sess1/subagents/agent-a1.jsonl` with msg_S.

Command: `node --test tests/fix_stats_dedupe_subagents.test.mjs`

Observed before the fix: all 3 tests failed — turns 3 / output 250 / cacheRead 16000 instead of
2 / 150 / 11000 (#152), and msg_S's 1000 output and 50000 cache reads missing (#153).

# Diagnosis

- #152 symptom: tokens about 1.7-2x too high. Cause: `collectStats` added `message.usage` per
  transcript line; Claude Code writes one API response as several lines sharing a message.id.
- #153 symptom: workflow spend missing (the main thread is ~30% of a project's spend). Cause: only
  `readdirSync(dir).filter(.jsonl)` at the top level; `<session>/subagents/` was never read.
- Ruled out: the transcript-dir slug (#38, unchanged) and the cache/fresh arithmetic (unchanged).

# Fix

lib/stats.mjs: `transcriptFiles` reads each session's top-level file and walks its `<session>/`
folder (subagents, nested workflow folders); the session filter matches the parent session name.
Usage is keyed by message.id (last line wins); lines without an id count as before.
