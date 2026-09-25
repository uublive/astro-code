# Plan — phase 23: Capture at the moments of intent

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, named exports, `die()` + `✓`/`•`/`⚠`/`⊡`
glyphs, a test per engine change, real fs/git in tests, repo comment voice, ADR-055 reporting
slots), `.astrocode/DECISIONS.in-force.md` (ADR-004 CLI-owned lock-guarded state, ADR-017 stamps,
ADR-018 red-test imports, ADR-020 wave-green, ADR-029 per-verb flag allowlist, ADR-030 no
external service in lib/bin/workflows, ADR-033 declared provenance, ADR-037 `contextAuthor()`,
ADR-055 voice, ADR-057 home store, ADR-058 machine only proposes), this phase's `CONTEXT.md`
(D1–D6) and aims at every criterion in `CRITERIA.md` (C1–C10).

Planned against phase 22's PLAN.md contract (P6/P7/P10/P11), not its half-landed branch: the
propose path is `ac principles add "<s>" --kind K --why … --propose --from-project … --from-ref …
--excerpt …` (excerpt redacted + capped inside the engine); the review command is
`ac principles list --proposed`. Phase 23 does **not** touch the `case 'principles':` block.

**Test strategy.** Engine modules are test-first, paired in-wave: each RED-test task has the
same `depends_on` as its implementation, and every RED test reaches a not-yet-existing symbol
only through `const { fn } = await import('../lib/x.mjs')` inside an async test body (ADR-018)
— including new exports of existing modules (`rejectPhase` from `lib/roadmap.mjs`). The CLI
test task (t9) drives `bin/ac.mjs` as a subprocess, paired with t8, so a missing verb is a
non-zero exit, not a load crash. The prose-guard task (t14) is **test-after by choice**
(`depends_on` every prose task): it asserts on command/template text that only exists once
those tasks land, and a RED guard over prose would just be red for a wave with no information.

**Guards to respect everywhere.**
- `tests/forge_standalone.test.mjs` fails any `lib/`/`bin/`/`workflows/` file matching
  `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`, and CLI output
  matching `…|knowledge graph|the brain`. New engine comments cite "ADR-058"/"D1", never the
  service by name.
- `tests/forge.test.mjs` forbids `AntiPattern|EvidencedBySignal|ToolSearch(` in any
  `commands/` or `agents/` file: command prose writes the kinds **lowercase** (`antipattern`).
- `tests/commands.test.mjs` SLOTS anchor on literal step text: the insertion points and step
  headings below are pinned so no existing anchor moves except where a task updates the row
  in the same commit.
- Every test that runs `ac` sets `HOME` (and `CLAUDE_CONFIG_DIR` where install runs) to a
  `mkdtempSync` dir and deletes `ASTRO_PRINCIPLES_DIR` from the env (C10).

---

## Decisions this plan pins (CONTEXT "Open for the planner" + what the criteria need)

**P1 — The single capture spec** is `templates/principle-capture.md` (ships with `ac install`,
which copies the whole `templates/` tree; commands point at it as
`` `$(ac path templates)/principle-capture.md` ``). It is the ONLY place the rules are stated
in full; commands point at it and state only their own moment's gate, ref and reporting bound.
Sections, in order:
1. **Human-answered moments only (D6).** Per moment, the gate that runs BEFORE any propose
   call: decision — the why/rejected came from the user in this turn (an agent recording on
   its own judgement proposes nothing); discuss — `ac phase context <p> --author` prints
   exactly `human` (never a substring test on the marker — the ADR-037 trap: `captured`
   also matches the agent form); accept — the rejection was recorded WITHOUT `--agent`;
   milestone sweep — the session is attended by the user, and the material comes only from
   `ac milestone harvest`, which already excludes agent-captured CONTEXT and agent-signed
   rejections.
