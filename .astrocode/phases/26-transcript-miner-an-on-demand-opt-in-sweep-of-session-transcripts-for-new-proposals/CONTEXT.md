<!-- astro-discuss: captured -->
# Phase 26 — Transcript miner: context

Milestone 9 "Second Nature" (PROJECT.md: proposals "then from an opt-in, on-demand
transcript sweep"). Builds on: the phase-22 store + propose path (ADR-057/058/059), the
phase-23 single capture spec `templates/principle-capture.md` (human-only gate, lift rule,
kinds, the one `ac principles add … --propose` invocation, one-line report), phase-24 dedupe
+ sightings + `/astro-review` (planned alongside), phase-25 retrieval (planned alongside).
Host plumbing exists: `lib/hosts/claude.mjs` enumerates every Claude config dir (base +
jean-claude profiles + CLAUDE_CONFIG_DIR); `lib/hosts/codex.mjs`; `lib/stats.mjs` already maps a
project root → `<configDir>/projects/<root with non-alnum → '-'>`. Reality check: this
machine holds ~3.1 GB of Claude JSONL across two accounts and many client projects.

## Decisions

### D1 — Reach: current project by default; wider only on purpose
- Default: only the CURRENT project's sessions, from every Claude profile/account found
  (lib/hosts/claude.mjs enumeration) and Codex.
- `--all` (every project) or `--project <path>` widens it deliberately. Client projects are
  never read unless asked. The lift rule (capture spec §2) still strips project nouns either way.

### D2 — Signal: human steers only
- Only turns the human actually typed — especially corrections / stated preferences
  ("no, don't…", "always…", "I'd rather…", "from now on…") — plus the preceding assistant
  turn as context.
- EXCLUDE: tool results, system reminders / hook-injected context, expanded slash-command
  bodies (a `/astro-*` expansion appears as a user message — not the human's words; the
  typed args are), subagent + workflow transcripts, headless/agent-driven sessions (e.g.
  astro-fleet, `claude -p` style runs). Mirrors capture spec §1 (human-answered only, ADR-058).

### D3 — Split: `ac` extracts, the agent lifts
- `ac principles mine` (name: planner's call) is the mechanical, zero-dep, tested part: find
  sessions (D1), stream JSONL (don't load GBs into memory), filter to human turns (D2),
  prefilter by steer cues, REDACT (existing redactor), group repeats across sessions, emit
  compact candidate excerpts (text + json).
- A slash command (e.g. `/astro-mine`) runs it and has the agent lift the candidates via the
  phase-23 capture spec, passing through phase-24 dedupe (a match → sighting, never a
  duplicate proposal; rejected → never re-queued). Evidence: `--from-session` IS available
  here (the transcript's session id) even though the capture spec omits it elsewhere —
  the spec/table gets a miner row; `--from-ref "transcript <session>"` or similar.
- The agent never reads raw transcript files directly.

### D4 — Incremental: per-machine watermark
- Remember per session file what was swept (e.g. path + byte offset / mtime), stored locally —
  NOT in the synced store (transcripts are per-machine). A re-run mines only new material;
  `--rescan` ignores the watermark.
- The watermark advances only past material actually processed (see D6 cap).

### D5 — Threshold: recurrence OR an explicit rule
- Propose a steer if it recurs across ≥2 separate sessions, OR the human stated it once as an
  explicit rule ("always…", "never…", "from now on…"). A lone one-off correction is not proposed.
- Recurrence is also recorded as sightings (phase 24), so later sweeps strengthen existing entries.

### D6 — Volume: at most 10 proposals per sweep
- Strongest first (recurrence count, then explicitness). The rest stay unswept for the next
  run; watermark consistent with that (don't mark unprocessed candidates as swept).
- Overrides the capture spec's per-moment cap of 3 for this moment only — state it in the
  spec's miner row, not inline in the command (single-source discipline).
- Report: the spec's one line (`proposed N principle(s) — …`), plus at most one line if more
  remain ("N more candidates — run again").

### D7 — Hosts: Claude + Codex
- One reader per host behind a common extraction interface; Codex sessions from its single
  config dir. An unknown/changed line shape is skipped and counted, never crashes the sweep
  and never reads as "nothing found" (unknown ≠ empty, ADR-043/054 spirit) — report skipped count.

### D8 — Trigger: on-demand command + a passive nudge
- Never runs by itself: no hook, no schedule.
- A one-line statusline/banner hint when many unswept sessions have accumulated for this
  project (threshold: planner). The hint must be cheap (no transcript parsing in the
  statusline hot path — e.g. compare file count/mtime vs watermark) and silent otherwise.

## Scope
IN: `ac principles mine` extraction (D1–D5, D7), watermark (D4), the slash command (D3, D6),
capture-spec miner row, the nudge (D8), tests with fixture transcripts (both hosts, incl.
slash-command expansions, subagent files, tool results, secrets to redact).
OUT: forge graph import (27); any automatic/background mining; embeddings/LLM scoring inside
`ac`; mining assistant behaviour as preference.

## Open for the planner
- Steer-cue list (English; the user writes Italian too — consider a small bilingual cue set or
  leave explicitness to the agent), recurrence grouping (reuse phase-24's matcher, don't fork).
- Watermark format/location (e.g. `~/.astro/…/.local/` like phase 25's usage log), per-run
  size ceiling on excerpts handed to the agent.
- How headless sessions are detected in each host's JSONL (entrypoint / userType fields).
- Nudge threshold and where the count is cached.
