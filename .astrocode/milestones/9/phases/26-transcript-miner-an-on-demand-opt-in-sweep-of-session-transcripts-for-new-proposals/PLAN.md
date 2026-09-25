# Plan — phase 26: Transcript miner (an on-demand, opt-in sweep of session transcripts for new proposals)

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, named exports only, `die()` +
`✓`/`•`/`⚠`/`⊡` glyphs, a `node:test` test per `lib/` change, real fs/git in tests, the
load-bearing comment voice, §Voice reporting budgets) and `.astrocode/DECISIONS.in-force.md`:
- ADR-018: red-test imports.
- ADR-020: wave-green.
- ADR-029: per-verb flag allowlist.
- ADR-030: no external service in lib/bin.
- ADR-043/054: unknown ≠ empty.
- ADR-046: hook helper owns the shared math and lib imports it.
- ADR-053: strict equality, never similarity.
- ADR-055: voice.
- ADR-057: home store, `.local/` never syncs.
- ADR-058: the machine only proposes.
- ADR-060: the single capture spec.

It also follows this phase's `CONTEXT.md` (D1–D8) and aims at every criterion in
`CRITERIA.md` (C1–C13).

**Precondition: do not start executing until phases 24 AND 25 are on `develop`.**
Only phase 23 has landed (HEAD `76dc8f8`). Phases 24 and 25 are planned but have not been
executed.
- **Phase 24 is a hard code dependency.** This phase calls, and never forks, phase 24's:
  - matcher `lib/principlematch.mjs` (`normaliseStatement`, `statementTokens`,
    `findCandidates`, `STOPWORDS`);
  - propose-time dedupe in `proposePrinciple` (an exact repeat becomes a sighting on any
    status, so a rejected entry is never re-queued);
  - `ac principles match` / `ac principles sight`;
  - the §5 "consult `match` before proposing" step in `templates/principle-capture.md`.

  CRITERIA C8 depends on all of these.
- **Phase 25 is a shared-file dependency.** It edits `bin/ac.mjs`, `hooks/_astro-ctx.mjs`,
  `MANUAL.md`, `tests/commands.test.mjs` and the DECISIONS files. Every task here edits
  those files **as phases 24/25 leave them**.

If `lib/principlematch.mjs` or `recordSighting` is absent when t10/t13/t14 run, the
executor STOPS and reports it. It never writes a second matcher or dedupe (the ADR-053 /
ADR-060 "two copies diverge" trap). Pre-existing noise that is not this phase's to fix: a
leaked `.claude/worktrees/wf_014a0607-589-4` worktree is sitting in the repo. Do not treat
it as this run's leak.

**Test strategy: test-first and serialized, chosen explicitly.**
- Every new `lib/` module, the CLI verb and the hook nudge get a RED task. RED tasks
  `depends_on` at most the fixture builder (t1), and each implementation task `depends_on`
  its RED task.
- RED unit files reach every not-yet-existing symbol ONLY through
  `const { fn } = await import('../lib/x.mjs')` inside async test bodies (ADR-018). That
  includes new exports added to the existing `hooks/_astro-ctx.mjs`.
- The CLI and hook RED files drive `bin/ac.mjs` / `hooks/*.mjs` as subprocesses, so a missing
  verb shows up as a non-zero exit or missing output, never as a load crash.
- The fixture helper (t1) is a real file that RED files may import statically, because it
  exists before they run.

Two tasks write their test inside the same task, first:
- **t2**: tiny pure path helpers, whose tests must exist in wave 1 so t10/t11 can build on
  them.
- **t3/t4**: prose plus the guards that assert on that prose. A separate RED task would be
  RED against text that doesn't exist yet.

**Guards to respect everywhere.**
- `tests/forge_standalone.test.mjs` fails any `lib/`/`bin/`/`workflows/` file matching
  `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`. New comments cite
  D-numbers/ADRs, never that service.
- `hooks/_astro-ctx.mjs` must NOT import from `../lib`, because hooks are copied standalone.
  Only lib → hooks imports are allowed (the ADR-046 direction).
