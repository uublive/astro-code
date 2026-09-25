# Phase 26 — Transcript miner: pre-registered success criteria

> Plan-blind. Derived from the phase goal ("an on-demand, opt-in sweep of session transcripts
> for new proposals"), CONTEXT.md D1–D8, and canon (ADR-043/054 unknown ≠ empty, ADR-057/058/059
> principle store + human-authoritative proposals, ADR-060 single capture spec).
>
> **Sandbox for every criterion.** Run in a throwaway `$HOME` so no real transcript or store is
> touched: `export T=$(mktemp -d); export HOME=$T CLAUDE_CONFIG_DIR=$T/.claude CODEX_HOME=$T/.codex`,
> plus a throwaway project dir `$P` (an `ac init`-ed git repo) as cwd. "The miner" below means the
> extraction verb the phase ships (CONTEXT names `ac principles mine` as a placeholder — use
> whatever verb/flags `ac help` / the new slash command document), invoked with its JSON output.
> Fixture transcripts are hand-written JSONL in each host's real on-disk shape: Claude sessions
> under `<configDir>/projects/<project root with non-alnum → '-'>/<session-id>.jsonl`; Codex
> rollout files under `$CODEX_HOME/sessions/…` whose session-meta line carries the session's
> `cwd`. Copy line shapes from the phase's own test fixtures or from the structure (not content)
> of a real local transcript.

### C1 — By default the miner reads only the current project's sessions, but from every Claude profile/account and from Codex; `--project <path>` and `--all` widen it deliberately
- **Observe:** Create three Claude config dirs — the base (`$T/.claude`), a jean-claude profile
  registered in `$T/.claude/.jean-claude/profiles.json` pointing at `$T/profB`, and nothing else —
  plus a Codex rollout. Put a distinct, unmistakable human steer in: a base-dir session for `$P`
  ("always-A"), a profB session for `$P` ("always-B"), a Codex rollout whose cwd is `$P`
  ("always-C"), and a base-dir session for a different project `$Q` ("always-Q"). Run the miner
  from `$P` with no scope flag → the JSON candidates contain A, B and C and do NOT contain Q.
  Run it with `--project $Q` → Q appears (and A/B/C do not, or are clearly attributed to `$P`
  only if the flag is additive). Run it with `--all` → A, B, C and Q all appear. Exit code 0
  each time and the JSON parses.
- **Fails if:** another project's session text appears in a default run (client projects read
  without being asked); a profile dir or Codex is silently skipped so B or C is missing; or the
  widening flags don't actually widen.

### C2 — Only words the human actually typed become candidates, on both hosts; injected, tool, subagent and headless material never does
- **Observe:** In one `$P` Claude session, include each of the following, each carrying a
  unique cue-bearing sentence (e.g. "from now on never use X1…X7"): (1) a genuine typed human
  turn; (2) a user-role line whose content is a tool result; (3) a system-reminder /
  hook-injected / meta user line; (4) a slash-command invocation line whose typed args contain a
  steer, followed by the expanded command body (itself containing a steer sentence) appearing as
  a user message; (5) a subagent/sidechain transcript for that session; plus (6) a separate
  whole session that is headless/agent-driven (`claude -p` / SDK entrypoint shape). Mirror (1),
  (2)-equivalent and an injected environment/instructions block in a Codex rollout. Run the
  miner (`--rescan` if needed) → candidates include (1), the typed slash args from (4), and the
  Codex human line; they do NOT include the text of (2), (3), the expanded body of (4), (5),
  (6) or the Codex injected block. Each surviving candidate carries the immediately preceding
  assistant turn as context.
- **Fails if:** any tool result, reminder, expanded `/astro-*` body, subagent or headless text
  surfaces as a candidate (it would be proposed as the human's preference, violating ADR-058's
  human-answered-only rule); the human's typed slash args are dropped; or context is absent.

### C3 — Secrets in human turns never leave the miner
- **Observe:** In a qualifying human steer, embed realistic secrets (e.g. an `sk-ant-…`/`sk-…`
  API key, a `ghp_…` token, an AWS `AKIA…` key, a `password=…` assignment, a bearer token).
  Run the miner in both text and JSON output modes → the steer is still emitted, but none of the
  secret values appear anywhere in stdout/stderr (`grep -F` each secret against captured output
  finds nothing); a redaction placeholder stands in their place. Nothing the miner writes to
  disk (watermark/cache) contains them either (`grep -rF` over `$T` excluding the fixture
  transcripts themselves finds nothing).
