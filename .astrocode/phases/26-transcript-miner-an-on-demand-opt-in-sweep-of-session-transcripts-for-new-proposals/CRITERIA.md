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

### C4 — Repeats are grouped across sessions and the threshold holds: ≥2 distinct sessions or one explicit rule qualifies; a lone one-off correction does not
- **Observe:** Fixtures in `$P`: the same steer phrased near-identically in 3 different sessions
  (and twice more inside one of those sessions); an explicit rule stated once ("from now on
  always …"); a one-off, non-rule correction appearing in a single session ("no, not that
  file"). Run the miner → the repeated steer appears as ONE candidate whose recurrence is
  3 distinct sessions (the in-session repeats do not inflate it to 5) and references those
  sessions; the explicit rule qualifies; the one-off correction is either absent from the
  proposal candidates or explicitly marked below threshold, and is never ranked above a
  qualifying one.
- **Fails if:** the repeat appears as three separate candidates; recurrence counts lines rather
  than distinct sessions; or a single one-off correction is offered as proposal-qualifying.

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
- **Observe:** Seed `$P` with 13 distinct qualifying steers of differing strength (some recurring
  in 2–4 sessions, some single explicit rules). Drive one sweep exactly as the new slash command
  prescribes for its mechanical steps (its miner invocation, then the capture spec's prescribed
  `ac principles add … --propose` per lifted candidate, using the candidate text verbatim as the
  lift, then whatever watermark-advancing step it prescribes). Observe: ≤10 proposals are
  created, they are the highest-recurrence ones (then explicit rules), and the run reports the
  remaining count. Drive a second sweep the same way → the 3 remaining steers surface and are
  proposable; the 10 already proposed do not resurface as new candidates.
- **Fails if:** more than 10 proposals come out of one sweep; weaker candidates are chosen over
  stronger ones; or the unprocessed 3 are marked swept and never surface again.

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
  "N more candidates — run again" line, silent on the extra line when nothing remains.
- **Fails if:** the cap or rules are duplicated/contradicted in the command (drift bait,
  ADR-060); the agent is told to read transcripts directly; or the report slot has no bound.

### C13 — The whole test suite passes, including new fixture-driven tests for both hosts
- **Observe:** `node --test tests/` from the repo root → exit 0, zero failures, and the run
  includes tests exercising Claude and Codex fixture transcripts (tool results, slash-command
  expansions, subagent files, secrets) rather than only prompt/string assertions.
- **Fails if:** any test fails or errors at load, or the miner's behaviour is covered only by
  assertions on doc text.