- `tests/hostile-env.test.mjs`: every `spawnSync(`/`spawn(` sets `windowsHide: true`.
- No test may touch the real `~/.astro/principles`, `~/.claude` or `~/.codex`. Every test
  that runs `ac`/a hook sets `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and
  `ASTRO_PRINCIPLES_DIR` to `mkdtempSync` dirs.
- **Do NOT reuse `lib/stats.mjs`'s `jsonLines()`.** It does `readFileSync(...).split('\n')`,
  which is the exact whole-file load C5 forbids. The miner has its own chunked reader (P3).
- **Do NOT copy `lib/stats.mjs`'s single-dir `transcriptDir()` for discovery.** It reads one
  config dir only, so profile B would be silently missed (C1). Claude discovery goes through
  `lib/hosts/claude.mjs` `configTargets()`.
- The host bridge is NOT used by any task. Reading the user's host home is outside its
  allowed uses.

---

## Decisions this plan pins (CONTEXT "Open for the planner" + what the criteria need)

**P1 — Surface.**
- `ac principles mine [--all | --project <path>] [--rescan] [--json]` is **read-only**
  towards the watermark. It scans, groups, ranks and emits candidates, and writes only a
  pointer-only run record (P6).
- `ac principles mine --advance <sweep-id>` commits that run record into the watermark. The
  sweep is **two steps on purpose**:
  - D4/D6: the watermark moves only past material the agent actually processed. A failed
    lift must not mark candidates swept.
  - C1/C2/C9/C10 run the miner repeatedly and expect the same material each time.

  `/astro-mine` runs read → sight/lift → advance.
- ADR-029 row: `'principles mine': ['all', 'project', 'rescan', 'json', 'advance']`.
- `rescan` joins `PRINCIPLES_BOOLEAN_FLAGS` (`all` and `json` are already in it). `--project`
  and `--advance` take values.
- `--all` together with `--project` dies.
- `mine` without `--advance` calls `principlesSync` first like its siblings, because matches
  must see the latest accepted/rejected entries. `--advance` does not sync: it only touches
  `.local/`.
- Exit 0 on "nothing new".

**P2 — Scope (D1).**
- **Default: the current project.** `root = findAstroRoot(cwd) ?? cwd`, using
  `findAstroRoot` imported from `hooks/_astro-ctx.mjs`. Roots checked are
  `unique([root, realpathSync(root)])`, because macOS `/var` vs `/private/var` would
  otherwise yield a different slug.
- **Claude**: for every dir in `configTargets()` (base + every jean-claude profile +
  `CLAUDE_CONFIG_DIR`), read `<dir>/projects/<transcriptSlug(r)>/*.jsonl`.
  - TOP-LEVEL files only. `<session>/subagents/**` and `<session>/workflows/**` are never
    enumerated (D2 subagent + workflow exclusion). `isSidechain: true` lines are also
    excluded defensively.
- **Codex**: `codex.baseConfigDir()/sessions/**/*.jsonl` (recursive `readdirSync`). Keep a
  rollout when its `session_meta.payload.cwd` is exactly one of the roots. Only the first
  line is read for discovery.
- Sessions started in a sub-directory are reached with `--project <subdir>` or `--all`.
  Claude's slug is lossy, so prefix-matching it would read other projects (C1). Codex uses
  the same exact rule for consistency.
- `--project <path>` REPLACES the default root with `resolve(path)` (C1: Q appears and A/B/C
  do not).
- `--all`: every `<dir>/projects/*/` top-level `*.jsonl` of every Claude config dir, plus
  every Codex rollout.
- Every candidate carries `project` = `basename` of its session's `cwd`. The lift rule still
  strips project nouns.

**P3 — Streaming reader (`lib/transcripts.mjs`, D3, C5).**
- `readLines(file, { start = 0, maxLineBytes = MAX_LINE_BYTES, chunkBytes = 65536 })` is a
  sync generator over `openSync`/`readSync` with a reused `Buffer`.
- It yields `{ text, start, end }` per complete, `\n`-terminated line. For a line longer than
  `MAX_LINE_BYTES = 4 MiB` it yields `{ oversized: true, start, end }` WITHOUT materialising
  the line: the in-progress bytes are discarded once they pass the cap. A human turn is never
  4 MiB, and a single huge tool result must not blow a 64 MB heap.
- A trailing partial line (the session is still being written) is NOT yielded, and `end`
  stops before it. The watermark therefore never records half a line.
- Memory is bounded by `chunkBytes + maxLineBytes` regardless of file size.

**P4 — Human-turn classification per host (D2, D7, C2, C9).** Shapes are pinned from the
STRUCTURE of real local Claude transcripts, checked during planning (field names and counts,
never content). t1 re-verifies them and records the check in its fixture-builder header.

- **Claude line kinds.**
  - **Known ignorable types**: `mode, bridge-session, file-history-snapshot,
    file-history-delta, system, atis-latch, attachment, last-prompt, ai-title,
    queue-operation, pr-link, cost-state, permission-mode, frame-link, summary,
    custom-title`. These are counted as `ignored` and never as skipped.
  - **Unrecognised**: any other `type`, a missing `type`, or a `user`/`assistant` line whose
    `message.content` is neither a string nor an array. These are counted as
    `skipped.unrecognised`.
  - **Malformed**: `JSON.parse` failure, including binary garbage. Counted as
    `skipped.malformed`.
  - **Oversized**: counted as `skipped.oversized`.
- **Claude `user` line → human turn** only when ALL of these hold:
  - `!isSidechain`, `!isMeta`, `!isCompactSummary`, no `toolUseResult`;
  - the content is a string or an array of only `text` blocks (a `tool_result` block means
    excluded as `tool-result`);
  - `origin` is absent or `origin.kind === 'human'` (`task-notification`/`coordinator`/… are
    excluded as `injected`);
  - the text, after trim, does not start with one of `<local-command-caveat>`, `<bash-input>`,
    `<bash-stdout>`, `<bash-stderr>`, `<local-command-stdout>`, `<task-notification>`,
    `<system-reminder>` or `[Request interrupted`.

  Embedded `<system-reminder>…</system-reminder>` spans are stripped from otherwise-human
  text.
- **Slash commands.** A non-meta user line whose text starts with `<command-message>` is a
  command invocation. Its human text is ONLY the `<command-args>…</command-args>` content,
  and a missing or empty args tag means no human text. The expanded command body is the NEXT
  user line with `isMeta: true` (observed), so it is already excluded by `!isMeta`.
- **Claude assistant line → context.** Join the `type: 'assistant'` line's
  `message.content[].type === 'text'` blocks. `tool_use`/`thinking` blocks are ignored. The
  most recent assistant text before a human turn is its `context`.
- **Claude headless session** (`claude -p` / SDK / fleet): any `user` line whose
  `entrypoint` exists and is not `'cli'` (observed: `sdk-cli`). The WHOLE file's human turns
  are dropped, and the file is counted in `sessions.headless`. A missing `entrypoint` (older
  CLI) counts as interactive.
- **Codex** (pinned from the Codex CLI rollout format; t1 verifies it against a real rollout
  if one exists on the machine and otherwise says so in the header):
  - Lines are `{ timestamp, type, payload }`. The first line is
    `type: 'session_meta'` with `payload.{id, cwd, originator, source?}`.
  - **Human turn**: `type: 'response_item'`, `payload.type: 'message'`,
    `payload.role: 'user'`. Its text is the join of the `input_text` blocks, EXCLUDING text
    that starts with `<environment_context>`, `<user_instructions>`,
    `# AGENTS.md instructions` or `<INSTRUCTIONS>` (excluded as `injected`).
  - **Assistant context**: `response_item` message with `role: 'assistant'`, from its
    `output_text` blocks.
  - **Known ignorable**: `turn_context`, `event_msg` (its `user_message` duplicates the
    response_item and is deliberately not used, so turns are never counted twice),
    `compacted`, and `response_item` payload types `function_call`, `function_call_output`
    (excluded `tool-result`), `reasoning`, `local_shell_call`, `custom_tool_call`,
    `custom_tool_call_output` and `web_search_call`.
  - **Unrecognised**: anything else, including a legacy first line without a `type`.
  - **Headless**: `originator` matches `/exec/i` or `source === 'exec'`, and the whole file
    is dropped.
- `scanSession(info, { start, ctxStart })` returns
  `{ turns: [{ text, start, end, ctxStart, ctxEnd, context }], end, ctxOffset, headless, skipped: { malformed, unrecognised, oversized }, excluded: { … } }`.
  - `turns` holds ONLY human turns. Context text is kept only for the latest assistant line,
    tail-capped, so memory stays flat.
  - Lines in `[ctxStart, start)` are read for context only, never as turns. This is how
    appended material after a watermark still gets its preceding assistant turn (C2/C6).

**P5 — Steers, keys, threshold, ranking (`lib/mine.mjs`, D2/D5/D6, C4/C7).**
- **Cue lists** (exported, frozen, bilingual EN/IT), matched as whole words or phrases
  against `normaliseStatement(sentence)`. Apostrophes normalise to spaces, so `d'ora` becomes
  `d ora`.
  - `RULE_CUES` (explicit rule): `always, never, from now on, going forward, from here on,
    every time, in future, in the future, as a rule, sempre, mai, d ora in poi, da ora in
    poi, d ora in avanti, da adesso, ogni volta, in futuro`.
  - `STEER_CUES` (correction / preference): `no, don t, do not, dont, stop, instead, rather,
    i prefer, i d prefer, prefer, not like that, wrong, shouldn t, should not, avoid, non,
    invece, preferisco, preferirei, evita, smettila, sbagliato`.
- **Steer sentences.** Redact the human text first (`redactSecrets`, redact-then-truncate
  exactly as `principles.mjs` `buildSource`). Then split on `/(?<=[.!?])\s+|\n+/`. A sentence
  containing any cue is one **occurrence**, and `explicit` is true when it contains a
  `RULE_CUE`.
- **Group key** (one key function, no pairwise similarity, ADR-053):
  - `toks` = phase 24's `statementTokens(sentence)` minus `MINE_FILLER`
    (`please, ok, okay, just, also, again, really, actually, hey, per, favore, dai`).
  - `pol` = the sorted set of polarity words present in the normalised sentence
    (`not, no, never, don, dont, nor, non, mai, always, sempre`). These are stopwords to the
    matcher, so they are kept separately to stop "always X" and "never X" from colliding.
  - When `toks.length ≥ 3`, `key = toks.join(' ') + '|' + pol.join(' ')`. Otherwise
    `key = normaliseStatement(sentence)`.
  - `keyHash = sha256(key).slice(0, 16)`.
- **Recurrence** is the number of DISTINCT session ids across occurrences plus the stored
  `seen` sessions for that key (P6). In-session repeats never inflate it (C4).
- **A group qualifies** when `recurrence ≥ 2 || explicit`. Non-qualifying groups are counted
  in `belowThreshold` and remembered in `seen` on advance, so a later second session lifts
  them over the bar.
- **Rank**: recurrence desc, then explicit desc, then latest occurrence desc, then `keyHash`
  asc (deterministic).
- **Store matches** (phase 24, read-only): `findCandidates(loadPrinciples(dir).entries, text)`.
  - A group with an `exact` hit goes to `sightings` (pinned target via phase-24
    `pickExactTarget` semantics — the command records it with `ac principles sight`). It
    does not count against the cap and is never offered as a new proposal (C8: a rejected
    entry is never re-queued).
  - Overlap-only hits stay candidates with `matches[]` (id, status, reason, shared). The
    agent decides per spec §5 (phase 24), and never rephrases to dodge a rejected match.
- **Cap**: `MINE_CAP = 10` qualifying candidates emitted, strongest first. The rest go to
  `held` (pending) and are reported as `remaining`. The spec's miner row states the same 10,
  and t7 guards their equality (single-source discipline, D6).
- **Output ceilings** (per-run size handed to the agent):
  - candidate `text` ≤ 300 chars;
  - `excerpt` = the whole redacted human turn ≤ 500;
  - `context` = the tail of the redacted assistant turn ≤ 300;
  - `sessions` ≤ 10 ids;
  - `sightings` ≤ 20 items.

  Every field is redacted BEFORE truncation.

**P6 — Watermark and run records (`lib/minestate.mjs`, D4, C6/C7/C10).** Location:
`<principlesDir()>/.local/mine/`.
- `.local/` is already in the store's `.gitignore` (phase 22 `lib/principlesync.mjs`) and is
  phase 25's usage-log home. Per-machine data therefore never syncs, and no new home-dir
  exception to ADR-057 is needed.
- **Files**:
  - `files/<slug>.json` = `{ version: 1, files: { "<abs path>": { offset, ctxOffset, headless, host, session } } }`,
    one per project slug. For Codex the slug is `transcriptSlug(session cwd)`. The hook
    reads ONLY this file (P7).
  - `steers.json` = `{ version: 1, pending: [{ keyHash, explicit, sessions, pointers: [{ file, host, session, start, end, ctxStart, ctxEnd }] }], seen: { <keyHash>: { sessions: [≤20], explicit, at } } }`.
    `SEEN_MAX = 5000` keys; the oldest `at` is dropped first.
  - `runs/<sweepId>.json` holds the scanned offsets per file, plus `emitted`/`held`/`below`/
    `sighted` as keyHash + sessions + pointers. The newest `RUNS_KEEP = 5` are kept.
- **No text ever reaches these files.** They hold pointers, byte offsets, session ids and
  hashes of redacted keys only (C3). A held-back candidate's text is re-read from its
  pointer on the next run. A pointer that no longer reads as a human turn is dropped and
  counted in `skipped.stalePending`.
- **`advance(storeDir, id)`** runs under one `withLock(<mine>/.lock)`:
  - offsets only move forward (`max`);
  - in-scope pending is replaced by the run's `held`;
  - `seen` gains `emitted ∪ below ∪ sighted`, with sessions unioned. D5: a later recurrence
    of an already-proposed steer re-qualifies and lands as a phase-24 sighting;
  - the run record is deleted.

  A second `--advance` of the same or an unknown id dies with
  `unknown or already-advanced sweep "<id>"`.
- **Read semantics.** Each in-scope file is read from its `ctxOffset`/`offset`, or from 0
  under `--rescan`. In-scope `pending` pointers are included (all of them under `--rescan`
  too).
  - `nothingNew = true` iff no in-scope file has bytes past its offset and no in-scope
    pending exists. No run record is written in that case, and `sweep` is `null`.

**P7 — Nudge (D8, C10/C11).** It lives in `hooks/_astro-ctx.mjs` (standalone, no lib
import).
- Exports: `transcriptSlug(root)` (the ONE copy; `lib/stats.mjs` and `lib/transcripts.mjs`
  import it, ADR-046 direction), `principlesStoreDir(env)` (mirror of `principlesDir`),
  `mineFilesPath(storeDir, slug)`, `claudeConfigDirs(env)` (mirror of `configTargets()`
  keys), `unsweptSessions(root, env)` and `MINE_NUDGE_SESSIONS = 10`.
- The two mirrors are guarded by parity tests against the lib originals.
- `unsweptSessions` = the number of top-level `*.jsonl` files in
  `<configDir>/projects/<slug(root|realpath)>/` across every config dir whose `statSync().size`
  exceeds the recorded `offset` (absent = 0).
  - It uses `readdirSync` + `statSync` only and NEVER opens a transcript.
  - Codex is not counted: its rollouts are date-sharded, and attributing one to a project
    means reading its first line, which is parsing in the hot path. This is documented in
    the header.
  - The count is not cached. A cache is a second source that would go stale right after a
    sweep (C11 d), and stat is cheap.
- `readContext` adds `mine: { unswept }`.
  - `renderSegmentParts` pushes exactly one state segment `N unswept → /astro-mine` only
    when `unswept ≥ MINE_NUDGE_SESSIONS`.
  - `renderBanner` adds exactly one line
    `N unswept sessions here — /astro-mine proposes principles from them` under the same
    condition.
  - Silent otherwise. No hook ever writes under `.local/mine/`.

**P8 — JSON output shape** (what `/astro-mine` reads; pinned so t4/t8/t13/t14 converge):
`{ sweep, scope: { mode: 'project'|'all', roots }, nothingNew, sessions: { scanned, headless }, candidates: [{ id: 'c1'…, text, excerpt, context, explicit, recurrence, sessions, host, project, fromSession, fromRef, matches }], sightings: [{ id, status, text, excerpt, fromSession, fromRef, sessions }], remaining, belowThreshold, skipped: { malformed, unrecognised, oversized, stalePending } }`.
- `fromSession` = the latest occurrence's session id.
- `fromRef` = `"transcript <host>:<fromSession>"`.

**Text output** (humans/debug; one line each):
- `• N candidate(s) from S session file(s) — sweep <id>`
- then `  1. [R sessions|rule] <text>` per candidate
- `• K exact repeat(s) to record as sightings`
- `• M more candidate(s) held for the next sweep`
- `⚠ skipped X transcript line(s): a malformed, b unrecognised, c oversized` (only when
  X > 0)
- nothing new → `• nothing new to mine (S session file(s) checked)`.

**P9 — `/astro-mine` (`commands/astro-mine.md`, D3/D6, C12).** Frontmatter:
`allowed-tools: Bash, Read`, `argument-hint: "[--all | --project <path>] [--rescan]"`. The
steps are pinned because the SLOTS guard anchors on them:
1. `1. **Run the miner.**` — run `ac principles mine --json` with only the `--all` /
   `--project <path>` / `--rescan` the user gave. If `nothingNew`, say `nothing new to mine`
   in one line and stop. When `skipped` totals > 0, add at most one
   `⚠ skipped N transcript line(s)` line.
2. `2. **Record exact repeats.**` — for each `sightings[]` item run
   `ac principles sight <id> --from-session "<fromSession>" --from-ref "<fromRef>" --excerpt "<excerpt>"`.
   Say nothing here; the step 5 line counts them.
3. `3. **Lift the candidates.**` — follow `` `$(ac path templates)/principle-capture.md` ``,
   its transcript-sweep row. Take `candidates[]` in the order given, which is already
   capped and strongest first. Pass `--from-session "<fromSession>" --from-ref "<fromRef>"`.
   No number and no lift rule are restated here.
4. `4. **Advance the watermark.**` — `ac principles mine --advance <sweep>`, only when every
   call in steps 2–3 succeeded. On any failure do not advance: the next run retries.
5. `5. **Report.**` — the spec's one line (§7, with phase 24's `seen again` extension), plus
   at most one `N more candidates — run again` line when `remaining > 0`, and silent on it
   otherwise. A failure is the spec's single `⚠ principle capture failed: <first error>`
   line. Zero proposals and zero sightings → say nothing.

`## Never`:
- never open, read, grep or list transcript files or dirs (`projects/`, `sessions/`,
  `*.jsonl`) — only the miner's output;
- never write under `~/.astro/principles/` or `.local/mine/`;
- never accept, reject, merge or reopen;
- never run from a hook or on a schedule;
- never pass `--rescan` unless the user asked.

**P10 — Capture spec (`templates/principle-capture.md`, C12).** The file stays the single
source.
- The first ```sh fence (phase 23's `extractInvocation`) stays byte-identical, and so do
  §7's existing sentences and §3's "At most **3** proposals per moment".
- Add:
  - a §1 bullet **Transcript sweep (`/astro-mine`)**: material comes only from
    `ac principles mine --json`, which emits only turns the human typed (the engine excludes
    tool results, injected context, command bodies, subagent and headless sessions);
  - in §3, **one exception** stated once: the transcript sweep takes at most **10** per
    sweep, strongest first (recurrence, then explicit rule), for this moment only. The
    engine emits no more than that and holds the rest;
  - a §5 table row
    `| Transcript sweep | the candidate's \`fromRef\` (\`"transcript <host>:<session>"\`) | the candidate's \`excerpt\` |`,
    plus a later `sh` fence showing the invocation with `--from-session "<fromSession>"`
    appended.
  - The "always omitted" sentence is rewritten to: `--from-session` is omitted in every
    moment except the transcript sweep, whose candidates carry the transcript's session id.
    Elsewhere no session id reaches a command, so do not probe for one. This removes the
    false universal.
  - §7 gains one sentence: the transcript sweep alone may add at most one
    `N more candidates — run again` line, only when the miner held candidates back.
  - A new short section, **Transcript sweep threshold (D5)**: a steer qualifies when it
    recurs in ≥2 distinct sessions or was stated once as an explicit rule. The engine
    applies it, and exact repeats are recorded as sightings.

---

## Tasks

### t1 — Transcript fixture builders (both hosts), with verified shape notes
- **file:** `tests/fixtures/minefixtures.mjs` (new; its name matches no `node --test`
  default pattern, so it is never run as a test)
- **depends_on:** —
- Named exports:
  - `sandbox()` → `{ home, claude, codex, store, env }`, where every dir is a `mkdtempSync`
    and `env` carries `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `ASTRO_PRINCIPLES_DIR`;
  - `addProfile(sb, name)` → registers `<claude>/.jean-claude/profiles.json` pointing at a
    new dir;
  - `claudeProjectDir(configDir, root)`, `writeClaudeSession(configDir, root, id, lines)`,
    `writeClaudeSubagent(configDir, root, sessionId, agentId, lines)` (under
    `<id>/subagents/`), `appendLines(file, lines)`;
  - Claude line builders: `cHuman(text, { origin })`, `cAssistant(text)`,
    `cToolResult(text)`, `cMeta(text)`, `cReminder(text)`, `cTaskNotification(text)`,
    `cCommand(name, args)` + `cCommandBody(text)` (isMeta, parentUuid chained),
    `cSidechain(text)`, `cHeadless(text)` (`entrypoint: 'sdk-cli'`), `cUnknownType()`;
  - `writeCodexRollout(codexHome, { id, cwd, originator, date }, lines)` under
    `sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`;
  - Codex line builders: `xUser(text)`, `xAssistant(text)`, `xEnvContext(text)`,
    `xUserInstructions(text)`, `xToolOutput(text)`;
  - `GARBAGE_LINES` (a truncated JSON line, a valid unknown-shape line, a binary-garbage
    line);
  - `SECRETS` (an `sk-ant-…`/`sk-…` key, a `ghp_…` token, `AKIA…`, `password=…`,
    `Bearer …`), all matching `lib/redact.mjs` shapes.

  Every line carries the real field set: `parentUuid, isSidechain, type, message, uuid,
  timestamp, userType, entrypoint, cwd, sessionId, version, gitBranch`, plus `origin` where
  the real one does.
- **Verification (codex.mjs methodology, recorded in the header comment):**
  - Check the Claude builders against the STRUCTURE of one real local transcript (field
    names/types/line kinds only, never content): the `isMeta` command body following a
    `<command-message>` line, `origin.kind`, `entrypoint: 'sdk-cli'` for headless, and
    subagents under `<session>/subagents/`.
  - For Codex, if a rollout exists under `$CODEX_HOME`/`~/.codex/sessions` on this machine,
    check it the same way. Otherwise write "pinned from the Codex CLI rollout format, not
    verified against a live install on <date>". P4's unknown-line counting makes a later
    shape drift visible, never silent.
  - Do NOT use the host bridge for this.
- No test file changes; the suite stays green trivially.

### t2 — Shared transcript/watermark path helpers in the hook helper (test-in-task)
- **files:** `hooks/_astro-ctx.mjs`, `lib/stats.mjs`, `tests/transcript_paths.test.mjs` (new)
- **depends_on:** —
- Write the test file FIRST. It reaches new hook exports via `await import('../hooks/_astro-ctx.mjs')`.
  Cover:
  - `transcriptSlug('/a/luigi.lauro/CIL_Quote')` → `-a-luigi-lauro-CIL-Quote` (the #38
    cases);
  - `principlesStoreDir` parity with `lib/principles.mjs` `principlesDir` (with and without
    `ASTRO_PRINCIPLES_DIR`);
  - `claudeConfigDirs` parity with `[...configTargets().keys()]` under sandbox fixtures (no
    registry; `profiles.json` with two profiles; `.jean-claude/meta.json` path;
    `CLAUDE_CONFIG_DIR` not otherwise covered). Import `configTargets` with a cache-busting
    query like `tests/stats.test.mjs`;
  - `mineFilesPath(store, slug)` ends in `.local/mine/files/<slug>.json`;
  - `unsweptSessions`: counts top-level `*.jsonl` only (a `subagents/` file is not counted),
    across two config dirs; a file whose size equals its recorded offset is swept; appended
    bytes make it unswept again; a missing or corrupt files JSON reads as "nothing swept";
    another project's dir is never counted;
  - `MINE_NUDGE_SESSIONS === 10`.
- Then implement P7's helpers (NOT the render wiring, which is t12).
  - Header paragraph: why the slug lives here and lib imports it (ADR-046 direction, one
    copy, #38); why `claudeConfigDirs` is a mirror guarded by parity (hooks cannot import
    lib); why stat-only (D8).
  - `lib/stats.mjs` `transcriptDir` switches to the imported `transcriptSlug`. Its
    behaviour is unchanged.
- `node --test tests/transcript_paths.test.mjs tests/stats.test.mjs tests/statusline.test.mjs tests/hooks-update.test.mjs tests/hostile-env.test.mjs`
  → green.

### t3 — Capture spec: the transcript-sweep row (+ the one guard it obsoletes)
- **files:** `templates/principle-capture.md`, `tests/principle_capture.test.mjs`
- **depends_on:** —
- Apply P10 to the spec as phase 24 left it.
- In the SAME task (ADR-020: this edit breaks it), rewrite the test
  `states --from-session is always omitted` to
  `states --from-session is omitted in every moment except the transcript sweep`. Assert
  the new sentence, and that the transcript-sweep table row names `--from-session`.
- Add tests:
  - the spec has a transcript-sweep row/bullet stating `10` per sweep, "strongest first",
    and "this moment only";
  - the "at most **3**" guard still passes (existing test untouched);
  - the new §7 sentence names `N more candidates — run again`;
  - the first `sh` fence is unchanged, and the existing end-to-end `extractInvocation` test
    still runs green.
- `node --test tests/principle_capture.test.mjs tests/commands.test.mjs` → green.

### t4 — `/astro-mine` command + help line + reporting-slot and single-source guards
- **files:** `commands/astro-mine.md` (new), `commands/astro-help.md`,
  `tests/commands.test.mjs`, `tests/mine_command.test.mjs` (new)
- **depends_on:** —
- Write the command per P9, in the house structure (`commands/astro-debt.md` shape: steps,
  then `## Never`). Every reporting slot states its bound inline: step 1 "in one line",
  step 2 "say nothing here", step 5 the spec's one line + "at most one" + "silent otherwise"
  + "say nothing".
- `astro-help.md`: one line —
  ``- `/astro-mine` — sweep this project's past sessions for principles you kept stating (on demand, never automatic)``.
- `tests/commands.test.mjs`:
  - add `astro-mine.md` to `LOOP_COMMAND_SRC`;
  - add SLOTS rows: `1 run + nothing new` (`1. **Run the miner.` → `2. **Record exact repeats`),
    `2 sightings` (`2. **Record exact repeats` → `3. **Lift the candidates`),
    `4 advance` (`4. **Advance the watermark` → `5. **Report`),
    `5 report` (`5. **Report` → `## Never`).
- `tests/mine_command.test.mjs` (C12 guards, readFileSync-only), asserting that the command:
  - contains the `$(ac path templates)/principle-capture.md` pointer;
  - does not contain `strip every project noun`;
  - states no cap number: no `\b10\b` and no `at most \d` outside the report's
    `N more candidates` line;
  - runs `ac principles mine --json`, and runs `--advance` only in step 4 behind "every call
    … succeeded";
  - uses `--from-session` in step 3;
  - forbids `projects/`, `sessions/` and `.jsonl` reading, where those tokens appear ONLY
    inside `## Never`;
  - names no `accept`/`reject`/`merge`/`reopen` verb outside `## Never`;
  - says `N more candidates — run again` with a silence rule.
- `node --test tests/commands.test.mjs tests/mine_command.test.mjs tests/forge.test.mjs tests/install.test.mjs`
  → green. Install registers every `commands/*.md`, so the file must be a real command with
  frontmatter.

### t5 — RED: watermark / run-record tests
- **file:** `tests/minestate.test.mjs` (new)
- **depends_on:** —
- Load everything inside async tests with
  `const { mineDir, readFilesState, readSteers, writeRun, readRun, advance, SEEN_MAX, RUNS_KEEP } = await import('../lib/minestate.mjs')`.
  Store dirs are `mkdtempSync`.
- Cover P6:
  - paths live under `<store>/.local/mine/` (`files/<slug>.json`, `steers.json`, `runs/`);
  - `advance` moves offsets forward only (a smaller offset never rewinds);
  - `advance` replaces in-scope pending with `held` and leaves out-of-scope pending
    untouched;
  - `advance` unions `seen` sessions for emitted/below/sighted keys and caps at `SEEN_MAX`,
    dropping the oldest `at` first;
  - `advance` deletes the run record, and a second `advance` of the same id rejects with
    `unknown or already-advanced sweep`;
  - `writeRun` keeps only the newest `RUNS_KEEP`;
  - 10 concurrent `advance` calls on distinct runs lose no offsets (lock);
  - a corrupt `files/<slug>.json` reads as empty and is overwritten on advance (never a
    crash);
  - **C6 guard**: in a store made into a git repo with `ensureGitignore` semantics (write
    the phase-22 `.gitignore`), after `advance`, `git status --porcelain` is empty;
  - **C3 guard**: a run written from a candidate set built from secret-bearing text contains
    none of `SECRETS` (`JSON.stringify` of every file under `.local/mine/`).

### t6 — RED: transcript reader tests (both hosts)
- **file:** `tests/transcripts.test.mjs` (new)
- **depends_on:** t1
- Load everything inside async tests with
  `const { readLines, MAX_LINE_BYTES, sessionFiles, classifyClaudeLine, classifyCodexLine, codexSessionMeta, scanSession } = await import('../lib/transcripts.mjs')`.
  Import the fixtures statically.
- Cover P2–P4:
  - `readLines`:
    - yields exact byte `start`/`end`;
    - resumes from a mid-file `start`;
    - does not yield a trailing partial line, and `end` stops before it;
    - yields `{ oversized: true }` for a line over a small injected `maxLineBytes` without
      the text;
    - handles CRLF and multi-byte UTF-8 across chunk boundaries (chunkBytes = 7).
  - `sessionFiles`:
    - default scope finds base + profile B + Codex(cwd = root) and not project Q;
    - `--project Q` finds only Q;
    - `all` finds everything;
    - `subagents/` files are never listed;
    - a Codex rollout with a different cwd is not listed;
    - the realpath variant of the root is found.
  - Claude classification, one assertion each:
    - a typed human turn (with and without `origin`) → human;
    - a `tool_result` array → excluded;
    - `isMeta` → excluded;
    - `<system-reminder>` → excluded;
    - `task-notification` origin → excluded;
    - `<command-message>` with args `from now on never use X4` → human text equals exactly
      the args;
    - the following `isMeta` command body → excluded;
    - `isSidechain` → excluded;
    - an unknown `type` → unrecognised;
    - a known ignorable type → ignored (not skipped).
  - `scanSession`:
    - a headless (`sdk-cli`) file yields zero turns and `headless: true`;
    - garbage lines are counted as malformed/unrecognised while the valid steer still comes
      through;
    - an all-unrecognised file yields zero turns with `skipped.unrecognised === n` (not an
      empty clean result);
    - each human turn carries the preceding assistant text as `context`;
    - starting at a `start` past that assistant line but with `ctxStart` before it still
      gives context.
  - Codex:
    - `codexSessionMeta` reads id/cwd;
    - `codex_exec` originator → headless;
    - `<environment_context>` / `<user_instructions>` user messages → excluded;
    - `function_call_output` → excluded;
    - `event_msg` → ignored (the human turn is counted once);
    - a legacy first line without `type` → unrecognised.

### t7 — RED: miner engine tests
- **file:** `tests/mine.test.mjs` (new)
- **depends_on:** t1
- Load everything inside async tests with
  `const { RULE_CUES, STEER_CUES, MINE_FILLER, MINE_CAP, steerSentences, steerKey, groupSteers, rankGroups, sweep } = await import('../lib/mine.mjs')`,
  and use `await import('../lib/minestate.mjs')` for `advance`. Each test gets a sandbox
  from the fixtures, and the store is seeded through `lib/principles.mjs` verbs.
- Cover P5/P8 plus the sweep:
  - **cues**: "no, not that file" is a steer and not explicit; "from now on always run the
    linter" and "d'ora in poi usa sempre pnpm" are explicit; "thanks, looks good" is no
    steer.
  - **C4 keying**: "Always run the linter before committing." / "please always run the
    linter before committing!" / "ALWAYS run the linter before committing" share one key;
    "never run the linter before committing" has a DIFFERENT key (polarity).
  - **C4 grouping**: the same steer in 3 sessions plus 2 more times inside one of them
    gives ONE candidate with `recurrence === 3`, and `sessions` lists the 3 ids. An explicit
    rule stated once qualifies. A lone "no, not that file" is absent from `candidates` and
    counted in `belowThreshold`.
  - **C4 across sweeps**: a one-off in sweep 1 (advanced), then the same steer in a new
    session in sweep 2, qualifies with recurrence 2 (via `seen`).
  - **C7**: 13 distinct qualifying steers of mixed strength. Sweep 1 emits exactly
    `MINE_CAP` in rank order (recurrence, then explicit) with `remaining === 3`. After
    `advance`, sweep 2 emits exactly those 3. After advancing that too, sweep 3 is
    `nothingNew`.
  - **Cap parity (single source, D6)**: `MINE_CAP === 10`, and the spec's transcript-sweep
    row states the same number (read `templates/principle-capture.md`, extract the number
    beside "per sweep").
  - **C6**: after sweep + advance, a re-sweep is `nothingNew` with `sweep === null`. Then:
    - a new steer appended to an existing session plus one new session → only those are
      emitted, and the appended one carries context from before the old offset;
    - `rescan: true` re-emits the earlier candidates;
    - `sweep()` alone (no advance) never changes `files/`/`steers.json`.
  - **C3**: a steer embedding every `SECRETS` value is emitted with `[REDACTED]`. No secret
    appears in `JSON.stringify(result)` or in any file under the store.
  - **C8**: store holds accepted "Always use pnpm for lockfiles" and rejected "Never write
    semicolons" (reason). Fixture steers restate both exactly (≥2 sessions each) plus a new
    rule. Both restatements land in `sightings` with their ids and statuses (the rejected
    one with its status), never in `candidates`. The new rule is a candidate with
    `fromSession`/`fromRef === 'transcript claude:<id>'`. An overlap-only restatement is a
    candidate whose `matches[]` names the rejected id and reason.
  - **Ceilings**: text ≤ 300, excerpt ≤ 500, context ≤ 300 (tail), sessions ≤ 10, and
    redaction happens before truncation (a secret straddling the cap is still masked).

### t8 — RED: CLI tests for `ac principles mine`
- **file:** `tests/mine_cli.test.mjs` (new)
- **depends_on:** t1
- Subprocess only: `spawnSync(process.execPath, [AC, …], { cwd: P, env: sb.env, input: '', windowsHide: true })`.
  `P` is an `ac init`-ed git repo inside the sandbox. Helpers are copied locally, as the
  house style does.
- Cover:
  - **C1**: default `--json` gives A, B, C and not Q; `--project Q` gives Q only; `--all`
    gives all four; exit 0 and the JSON parses each time; `--all --project x` exits
    non-zero.
  - **C2**: the full exclusion set on both hosts (P4). Survivors: the typed turn, the typed
    slash args and the Codex human line. Each survivor has a non-empty `context`.
  - **C3**: text AND JSON stdout+stderr contain no `SECRETS` value; `grep` of every file
    under `HOME` excluding the fixture transcripts finds none.
  - **C5**: generate a ≥128 MB Claude session (a 1 MB block of tool-result/assistant lines
    written repeatedly, plus one 6 MB single line, plus a qualifying explicit steer as the
    last line). Run
    `node --max-old-space-size=48 bin/ac.mjs principles mine --json` → exit 0, the late
    steer is present and `skipped.oversized ≥ 1`. The file is removed in `after`.
  - **C6**: `ac principles remote <bare>` plus a sync (store clean), then:
    - mine, then `--advance <sweep>`;
    - mine again → `nothingNew: true` and text `nothing new to mine`, exit 0;
    - append a line and add a session → only the new ones;
    - `--rescan` → earlier ones again;
    - `git -C <store> status --porcelain` shows nothing under `.local`.
  - **C7**: drive the command's mechanical steps with 13 steers:
    - mine `--json`;
    - `ac principles add "<candidate text>" --kind preference --why w --propose --from-session <fromSession> --from-ref "<fromRef>" --excerpt "<excerpt>"`
      per candidate;
    - `--advance`.

    Result: ≤ 10 proposed, the strongest ones, `remaining === 3`. A second drive → the 3.
    No earlier one resurfaces.
  - **C8**: the same drive over pre-created accepted/rejected entries (via `ac principles
    add` / `add --propose` + `reject --reason`), using `ac principles sight` for
    `sightings[]`. Then:
    - `show --json` of the accepted entry has `sightingCount ≥ 1`, and there is no
      duplicate entry;
    - the rejected entry still has `status: 'rejected'` and its reason, with no new
      proposal restating it;
    - the new rule is `proposed` and its `source.session` is the transcript session id.
  - **C9**: garbage lines in a Claude session and a Codex rollout → exit 0, the steer is
    emitted, JSON `skipped` ≥ the bad count, and text shows the `⚠ skipped` line. An
    all-unrecognised session → text includes `⚠ skipped` (a clean run has no `⚠`).
  - **C11 d**: 12 unswept `$P` sessions → the statusline hook (stdin
    `{ cwd: P, workspace: { current_dir: P } }`) shows `/astro-mine`. After mine + advance
    it does not.
  - **ADR-029**: `mine --bogus` exits non-zero; `--advance nope` exits non-zero with
    `unknown or already-advanced sweep`.
  - `ac help` lists `principles mine`.

### t9 — RED: nudge + "never runs by itself" hook tests
- **file:** `tests/mine_nudge.test.mjs` (new)
- **depends_on:** t1
- Hooks run as subprocesses with sandbox env. New exports come via
  `await import('../hooks/_astro-ctx.mjs')` inside tests. The watermark "after a sweep" is
  written directly in P6's pinned `files/<slug>.json` format (the end-to-end version is in
  t8).
- Cover P7:
  - **C11 a**: 9 unswept → no hint.
  - **C11 b**: 12 → exactly one statusline segment `12 unswept → /astro-mine`, and the
    SessionStart banner (`hooks/astro-update.mjs`) has exactly one `/astro-mine` line.
  - **C11 c**: 12 unswept for Q only → no hint in P.
  - **C11 d**: a watermark covering them → no hint.
  - **Cheapness**: 12 sparse 600 MB files (`truncateSync`) → the statusline process
    finishes in < 1000 ms and still shows the hint.
  - **C10**: with 12 unswept qualifying fixtures, run every hook `registerHooks` wires
    (statusline, SessionStart `astro-update.mjs`, PreCompact, `astro-session-state.mjs
    prompt|stop`) with normal stdin JSON. Afterwards:
    - `<store>/.local/mine/` does not exist;
    - the store's `.md` count is unchanged;
    - `renderSegmentParts`/`renderBanner` are pure given a ctx (no writes).

### t10 — Transcript reader module
- **file:** `lib/transcripts.mjs` (new)
- **depends_on:** t2, t6
- Implement P2–P4:
  - imports `configTargets` from `./hosts/claude.mjs`, `baseConfigDir` from
    `./hosts/codex.mjs`, and `transcriptSlug` from `../hooks/_astro-ctx.mjs`;
  - named exports as listed in t6;
  - sync, memory-bounded, and no `readFileSync` of a transcript anywhere.
- Header:
  - why a chunked reader and not `stats.mjs`'s `jsonLines` (C5, the 3.1 GB reality check);
  - why the line cap;
  - why a partial last line is never consumed;
  - the observed Claude field evidence (subagents dir, `isMeta` command body, `origin`,
    `entrypoint`);
  - the Codex verification status copied from t1;
  - why known-ignorable vs unrecognised are separate counts (unknown ≠ empty, ADR-043/054).
- `node --test tests/transcripts.test.mjs tests/stats.test.mjs` → green.

### t11 — Watermark / run-record module
- **file:** `lib/minestate.mjs` (new)
- **depends_on:** t2, t5
- Implement P6. Use `atomicWriteJSON`/`readJSON`/`withLock` from `./util.mjs`, and
  `mineFilesPath` from `../hooks/_astro-ctx.mjs` so the hook and the engine agree on one
  path.
- Header:
  - why under the store's `.local/` (phase-22 gitignore, per-machine, no new ADR-057
    exception);
  - why pointers and hashes, never text (C3);
  - why advance is separate from read (D4/D6);
  - why offsets only move forward;
  - why `seen` exists (D5 recurrence across sweeps) and why it is capped.
- `node --test tests/minestate.test.mjs` → green.

### t12 — Nudge rendering in the statusline and banner
- **file:** `hooks/_astro-ctx.mjs`
- **depends_on:** t2, t9
- Implement P7's wiring:
  - `readContext` gains `mine: { unswept: unsweptSessions(root) }`;
  - `renderSegmentParts` pushes the one segment only at or above `MINE_NUDGE_SESSIONS`;
  - `renderBanner` adds the one line under the same condition.

  No hook script needs changing, because all three renderers live here. Comment in the
  debt-segment voice: why it appears only past the threshold (wallpaper otherwise), and why
  it is stat-only (D8).
- `node --test tests/mine_nudge.test.mjs tests/transcript_paths.test.mjs tests/statusline.test.mjs tests/hooks-update.test.mjs tests/hostile-env.test.mjs`
  → green. (The end-to-end "gone after a real `--advance`" case lives in t8.)

### t13 — Miner engine
- **file:** `lib/mine.mjs` (new)
- **depends_on:** t3, t7, t10, t11
- Implement P5, P6 read semantics and P8's result object:
  - `sweep({ scope, rescan, storeDir, env, now })` returns the P8 object and writes the run
    record through `writeRun`;
  - `advanceSweep({ storeDir, id })` delegates to `advance`.
- Imports:
  - `normaliseStatement`, `statementTokens` and `findCandidates` from
    `./principlematch.mjs` (**phase 24; STOP if absent**);
  - `redactSecrets` from `./redact.mjs`;
  - `loadPrinciples`/`principlesDir` from `./principles.mjs`;
  - `findAstroRoot` from `../hooks/_astro-ctx.mjs`.
- Never writes to the store's entries, only `.local/mine/` via `minestate`.
- Header:
  - the D3 split (ac extracts, the agent lifts);
  - why the key is one function over token sets plus polarity and never a similarity score
    (ADR-053);
  - why recurrence counts distinct sessions;
  - why exact store matches become sightings and never candidates (ADR-058, C8);
  - why `MINE_CAP` mirrors the spec row and is guarded.
- `node --test tests/mine.test.mjs tests/minestate.test.mjs tests/transcripts.test.mjs` →
  green.

### t14 — CLI: `ac principles mine` / `--advance`
- **file:** `bin/ac.mjs`
- **depends_on:** t8, t12, t13 (t12 because `mine_cli`'s C11 d case renders the statusline)
- Inside `case 'principles':`, add the `mine` verb per P1/P8:
  - the allowlist row;
  - `rescan` in `PRINCIPLES_BOOLEAN_FLAGS`;
  - `principlesSync` before a read (not before `--advance`);
  - JSON via `json()`, text lines exactly as pinned;
  - `die()` for `--all`+`--project` and for an unknown sweep.

  Add the usage lines
  `ac principles mine [--all|--project <path>] [--rescan] [--json]   sweep past sessions for steers (read-only)`
  and `ac principles mine --advance <sweep-id>   mark that sweep's material as processed`,
  and add `mine` to the unknown-verb list. The verb never reads stdin.
- `node --test tests/mine_cli.test.mjs tests/principles_cli.test.mjs tests/flags.test.mjs tests/forge_standalone.test.mjs tests/cli.test.mjs`
  → green.

### t15 — Docs, canon, final gate
- **files:** `MANUAL.md`, `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** t4, t12, t14
- `MANUAL.md` Principles section gets a "Transcript sweep" paragraph:
  - on demand only (`/astro-mine`; never a hook or schedule; the statusline hint past 10
    unswept sessions);
  - the current project by default, `--all`/`--project` deliberately, every Claude
    profile + Codex;
  - human-typed turns only;
  - secrets redacted;
  - ≥2 sessions or an explicit rule;
  - at most 10 per sweep with the rest held;
  - per-machine watermark in `.local/mine/` (never synced);
  - `--rescan`.

  Add cheat-sheet lines for `mine` and `mine --advance`.
- Record the pinned specifics with `node bin/ac.mjs decision add "Transcript-miner specifics this plan pinned: …" --why "…" --rejected "…"`.
  Record the output as-is and never hand-edit DECISIONS.
  - What it states:
    - the read is read-only and `--advance` commits;
    - the watermark lives under the store's gitignored `.local/mine/` and holds pointers and
      hashes, never text;
    - chunked reading with a 4 MiB line cap;
    - the per-host human-turn rules, including `entrypoint`/`originator` headless detection;
    - the one-function group key and distinct-session recurrence;
    - exact store matches become sightings;
    - `MINE_CAP` is guarded against the spec row;
    - the nudge is stat-only, Claude-only and uncached.
  - Rejected:
    - auto-advancing on read (breaks D6 on a failed lift);
    - storing excerpts in the watermark (C3);
    - a new `~/.astro/mine/` home-dir exception;
    - reusing `jsonLines`;
    - prefix-matching Claude slugs;
    - a similarity score for grouping;
    - a cached nudge count;
    - a fifth host-adapter contract point for transcript discovery (kept in
      `lib/transcripts.mjs` until a third host needs it).
- **Final gate** (C13):
  1. Record a listing of the real `~/.astro/principles` (or its absence).
  2. `HOME=$(mktemp -d) node --test tests/` → 0 failures, including the fixture-driven
     `transcripts`/`mine`/`mine_cli`/`mine_nudge` files for both hosts.
  3. `package.json` dependency count → 0.
  4. The listing is unchanged.

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t2, t3, t4, t5 |
| 2 | t6, t7, t8, t9, t11 |
| 3 | t10, t12 |
| 4 | t13 |
| 5 | t14 |
| 6 | t15 |

Rule checks:
- **Test-first, serialized.**
  - The RED tasks t5/t6/t7/t8/t9 depend on nothing, or only on the fixture builder t1.
  - Each implementation depends on its RED: t11←t5, t10←t6, t13←t7, t14←t8 (+t12 for the C11 d case), t12←t9.
  - Every not-yet-existing symbol is reached through a dynamic `await import`, including the
    new `hooks/_astro-ctx.mjs` exports. The CLI and hook RED files are subprocess-driven.
  - t2/t3/t4 write their tests first inside the task, for the reasons given in the header.
- **Wave-green.** Nothing is deleted or renamed.
  - The one existing-contract change (the spec's "always omitted" sentence) carries the
    guard it breaks inside t3.
  - `lib/stats.mjs` switching to the shared slug is behaviour-identical and proven by
    `stats.test.mjs` inside t2.
  - RED files fail only their own new tests.
- **One owner per wave per file.**
  - `hooks/_astro-ctx.mjs`: t2 (wave 1) → t12 (wave 3, `depends_on` t2).
  - `lib/stats.mjs`: t2 only.
  - `templates/principle-capture.md` and `tests/principle_capture.test.mjs`: t3 only.
  - `tests/commands.test.mjs` and `commands/astro-help.md`: t4 only.
  - `bin/ac.mjs`: t14 only.
  - `MANUAL.md` and the DECISIONS files: t15 only.
  - Every new file has exactly one owner.

  No two tasks in one wave share a file.
- **Every task declares its files and lands a stamped commit.** The final gate is folded
  into t15, so no task is `commits: none`.