- **Fails if:** any secret substring appears in either output mode or in a file the miner wrote.

### C4 — Recurrence and the threshold are judged by meaning, in any language: ≥2 distinct sessions or one explicit rule qualifies; a lone one-off or a content-free reply does not; opposite instructions never merge
_Revised R1 (user decision 2026-09-25, CONTEXT "Revision R1"): grouping moved from word lists in `ac` to the sweep's agent._
- **Observe:** (a) Fixtures in `$P`: the same steer restated in 3 different sessions in
  different words AND languages (e.g. English, Italian, German), twice more inside one of
  them; an explicit rule stated once; a one-off correction; two opposite one-off corrections
  in two sessions ("use tabs, not spaces" / "prefer spaces over tabs"); bare "No." replies in
  two sessions. `ac principles mine --json` hands the agent EVERY one of those human turns,
  each with its session id (only byte-identical-after-normalising turns collapse, carrying
  all their sessions) — none is dropped or merged by a language-specific word list.
  (b) `lib/` contains no steer-cue, polarity, contrast or explicit-rule word list deciding
  grouping, qualification or dropping (grep). (c) The capture spec's transcript-sweep rules
  and `/astro-mine` instruct the agent to group by meaning across languages, count DISTINCT
  sessions, keep opposite instructions apart, ignore content-free replies, qualify at ≥2
  sessions or one explicit rule, and carry below-threshold turns forward with `--keep`.
  (d) A turn kept in sweep 1 and restated in a new session in sweep 2 is handed to the agent
  again in sweep 2 alongside the new one.
- **Fails if:** `ac` drops or merges non-identical turns on word patterns; a non-English or
  non-Italian steer never reaches the agent; the instructions omit any of the rules in (c);
  or a kept turn is not re-offered in the next sweep.

### C5 — The miner streams: multi-hundred-MB transcripts are swept without loading them into memory
- **Observe:** Generate a `$P` Claude session of ≥300 MB (mostly assistant/tool-result lines,
  with one qualifying human steer near the end). Run the miner under a constrained heap, e.g.
  `node --max-old-space-size=64 <path-to>/bin/ac.mjs <miner verb> --json` → exits 0 and the
  steer near the end of the file is emitted.
- **Fails if:** it crashes with a heap/`ERR_STRING_TOO_LONG` error, or completes without the
  late steer (i.e. it truncated rather than streamed).

### C6 — Sweeps are incremental per machine: a re-run mines only new material, `--rescan` ignores the watermark, and the watermark never enters the synced store
- **Observe:** With the principle store set up as a synced git repo (`ac principles remote
  <local bare repo>`, then commit/sync so `git -C $HOME/.astro/principles status --porcelain` is
  empty), run a full sweep over `$P` fixtures → candidates emitted. Run again with nothing
  changed → zero new candidates and a clear "nothing new" result (exit 0). Append a new
  qualifying steer to one existing session file and add one new session → only that new
  material is emitted, not the earlier candidates. Run with `--rescan` → the earlier candidates
  are emitted again. After all runs, `git -C $HOME/.astro/principles status --porcelain` shows
  no watermark/cache file (only proposal entries the sweep deliberately created, if any).
- **Fails if:** a second run re-emits already-swept material; appended bytes in an existing
  file are missed; `--rescan` has no effect; or the watermark lands where the store's sync would
  commit and push it to other machines.

### C7 — A sweep proposes at most 10, strongest first, and the rest are not lost: the next run surfaces them
_Revised R1: "strongest" is judged by the agent; what `ac` guarantees is that nothing handed over or held back is lost._
- **Observe:** (a) The spec/command cap proposals at 10 per sweep, strongest first
  (distinct-session recurrence, then explicit rules), and tell the agent to `--keep` the
  qualifying groups beyond the cap. (b) Drive the mechanical steps: run the miner over more
  turns than one batch holds → it reports how many were held back; `--advance <sweep> --keep
  <ids>` then a second sweep → the held-back turns AND the kept ones are handed over again,
  and turns neither kept nor held (e.g. already proposed) are not. (c) `--advance` with an
  unknown item id refuses and advances nothing.
- **Fails if:** the cap or ordering rule is missing; held-back or kept turns never surface
  again; or already-handled turns resurface as new.