2. **Lift the generator** — moved verbatim from forge-knowledge.md's WRITE protocol: strip
   every project noun, filename, number and proper name; if what survives is vacuous or
   untrue as a general rule, propose nothing (ADR-027 as the worked non-liftable example).
3. **Volume (D4).** At most **3** proposals per moment; each must lift AND carry a non-empty
   `--why`; fewer is better; nothing qualifies → propose nothing.
4. **Kind** — one of `principle | pattern | preference | antipattern`, one line of guidance each
   (discuss answers are usually `preference`; reject reasons usually `antipattern`).
5. **The invocation** — one fenced `sh` block, exactly this line (placeholders in `<…>`,
   the test in t14 extracts and fills it):
   ```sh
   ac principles add "<lifted statement>" --kind <principle|pattern|preference|antipattern> --why "<why>" --propose --from-project "<project>" --from-ref "<ref>" --excerpt "<the user's own words>"
   ```
   Evidence table: `/astro-decision` → `--from-ref "ADR-<nnn>"` (the id `ac decision add`
   printed), excerpt = the why the user gave; `/astro-discuss` → `--from-ref "phase <N>"`,
   excerpt = the user's answer with its reason; `/astro-accept` rejection →
   `--from-ref "phase <N>"`, excerpt = the reject reason verbatim; milestone sweep →
   `--from-ref "milestone <n>"`, excerpt = the user's words from one recurring source.
   `<project>` = the `Project:` line of `ac status`. `--from-session` is **always omitted**:
   no session id reaches a command (checked: hooks, hosts, stats) — do not probe for one.
   Never call `accept`/`amend`/`reject`/`retire` verbs and never write under
   `~/.astro/principles/` directly — the propose path is the only way in (ADR-058). The
   engine redacts the excerpt; do not pre-mask it.
6. **Ordering** — runs strictly after the command's primary effect succeeded; never gates
   or changes it; a failed propose never fails the command.
7. **Reporting (D5, ADR-055).** Exactly **one line**: `proposed N principle(s) — ac principles
   list --proposed`. Zero proposals → **say nothing** (never "proposed 0"). A failed call →
   one line `⚠ principle capture failed: <first error>`. No inline accept prompt, ever —
   review is batched.
8. **Milestone sweep recurrence rule (D2.4).** Candidates are grouped by theme across the
   harvest's four sources; a theme qualifies only when it recurs in **≥2 phases** (a single
   surprise, rejection or answer proposes nothing — the per-moment captures already had
   their shot at one-offs); rank by phase count, take at most 3.
9. **Known gap** — no dedupe until phase 24; a capture may re-propose; never "fix" that by
   editing or rejecting entries.