### C8 — Mined proposals pass through dedupe and the human gate: a match becomes a sighting, a rejected entry is never re-queued, nothing is ever auto-accepted, and each proposal names its source session
- **Observe:** In the sandbox store, pre-create (via `ac principles …` verbs) one accepted
  principle and one rejected principle (with reason). Add `$P` fixtures whose qualifying steers
  restate the accepted principle, restate the rejected one, and state a genuinely new rule.
  Drive a sweep as in C7. Then `ac principles list`/`show` (JSON where available): the accepted
  entry gained a sighting and no duplicate entry exists; the rejected entry is unchanged, still
  rejected with its reason, and no new proposal restating it exists (it was not offered as a
  candidate, or was refused on submission); the new rule exists with status proposed (not
  accepted); and its evidence/provenance identifies the transcript session id it came from.
- **Fails if:** a duplicate entry is created for an existing principle; the rejected text
  returns as a proposal; any mined entry is in accepted state without a human `accept`; or the
  proposal carries no traceable session reference.

### C9 — Unknown or malformed transcript lines are skipped and counted, never crash the sweep and never read as "nothing found"
- **Observe:** Add to a `$P` Claude session and a Codex rollout: a truncated JSON line, a
  syntactically valid line of an unrecognised shape/type, and a binary-garbage line, alongside
  one valid qualifying steer. Run the miner → exit 0, the valid steer is emitted, and the output
  (text and JSON) reports a skipped/unrecognised count ≥ the number of bad lines. Then point it
  at a session made entirely of unrecognised lines → the result reports those lines as skipped,
  distinguishable from a genuinely empty/clean run (which reports zero skipped).
- **Fails if:** the sweep throws/exits non-zero on a bad line; the valid steer is lost; or an
  all-unrecognised file yields the same output as a clean "nothing found".

### C10 — Mining never runs by itself: no hook, statusline render or session event sweeps, advances the watermark or proposes
- **Observe:** Run `ac install` into the sandbox home, then execute every hook it registers in
  the sandbox Claude settings (SessionStart, statusline, PreCompact, UserPromptSubmit, Stop —
  feeding each its normal stdin JSON with cwd `$P`) while `$P` has unswept qualifying
  fixtures. Afterwards: no proposal was added (`ac principles list` unchanged), and a subsequent
  manual miner run still emits all the fixture candidates (the watermark did not move). No
  scheduler entry (cron/launchd) was created in the sandbox.
- **Fails if:** any automatic path mines, proposes, or advances the watermark.

### C11 — A cheap passive nudge appears only when many unswept sessions have accumulated for this project, and disappears after a sweep
- **Observe:** Render the statusline (and/or SessionStart banner) for `$P` via its hook with
  normal stdin JSON: (a) with unswept `$P` sessions below the threshold → no miner hint;
  (b) above the threshold → exactly one short line/segment suggesting the sweep; (c) above the
  threshold but only for a different project `$Q` → no hint in `$P`; (d) after a sweep of `$P`
  → the hint is gone. Cheapness: in (b), make the session files large (e.g. several ≥500 MB
  sparse files via `truncate -s`) → the render completes in well under a second
  (`time` shows no multi-second transcript read) and still shows the hint.
- **Fails if:** the hint shows below threshold, for another project, or after a sweep; it spans
  multiple lines; or render time scales with transcript size (it parses transcripts in the hot
  path).

### C12 — The miner moment is governed by the single capture spec, and the command's report is bounded
- **Observe:** Read the capture spec (`templates/principle-capture.md`, per ADR-060) and the new
  slash command. The spec's moment table has a miner/transcript-sweep row stating: the 10-per-
  sweep cap (overriding the per-moment 3 for this moment only), strongest-first ordering, that
  `--from-session` is available with the transcript's session id, and the human-only/lift rules
  apply. The command defers to that row rather than restating the cap/rules inline, never
  instructs the agent to open raw transcript files (only the miner's output), and its reporting
  slot is bounded to the spec's one line (`proposed N principle(s) — …`) plus at most one
  "N more turns — run again" line (revised R1: driven by the miner's `remaining`), silent on the extra line when nothing remains.
- **Fails if:** the cap or rules are duplicated/contradicted in the command (drift bait,
  ADR-060); the agent is told to read transcripts directly; or the report slot has no bound.

### C13 — The whole test suite passes, including new fixture-driven tests for both hosts
- **Observe:** `node --test tests/` from the repo root → exit 0, zero failures, and the run
  includes tests exercising Claude and Codex fixture transcripts (tool results, slash-command
  expansions, subagent files, secrets) rather than only prompt/string assertions.
- **Fails if:** any test fails or errors at load, or the miner's behaviour is covered only by
  assertions on doc text.