**P2 — Rejection provenance + persistence** (C3b, C9). `ac phase reject <p> --reason "…"
[--agent "<name>"]`; ADR-029 allowlist `'phase reject': ['reason','agent']`. New
`lib/roadmap.mjs` export `rejectPhase(root, slug, { reason, agent, now })` — under the
existing lock: status `rejected` AND append to the phase entry
`rejections: [{ reason, kind: 'human'|'agent', by?: <agent name>, at }]` (`by` only for
agent). `rejections` is never cleared (setPhaseStatus's blocker cleanup is untouched), so it
survives a later accept and is carried into the milestone snapshot by `completeMilestone`.
The CLI keeps pushing the blocker (now with `kind`) and prints
`✗ phase N "name" → rejected: <reason>` plus ` (AGENT — machine-signed, not human UAT)` with
`--agent` — mirroring accept.

**P3 — Surprise note (D3).** File `.astrocode/phases/<slug>/SURPRISES.jsonl`, append-only, one
JSON object per line: `{"at":"<iso>","phase":"<slug>","signals":["healed"|"remediation"|"no-progress"|"max-cycles",…],"note":"<text>"}`.
New module `lib/surprises.mjs`: `SURPRISES_FILE = 'SURPRISES.jsonl'`;
`surpriseSignals({ healed, remediationCycles, stoppedReason }) -> string[]` (pure; `healed`
may be a count or an array; order healed, remediation, no-progress, max-cycles; any other
stoppedReason — `no-tasks`, `null`, … — is not a signal); `recordSurprise(root, slug,
{ healed, remediationCycles, stoppedReason, note, now }) -> { written, entry? }` — no signal →
`{ written:false }` and **no file or dir created**; else under `withLock(paths(root).lock)`
append one line (read + `atomicWriteText`); `note` passes `redactSecrets` (lib/redact.mjs),
is collapsed to one line and capped at 300 chars; `slug` containing `/`, `\` or `..` throws
(never writes outside the phase dir); `readSurprises(file) -> { entries, damaged }` (absent →
empty; an unparseable line is counted in `damaged`, never throws).
CLI: `ac phase surprise <p> [--healed <n>] [--remediation-cycles <n>] [--stopped-reason <r>]
[--note "<one line>"]` — the gate is mechanical: `/astro-execute` calls it
**unconditionally** with the workflow's values and the verb decides; it **prints nothing**
on success either way (D3: execute prints nothing extra), exits 0; a non-numeric count dies.
Allowlist `'phase surprise': ['healed','remediation-cycles','stopped-reason','note']`.

**P4 — Discuss provenance verb** (C3a). `ac phase context <p> --author` prints exactly
`human`, `agent <name>` (via `contextAuthor()`), or `none` (CONTEXT.md missing or stub —
reuse `phaseContextStatus`). Without `--author` the verb is unchanged (`missing|stub|ready`).

**P5 — Milestone harvest** (C3c, C9). New module `lib/harvest.mjs`:
`milestoneHarvest(root, n = <roadmap milestone>) -> { milestone, source: 'live'|'archive',
adrWindow: { since: 'YYYY-MM-DD'|null } | null, adrs: [{ id, title, date, why }],
contexts: [{ phase, file }], rejections: [{ phase, reason, at }], surprises: [{ phase, at,
signals, note }], skipped: { agentContexts, agentRejections, damagedSurprises } }`.
- Source: if `.astrocode/milestones/<n>/roadmap.json` exists → `archive` (its phase entries +
  `milestones/<n>/phases/<slug>/`); else if `n` is the live roadmap milestone → `live`
  (phases where `belongsToMilestone(ph, n)`, dirs under `.astrocode/phases/`); else throw
  `milestone <n> is neither current nor archived`. A later-milestone phase is never read.
- contexts: CONTEXT.md with the marker and `contextAuthor()` null (human) → included (absolute
  path); agent form → `skipped.agentContexts++`; missing/stub → ignored.
- rejections: `ph.rejections` entries with `kind === 'human'` (a rejected-then-accepted phase
  still has them); `kind === 'agent'` → `skipped.agentRejections++`.
- surprises: `readSurprises(<phase dir>/SURPRISES_FILE)` — the SAME constant the writer uses.
- ADR window: `since` = the `closed_at` of the highest archived milestone snapshot numbered
  `< n`, else that snapshot's latest phase `accepted_at`; no earlier archive → `since: null`
  (from the beginning — the first milestone IS the history); an earlier archive with neither
  timestamp → `adrWindow: null` and `adrs: []` (honest "not checked", ADR-054 precedent).
  ADRs = in-force entries of `DECISIONS.md` (via `lib/decisions.mjs` parsing/status helpers)
  whose `_YYYY-MM-DD` date ≥ `since` (day granularity; a boundary-day ADR may appear in both
  milestones — a possible re-proposal, the accepted known gap), and ≤ n's own `closed_at`
  when present.
- `lib/milestone.mjs` `completeMilestone` additionally stamps `closed_at: <iso>` on the
  snapshot it writes (the ADR window's future anchor). Nothing else in it changes.
CLI: `ac milestone harvest [<n>] [--json]` — read-only. Human form: header
`milestone <n> sweep material (<live|archived>)`, then `ADRs since <date|the start>` (or
`⊡ ADRs not swept — milestone <m> recorded no close date`), `CONTEXT (human)`,
`rejections (human)`, `surprises`, one item per line, and a final
`• skipped: N agent-captured CONTEXT, M agent-signed rejection(s)` when non-zero; everything
empty → `• nothing to sweep`. `--json` prints the object. Allowlist
`'milestone harvest': ['json']`.

**P6 — Command edits and pinned anchors.**
- `astro-decision.md`: frontmatter `allowed-tools: Bash, Read, AskUserQuestion` (no forge
  tool, no ToolSearch). Step 5 becomes `5. **Propose the principle behind it.**` — after step
  3 succeeded; gate + ref per P1; points at the spec; reporting "exactly one line, or say
  nothing when nothing was proposed".
- `astro-discuss.md`: new step `5b. **Propose what the answers settled.**` between step 5 and
  `6. Clear the live status`; first runs `ac phase context <N> --author` and proceeds only on
  exactly `human`; forge READ text in step 1/2 untouched.
- `astro-accept.md`: the "Who is signing" paragraph extends to rejection — a stand-in agent
  MUST run `ac phase reject <slug> --reason "…" --agent "<your name>"`; the `--reason` is the
  human's own words from step 3, quoted, not paraphrased, never the verifier's evidence. New
  step `4b. **Propose from a human rejection.**` placed after the "Something fails" bullet and
  before `5. On accept`: only on the rejection path, only when rejected without `--agent`;
  excerpt = that `--reason` verbatim; states "a plain acceptance proposes nothing and prints
  nothing extra".
- `astro-execute.md`: frontmatter `allowed-tools: Bash, Read, Write, Workflow`. The
  `**Opportunistic capture` bullet is replaced by `**Record surprises for the milestone
  sweep**`: after the verdict, unconditionally run `ac phase surprise <N> --healed
  <healed.length> --remediation-cycles <remediationCycles> --stopped-reason <stoppedReason>
  --note "<one line: what surprised — the heal's trap, the wrong assumption, the abandoned
  approach>"`; propose nothing, print nothing (say nothing about it). The assembled-summary
  bullet drops "the capture line below".
- `astro-verify.md`: frontmatter `allowed-tools: Bash, Read, Agent`; step 4 (the capture) is
  **deleted** with no replacement — D2 names four moments and D3 names execute only; the file
  then ends at "Verification is the machine gate".
- `astro-complete-milestone.md`: new step `3b. **Sweep the milestone for principles.**` after
  step 3 (i.e. after the archive — the primary effect) and before `4. **Triage stale debt.`:
  run `ac milestone harvest --json` (defaults to the milestone just archived), apply P1 §8,
  propose via P1 §5 with `--from-ref "milestone <n>"`; skip in silence when nothing recurs or
  the close is unattended.
- `templates/forge-knowledge.md`: title/intro say read + degradation only; "The three tools"
  → the two read tools; the ToolSearch probe names only `mcp__forge__forge_knowledge` and
  `mcp__forge__forge_knowledge_list`; the WRITE protocol and Capture contract sections are
  **removed**, replaced by one short paragraph: astro-code no longer writes to forge (D1);
  capture proposes into the personal store — see `principle-capture.md`. READ protocol and
  both degradation paths unchanged (C7: reads keep working).

**Not built:** dedupe (24), review command (24), retrieval / forge-read replacement (25),
transcript mining (26), forge import (27), any change to the `ac principles` verbs.

---

## Tasks

### t1 — RED: surprise-note engine tests
- **file:** `tests/surprises.test.mjs` (new)
- **depends_on:** —
- `const { surpriseSignals, recordSurprise, readSurprises, SURPRISES_FILE } = await import('../lib/surprises.mjs')` inside each async test. Scratch project via `initPlanning` + `addPhase` (on the branch).
- Cover P3: signal mapping (count 2 and `['t3']` → healed; `remediationCycles: 1` →
  remediation; `no-progress`/`max-cycles`; `no-tasks`/`null`/`undefined`/0/`[]` → `[]`);
  clean `recordSurprise` → `{ written:false }` and the phase dir listing is unchanged (no
  file); signal → exactly one line in `<phases>/<slug>/SURPRISES.jsonl` with at/phase/
  signals/note; a second call appends (2 lines, first byte-identical); a note carrying
  `ghp_` + 36 alnum is masked and a 1000-char multi-line note becomes one ≤300-char line;
  slug `../x` throws and writes nothing; `readSurprises` on an absent file → empty, a
  garbage line → `damaged: 1` with the good lines still returned.

### t2 — Surprise-note engine
- **file:** `lib/surprises.mjs` (new)
- **depends_on:** —
- Implement P3's engine half (imports: `paths`, `withLock`/`atomicWriteText`, `redactSecrets`).
  Header comment: why execute records and never proposes (D3 — one surprise is an accident,
  recurrence is the signal, only the milestone sweep can see recurrence), why JSONL
  append-only (a phase can run more than once; overwriting loses the recurrence), why the
  gate lives in the verb and not in prose (ADR-036: "the model should remember to check X"
  eventually does not happen), why the writer and the harvest share `SURPRISES_FILE`.

### t3 — RED: rejection provenance + persistence tests
- **file:** `tests/rejections.test.mjs` (new)
- **depends_on:** —
- `const { rejectPhase } = await import('../lib/roadmap.mjs')` inside each async test (a new
  export of an existing module — ADR-018). Static imports only of `lib/planning.mjs`,
  `lib/roadmap.mjs`'s existing `addPhase`/`setPhaseStatus`/`loadRoadmap` via the same dynamic
  import, and `lib/milestone.mjs`.
- Cover P2: human reject → status `rejected`, `rejections` = one `{ reason, kind:'human', at }`
  with no `by`; `agent: 'bot'` → `kind:'agent', by:'bot'`; two rejections accumulate in order;
  a later `setPhaseStatus(…, 'complete')` keeps `rejections` intact; after
  `completeMilestone` the archived `milestones/<n>/roadmap.json` entry still holds them;
  unknown slug throws.

### t4 — `rejectPhase` in the roadmap engine
- **file:** `lib/roadmap.mjs`
- **depends_on:** —
- Add P2's `rejectPhase` as a new named export using the same lock/write/`writeRoadmapMd`
  path as `setPhaseStatus`; change no existing export's behaviour. Comment: why rejections
  persist on the entry when the blocker is deliberately cleared (the blocker is "is it
  blocked now", the rejection is history the milestone sweep reads — D2.3/D2.4), why kind is
  declared never detected (ADR-033, now symmetric on reject).

### t5 — RED: milestone harvest tests
- **file:** `tests/harvest.test.mjs` (new)
- **depends_on:** t2, t4
- `const { milestoneHarvest } = await import('../lib/harvest.mjs')` inside each async test;
  fixtures built with the real writers now on the branch (`initPlanning`, `addPhase`,
  `rejectPhase`, `recordSurprise`, `completeMilestone`, CONTEXT.md written with each marker,
  `DECISIONS.md` written with dated ADR headings in the real format).
- Cover P5: live source scoped to the current milestone (a later-milestone phase's CONTEXT,
  rejection and surprises are absent); human CONTEXT included, agent CONTEXT excluded and
  counted, stub ignored; human rejection of a phase later accepted comes back with its
  reason; agent rejection excluded and counted; surprises returned with signals; after
  `completeMilestone` the same material comes back with `source:'archive'`, and the snapshot
  carries `closed_at`; ADR window — no earlier archive → all in-force ADRs; earlier archive
  with `closed_at` → only ADRs dated ≥ it; earlier archive with only `accepted_at` → that
  fallback; earlier archive with neither → `adrWindow:null`, `adrs:[]`; a superseded ADR in
  the window is excluded; unknown milestone throws.

### t6 — Milestone harvest engine + close stamp
- **files:** `lib/harvest.mjs` (new), `lib/milestone.mjs`
- **depends_on:** t2, t4
- Implement P5 (`milestoneHarvest`), importing `contextAuthor`/`phaseContextStatus`-style
  marker logic from `lib/planning.mjs` (reuse, don't re-parse), `belongsToMilestone` from
  `lib/milestone.mjs`, `SURPRISES_FILE`/`readSurprises` from `lib/surprises.mjs`, decision
  parsing from `lib/decisions.mjs`. Add the `closed_at` stamp to `completeMilestone`'s
  snapshot. Header comment: why read-only, why the archive is the source after close
  (`state.blockers` is cleared on accept and again at archive — the wrong data source), why
  agent material is filtered here once instead of in prose (D6, C3c), why an unknown ADR
  window reports "not swept" rather than guessing (ADR-043/054: unknown ≠ empty).

### t7 — The single capture spec
- **file:** `templates/principle-capture.md` (new)
- **depends_on:** —
- Write P1 in full, in `forge-knowledge.md`'s register (a header saying commands point here
  and never copy it — a restatement is drift bait). The invocation line must be exactly P1
  §5's, inside a ```` ```sh ```` fence, and the report line exactly P1 §7's (t14 extracts both).

### t8 — CLI: `phase reject --agent`, `phase surprise`, `phase context --author`, `milestone harvest`
- **file:** `bin/ac.mjs`
- **depends_on:** t2, t4, t6
- `phase reject` → `checkFlags` then `rejectPhase` (P2), blocker gains `kind`, AGENT suffix.
  `phase surprise` (P3), `phase context --author` (P4), `milestone harvest` (P5, `root()`
  as the milestone case already does). `ALLOWED_FLAGS`: `'phase reject': ['reason','agent']`,
  `'phase surprise': ['healed','remediation-cycles','stopped-reason','note']`,
  `'milestone harvest': ['json']`. `HELP` lines (each `  ac phase …` / `  ac milestone …`):
  update the reject line to `[--agent name]`, add surprise, `context <p> [--author]`,
  harvest. Do not touch `case 'principles':`. No output string may match
  forge_standalone's CLI leak regex.

### t9 — CLI tests: provenance, surprise, harvest
- **file:** `tests/capture_cli.test.mjs` (new)
- **depends_on:** t2, t4, t6
- Subprocess harness (`spawnSync(process.execPath, [AC, …])`) in a `mkdtempSync` project
  (`git init` + `ac init` + `ac phase add`), `HOME` = its own temp dir, `ASTRO_PRINCIPLES_DIR`
  deleted. Drive: `phase reject <p> --reason "r1" --agent bot` → exit 0, AGENT marker,
  roadmap entry `kind:'agent'`; plain reject → `kind:'human'`; `--agnet` typo → non-zero and
  roadmap bytes unchanged (ADR-029); reject → `phase verify` → `phase accept` → `milestone
  harvest --json` returns "r1"-style human reason; then `milestone complete` →
  `milestone harvest <n> --json` still returns it (`source:'archive'`); agent rejection absent
  from both and counted in `skipped`; `phase surprise <p>` with `--healed 0
  --remediation-cycles 0 --stopped-reason passed` → exit 0, empty stdout, no
  `SURPRISES.jsonl`; `--healed 2 --note "x"` → exit 0, empty stdout, one JSONL line in the
  phase dir; `phase context <p> --author` prints `human` / `agent fleet-1` / `none` for the
  human marker, the agent marker and a stub; `$HOME/.astro/principles` never created.

### t10 — Remove the forge writes (atomic, with every consumer they break)
- **files:** `commands/astro-decision.md`, `commands/astro-execute.md`,
  `commands/astro-verify.md`, `templates/forge-knowledge.md`, `tests/forge.test.mjs`,
  `tests/commands.test.mjs`
- **depends_on:** t7
- One commit, because removing the write tool from any one of these reddens
  `tests/forge.test.mjs` (write-grant set, TOUCHED_FILES, CAPTURE_CALLERS, probe/contract
  assertions) and `tests/commands.test.mjs` (execute/verify slot anchors) at once (ADR-020).
- Apply P6 for decision, execute, verify and forge-knowledge.md.
- `tests/forge.test.mjs`: keep every READ-side assertion; drop decision/execute/verify from
  TOUCHED_FILES and the whole CAPTURE_CALLERS block, drop the node_type/edge/contract-field/
  kebab tests; the probe test expects exactly the two read tools; replace the write-grant test
  with "no commands/ or agents/ file grants or names `mcp__forge__forge_capture_knowledge`"
  and add "templates/forge-knowledge.md no longer contains the write tool or a `## WRITE
  protocol` section". Keep the restatement guard.
- `tests/commands.test.mjs`: execute rows — `'5 assembled summary shape'` end →
  `'**Record surprises for the milestone sweep'`, `'5 opportunistic capture'` →
  `'5 surprise note'` start `'**Record surprises for the milestone sweep'`, same end; verify —
  `'3b debt findings'` end → `'Verification is the machine gate'`, delete the
  `'4 opportunistic capture'` row. The decision step's new slot row is t14's.
- Gate: `node --test tests/` green with `HOME=$(mktemp -d)`.

### t11 — `/astro-discuss` proposes from human answers
- **file:** `commands/astro-discuss.md`
- **depends_on:** t7
- Insert P6's step `5b` (gate via `ac phase context <N> --author` = `human`, ref
  `phase <N>`, excerpt = the user's answer with its reason, pointer to the spec, reporting
  "exactly one line … say nothing when nothing was proposed"). Do not touch steps 1–5's text
  (slot anchors, forge read). Lowercase kinds only.

### t12 — `/astro-accept` proposes from a human rejection
- **file:** `commands/astro-accept.md`
- **depends_on:** t7
- Apply P6 for accept: stand-in agents reject with `--agent`; `--reason` is the human's own
  words; new step `4b` (rejection path only, human only, excerpt = that reason verbatim,
  pointer, one line / say nothing; "a plain acceptance proposes nothing and prints nothing
  extra"). Keep the `**Something fails**`, `**Who is signing`, `**All criteria hold**`,
  `**Backlog items linked`, `5. On accept`, `Keep it real` anchors verbatim.

### t13 — `/astro-complete-milestone` retrospective sweep
- **file:** `commands/astro-complete-milestone.md`
- **depends_on:** t7
- Insert P6's step `3b` after the archive report and before `4. **Triage stale debt.`:
  `ac milestone harvest --json`, the four sources, recurrence ≥2 phases, at most 3, pointer
  to the spec, `--from-ref "milestone <n>"`, one line or skip in silence. State that agent
  material is already excluded by the harvest and that an unattended close proposes nothing.

### t14 — Guards: single spec, human gates, the prescribed invocation actually runs (test-after)
- **files:** `tests/principle_capture.test.mjs` (new), `tests/commands.test.mjs`,
  `tests/install.test.mjs`
- **depends_on:** t8, t10, t11, t12, t13
- `tests/principle_capture.test.mjs`:
  - the spec states the cap 3, the lift phrase ("strip every project noun"), `--why`, the
    report line, a zero → nothing rule, "no inline accept prompt", `--from-session` omitted;
  - each of the four commands contains `$(ac path templates)/principle-capture.md`; none of
    the five capture/surprise commands contains "strip every project noun" (single source);
  - no `commands/`, `agents/`, `templates/` or `workflows/` file contains
    `forge_capture_knowledge`; `astro-execute.md` and `workflows/` never mention
    `ac principles`; execute names `ac phase surprise`, the sweep names `ac milestone harvest`;
  - ordering: in accept the spec pointer sits after `**Something fails**` and not inside the
    `**All criteria hold**` bullet; in discuss after `ac phase context` `--author`; in decision
    after `ac decision add`;
  - **drive C1/C2/C5:** extract the ```` ```sh ```` invocation from the spec, fill it with a
    statement, each kind, `--from-ref "phase 3"`, an excerpt and a project, run it under an
    isolated `HOME` from a scratch project → exit 0; `ac principles list --proposed` (the
    review command parsed out of the spec's report line, run verbatim) exits 0 and lists it;
    `show <id> --json` has status `proposed`, why, ref, excerpt, project; pre-seed accepted,
    rejected-with-reason and accepted-then-amended entries with the same statement, run the
    invocation → all three files byte-identical and no new accepted entry.
- `tests/install.test.mjs`: a test in the forge-knowledge test's shape — `installClaude`
  into a fake home ships `templates/principle-capture.md` non-empty and it is not registered
  as a command/agent.
- `tests/commands.test.mjs`: add `astro-decision.md` and `astro-complete-milestone.md` to
  `LOOP_COMMAND_SRC`; SLOTS rows: decision `'5 principle capture'` (`5. **Propose the
  principle behind it.` → `Use this whenever`), discuss `'5b principle capture'` (`5b.
  **Propose what the answers settled.` → `6. Clear the live status`), accept `'4b principle
  capture'` (`4b. **Propose from a human rejection.` → `5. On accept`), complete-milestone
  `'3b sweep'` (`3b. **Sweep the milestone for principles.` → `4. **Triage stale debt.`).

### t15 — Docs, canon, final gate
- **files:** `MANUAL.md`, `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** t14
- `MANUAL.md`: the forge section says reads only (no staging after `/astro-decision`); in the
  Principles section (phase 22) a "How proposals arrive" paragraph — the four moments, human
  only, at most 3, one line, `ac principles list --proposed`, surprises recorded by execute
  for the sweep; cheat-sheet lines for `ac phase reject … [--agent name]`,
  `ac phase surprise`, `ac phase context <p> --author`, `ac milestone harvest`.
- `ac decision add "Principle-capture specifics this plan pinned: …" --why "…" --rejected "…"`
  (never hand-edit DECISIONS.md; commit exactly what the CLI wrote): single spec at
  `templates/principle-capture.md`; `SURPRISES.jsonl` + the verb-owned gate; rejections
  persisted on the roadmap entry with declared kind; `ac milestone harvest` as the sweep's
  only read, ADR window from the previous close; verify's forge capture deleted without
  replacement. Rejected: a per-command copy of the rules; execute proposing directly;
  reading reject reasons from `state.blockers`; guessing a session id.
- Final gate: record a listing of the real `~/.astro/principles` (or its absence), run
  `HOME=$(mktemp -d) node --test tests/` → 0 failures, confirm the listing is unchanged (C10).

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t2, t3, t4, t7 |
| 2 | t5, t6, t10, t11, t12, t13 |
| 3 | t8, t9 |
| 4 | t14 |
| 5 | t15 |

Rule checks: RED/impl pairs share `depends_on` (t1/t2, t3/t4, t5/t6, t9/t8) and every RED
reference to a missing symbol is a dynamic import; the only destructive edit (forge write
removal) is one task (t10) carrying every consumer it breaks (three commands, the spec, both
test files); `tests/commands.test.mjs` is owned by t10 then t14 (serialized), `bin/ac.mjs` only
by t8, `lib/milestone.mjs` only by t6, `lib/roadmap.mjs` only by t4, each command file by
exactly one task; no two tasks in one wave share a file; every task declares its files and
lands a stamped commit (the final gate is folded into t15).
