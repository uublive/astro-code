# Plan — phase 25: Retrieval into prompts (structural scopes, compact index, hard rules, `ac principles ask`)

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, named exports only, `die()` +
`✓`/`•`/`⚠`/`⊡` glyphs, a `node:test` test per `lib/` change, real fs/git in tests, the
load-bearing comment voice, §Voice reporting budgets), `.astrocode/DECISIONS.in-force.md`
(ADR-001 zero deps, ADR-008 workflow scripts run no shell, ADR-018 red-test imports, ADR-020
wave-green, ADR-021 plan-blind criteria are the sole bar, ADR-029 per-verb flag allowlist,
ADR-030 no external service in lib/bin/workflows, ADR-055 voice, ADR-057 store outside every
repo, ADR-058 only ACCEPTED entries govern agents, ADR-059 exact-id-wins / unique-prefix
resolution), this phase's `CONTEXT.md` (D1–D7) and aims at every criterion in `CRITERIA.md`
(C1–C13).

**Precondition — do not start executing until phase 24's commits are on `develop`.** Phase 23
has landed (HEAD `789361b`); phase 24 is planned but unexecuted. This phase reuses phase 24's
matcher `lib/principlematch.mjs` (`statementTokens`, `STOPWORDS`, `MIN_SHARED`) for the D5
canon-clash candidates and the D7 `ask` tokenizer, per CONTEXT D5 ("reuse it, don't fork a
second one"), and edits `bin/ac.mjs`, `tests/commands.test.mjs` and
`tests/principle_capture.test.mjs` **as phase 24 leaves them**. If `lib/principlematch.mjs` is
still absent when t6/t8 run, the executor STOPS and reports it — never writes a second
tokenizer (the phase-04 duplicate-implementation trap SYNC_WORKTREE already forbids). Entries
with phase 24's `merged` status are simply non-`accepted` and are never served.

**Test strategy — test-first, serialized (chosen explicitly) for every engine/CLI/hook change;
test-in-task for the three prose guards.** Every `lib/` module, the CLI surface and the hooks
get a RED task with empty `depends_on` (all in wave 1), and the implementation task
`depends_on` it. RED unit files reach every not-yet-existing symbol ONLY through
`const { fn } = await import('../lib/x.mjs')` inside async test bodies (ADR-018); the CLI and
hook RED files drive `bin/ac.mjs` / `hooks/*.mjs` as subprocesses, so a missing verb is a
non-zero exit or missing output, never a load crash. The prose guards
(`tests/principles_prompts.test.mjs` in t15, `tests/forge.test.mjs` in t16,
`tests/agentsmd.test.mjs` in t17) are written in the same task as the prose they guard, after
the CLI exists (they `depends_on` t12 and RUN the instructions they extract): they assert on
text that only exists once written, so a separate RED task would be RED against nothing.

**Guards to respect everywhere.**
- `tests/forge_standalone.test.mjs` fails any `lib/`/`bin/`/`workflows/` file matching
  `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`, and CLI output
  matching `…|knowledge graph|the brain`. New comments cite "D3"/"phase 27", never the service.
- `tests/hostile-env.test.mjs`: every `spawnSync(`/`spawn(` sets `windowsHide: true`
  (applies to the new hook spawn in t14 even though `_astro-ctx.mjs` is not in its list).
- `hooks/_astro-ctx.mjs` must NOT import from `../lib` (hooks are copied standalone).
- Workflow scripts: no semicolons, no shell, args stay scalars (ADR-008, CONVENTIONS).
- Every test that runs `ac` or a hook sets `HOME` to a `mkdtempSync` dir and sets
  `ASTRO_PRINCIPLES_DIR` to a temp dir (or deletes it). No test may touch the real
  `~/.astro/principles`.
- `tests/agentsmd.test.mjs` forbids `Milestone \d|Phase \d\d` in the shipped block.
- `ENGINE_SOURCE_LEAK` also matches the word pair "knowledge graph" in comments — write
  "the phase-27 import" instead.

---

## Decisions this plan pins (CONTEXT "Open for the planner")

**P1 — Command surface (all new verbs get an ADR-029 allowlist row; none syncs).**
- `ac principles brief [--stage s] [--work w,…] [--files a,b …] [--rules-only] [--by role] [--json]`
  — the per-task shortlist (D1/D2/D6).
- `ac principles ask "<question>" [--stage s] [--by role] [--json]` — keyword ranking (D7).
- `ac principles cite <id>… [--stage s] [--by role]` — the documented citation path (D4).
- `ac principles list … [--usage]` — the review surface: served-never-cited and never-served
  (D4); plain `list` also prints canon-clash flags (D5).
- Allowlist rows: `'principles brief': ['stage','work','files','rules-only','by','json']`,
  `'principles ask': ['stage','by','json']`, `'principles cite': ['stage','by']`,
  `'principles list'` gains `'usage'`. `rules-only` and `usage` join
  `PRINCIPLES_BOOLEAN_FLAGS`.
- `brief`, `ask`, `cite` **never run `principlesSync`**: they sit on the hot path of every agent
  task and of every session start (a hook must never wait on a `git fetch`). They read the
  local store; the next write/`list`/`show` syncs as before. Open conflicts are still surfaced,
  on **stderr**, so a shortlist on stdout stays clean for hooks and agents.
- Unknown `--stage` / `--work` values die naming the valid set.

**P2 — Stage → work mapping** (`STAGE_WORK`, exported from `lib/principlebrief.mjs`):
`discuss→[plan]`, `research→[plan]`, `plan→[plan]`, `execute→[code,test]`,
`heal→[code,test]`, `remediate→[code,test]`, `verify→[review]`, `session→[]` (any work),
`ask→[]`. `--work` overrides the mapping when given. `--stage verify` FORCES rules-only (D2:
the verifier never sees defaults even if an instruction forgets `--rules-only`).

**P3 — Scope match** (`inScope(entry, { stack, work, files })` → `{ match, hits:{stack,work,files} }`):
- Only `status === 'accepted'` is ever considered (ADR-058) — proposed / rejected / retired /
  superseded / merged are never served, not even as rules.
- `strength === 'rule'`: always served, in full, regardless of scope (D1, C3).
- A default is in scope iff EVERY non-empty scope dimension matches (AND across dimensions,
  OR within one): stack ∩ project tags ≠ ∅; work ∩ requested work ≠ ∅ (an EMPTY request —
  session — matches any work); some requested file matches some entry glob (NO requested
  files ⇒ a file-scoped entry does NOT match: a glob is a narrow claim we cannot confirm). An
  entry with all three dimensions empty is universal.
- Paths: `--files` is repeatable and comma-split, trimmed; absolute paths are made relative
  to the project root; `./` stripped.
- `globMatch(pattern, path)` — hand-rolled (no `path.matchesGlob`: experimental warning on
  Node 22): `**/` = zero or more dirs, `**` = anything, `*` = any run without `/`, `?` = one
  non-`/` char, everything else literal; a pattern with no `/` also matches the basename
  (`*.test.mjs`); a trailing `/` matches the directory prefix.

**P4 — The shortlist text** (`renderBrief`, stdout; ADR-055: dense because agent-read, bounded):
```
• principles — stack: node, express (package.json) · work: code, test (stage execute) · files: lib/x.mjs
HARD RULES — apply always, in full:
- <id>  <kind>/rule
  <full statement>
  why: <full why>
  ⚠ canon may override: ADR-012 (shared: default, export)
IN SCOPE — one line each; full text: ac principles show <id>
- <id>  <kind>/default  <first sentence of statement, ≤ 100 chars…>  [node · code · lib/**]  ⚠ canon may override: ADR-012
• +N more in scope — search: ac principles ask "<question>" · all: ac principles list
• cite what you applied: ac principles cite <id>… --stage <stage> --by <role>
```
- The tags line is ALWAYS printed when anything is served (risk: a wrong detection must be
  visible in every shortlist, not only under a verbose flag — D6). Tags shown capped at
  `STACK_TAGS_SHOWN = 8` with `+N`; matching uses all of them. Source names the manifest(s),
  or `config override`.
- Hard rules are never truncated and never appear again in the index. Index entries never
  carry `why`, and the id is the full id (`principles show` accepts it).
- Index capped at `INDEX_MAX = 25` (named constant next to the renderer, like
  `EXCERPT_MAX_CHARS`), sorted by specificity: file hit, then work hit, then stack hit, then
  universal; ties by id. Statement cut at the first `. ` or `INDEX_STATEMENT_MAX = 100` chars.
- `--rules-only`: the tags line + HARD RULES only; no index, no cite line.
- **Nothing served ⇒ stdout is EMPTY** and one `• no principles in scope — stack: …` line goes
  to stderr (Voice: say nothing when there is nothing; hooks key their silence on empty
  stdout). Exit 0 in every case, including an absent store.
- `--json`: `{ stack:{tags,sources,override}, stage, work, files, rules:[entry+clash], index:[{id,kind,strength,statement,scopes,hits,clash}], more, total }` — the index uncapped count in `total`.

**P5 — Stack detection** (`lib/stack.mjs`, D6): manifest presence at the project root only,
never a package manager, never `node_modules`:
`package.json → node` + lowercased keys of `dependencies` and `devDependencies`
(a malformed file still yields `node`, never throws); `tsconfig.json → typescript`;
`go.mod → go`; `Cargo.toml → rust`; `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile → python`;
`Gemfile → ruby`; `pom.xml`/`build.gradle`/`build.gradle.kts → java`; `composer.json → php`;
`Package.swift → swift`; `mix.exs → elixir`; `deno.json → deno`.
Override: `.astrocode/config.json` key `stack` (array, or comma string), set with
`ac config set stack '["rust"]'`; when present and non-empty it REPLACES detection, lowercased,
and the source reads `config override`. Project root = `findRoot()` ⇒ else
`git rev-parse --show-toplevel` ⇒ else cwd — `brief`/`ask` work in a directory with no
`.astrocode/` (C4's go.mod-only project).

**P6 — Canon-clash candidates** (`lib/principlecanon.mjs`, D5):
- Canon items: every non-empty bullet/paragraph line of `<root>/.astrocode/CONVENTIONS.md`,
  labelled `CONVENTIONS §<nearest ## heading>`; and every LIVE decision in `DECISIONS.md`
  (`parseDecisionEntries` + `decisionStatus`, retired/superseded skipped), labelled by its
  `ADR-nnn`, compared on its TITLE.
- A candidate = `statementTokens(entry.statement)` shares ≥ `MIN_SHARED` tokens with an item's
  tokens (phase 24's matcher, imported, not forked). Output `[{ ref, shared }]`, sorted by
  shared count desc, ADRs before CONVENTIONS, then ref; at most 2 shown per entry.
- Suppressed entirely when the entry carries a promotion into THIS project
  (`promotion.path === root || promotion.project === <state.project || basename(root)>`):
  once promoted here the project owns it; any remaining tension is canon-vs-canon.
- Read-only: nothing is rewritten, retired or hidden (C7). No `.astrocode/` ⇒ no items.

**P7 — `ask` ranking** (`lib/principleask.mjs`, D7): accepted entries only; tokens via
`statementTokens` with an extra question-stopword set (`how what why whom whose is am i me
should could would best way`) so "how should I…" never matches everything. Fields: statement
(weight 2), why (1), scope tags stack/work/files segments (1.5). BM25-style score (k1 1.2,
b 0.75, idf over accepted entries). Terms match on equality, or when both are ≥ 6 chars and
share a ≥ 6-char prefix (`concurrent≈concurrency`, reported as such). Score 0 ⇒ not listed;
zero results ⇒ `• no principles match "<q>"`, exit 0. Output (≤ `ASK_MAX = 10`, `+N more`):
```
1. <id>  <kind>/<strength>  <statement ≤ 100>
   matched: filesystem (statement), concurrent≈concurrency (why) · scope: node ✓
```
The ranking function returns `{ id, score, matched:[{term, entryTerm, field}], scopeHits }`
as its NATIVE shape — the explanation is data, not decoration. No network, no embeddings.

**P8 — Usage log** (`lib/principleusage.mjs`, D4): `<store>/.local/usage.jsonl`, one JSON
object per line `{ at, event:'served'|'cited', id, by, stage, project }` — ids only, never a
statement (C11). `.local/` is already in the store's `.gitignore` (phase 22), so the log is
**per-machine and does not sync** (deliberately deferred: an append-only file is not
merge-safe under git without phase-24-style reconciliation). Appends run under
`withLock(join(dir, '.lock'))` (parallel wave executors); nothing is written when nothing is
served, and an absent store is never created by a read. A failed append never fails the
command: one `⚠` on stderr. `readUsage` skips malformed lines and counts them.
`usageReport(accepted, events)` → `{ ignored:[{id, served, lastServed}], unused:[{id}] }`:
ignored = served ≥ `IGNORED_MIN_SERVES = 2` and never cited; unused = never served.
`project` = `state.project || basename(root)`; `by` defaults to `cli`; `stage` to the flag or
`cli`. `ask` logs its listed results as served with stage `ask` (default).

**P9 — Citations** (D4, open question "schema field vs trailer"): agents run
`ac principles cite <ids> --stage <s> --by <role>` themselves AND put one line
`principles applied: <ids | none>` in their summary. **No workflow result schema changes** —
every `additionalProperties:false` schema stays byte-identical, so the ADR-038-class
"required field missing from one schema" bug cannot happen. `cite` resolves each ref with
`resolvePrinciple` (unique prefix ok), `⚠` per unresolvable ref, records the rest,
`✓ cited N principle(s)`, and dies only when none resolved.

**P10 — Delivery** (D1/D2):
- Workflow agents: ONE sentinel-delimited block per workflow file
  (`// principles-block:start` … `// principles-block:end`, the waves-mirror precedent) that
  defines the instruction text — `principlesFor(stage, role, files)` + `CITE` in
  `execute-phase.mjs`, `PRINCIPLES_RESEARCH`/`PRINCIPLES_PLAN` in `plan-phase.mjs`,
  `VERIFY_RULES` in `execute-phase.mjs`. Appended to: execPrompt (`execute`, task `file`),
  healPrompt (`heal`, task `file`), batchPrompt (`execute`, "each task's own `file`"),
  remediatePrompt (`remediate`, no files), researchers (`research`), planner (`plan`),
  runVerify (`verify --rules-only`). NOT to the criteria-author, integrator, teardown, test
  gate, stamp audit or discover (D2: the criteria author stays principle-blind).
- The verifier block says: hard rules only; a violation goes in `findings[]` with
  `outsideCriteria: true` titled `principle <id>: …`, and is NEVER grounds to set
  `passed=false` or fail any criterion (CRITERIA.md stays the sole bar, ADR-021).
- Role defs mirror it: `agents/astro-executor.md` (brief + cite), `agents/astro-verifier.md`
  (rules-only, non-blocking), `agents/astro-researcher.md`, `agents/astro-planner.md` (t16).
- Main session: the SessionStart hook runs `ac principles brief --stage session --by session`
  and injects its stdout as `hookSpecificOutput.additionalContext` (model context, on every
  source incl. `clear`/`compact` — the banner's skip rule is visual only); the PreCompact hook
  appends the same section to its `systemMessage`. Resolution of the `ac` entry from a
  standalone hook: `<hookDir>/../bin/ac.mjs` if present (running from the clone), else the
  path in `~/.astro/code/source` + `/bin/ac.mjs`, else `ac` on PATH; `spawnSync` with
  `timeout: 5000`, `windowsHide: true`; any failure/non-zero/empty stdout ⇒ no section, no
  error text. Only inside an astro project (existing no-op rule for global hooks).
- Other hosts: a static bullet in `templates/AGENTS.md` telling the agent to run
  `ac principles brief …` — never principle content (ADR-057).

**P11 — Forge reads (D3)**: every `mcp__forge__forge_knowledge` / `…_list` grant and prose
reference leaves `commands/` and `agents/`; each call site gets ONE `ac principles ask`
(and/or `brief`) call with the same "ONE call, one line to the user, don't relitigate" framing.
`ToolSearch` grants stay (harmless; other deferred tools). `templates/forge-knowledge.md`
becomes a short stub: reads were replaced by `ac principles` in this phase; the forge graph
comes back via the phase-27 import. It keeps shipping (install test: non-empty).

---

## Tasks

### t1 — RED: stack detection tests
- **file:** `tests/stack.test.mjs` (new)
- **depends_on:** —
- `const { detectStack, projectStack, STACK_MANIFESTS } = await import('../lib/stack.mjs')` inside
  each async test; real `mkdtempSync` project dirs.
- Cover P5: package.json with `{"dependencies":{"Express":"^4"},"devDependencies":{"vitest":"1"}}`
  ⇒ tags include `node`, `express`, `vitest` (lowercased) and sources name `package.json`;
  malformed package.json ⇒ `node` only, no throw; go.mod only ⇒ `['go']`; Cargo.toml ⇒ `rust`;
  pyproject.toml ⇒ `python`; empty dir ⇒ `[]`; `projectStack(root)` with `.astrocode/config.json`
  `{"stack":["Rust"]}` ⇒ tags exactly `['rust']`, `override: true`, detection ignored; comma-string
  override `"go, node"` ⇒ `['go','node']`; empty-array override ⇒ falls back to detection.

### t2 — Stack detection module
- **file:** `lib/stack.mjs` (new)
- **depends_on:** t1
- Implement P5. Named exports `STACK_MANIFESTS`, `detectStack(root)` →
  `{ tags, sources:[{file,tags}] }`, `projectStack(root)` → `{ tags, sources, override }`
  (reads config via `loadConfig` only when `.astrocode/` exists). Module header says why
  manifests-only (ADR-001, no package manager, no `node_modules`) and why the override
  REPLACES rather than merges (a monorepo root that lies about its stack must be fixable).
- `node --test tests/stack.test.mjs` → green.

### t3 — RED: scope matcher + shortlist selection/render tests
- **file:** `tests/principlebrief.test.mjs` (new)
- **depends_on:** —
- `const { globMatch, inScope, selectBrief, renderBrief, workForStage, STAGE_WORK, INDEX_MAX, INDEX_STATEMENT_MAX } = await import('../lib/principlebrief.mjs')`
  inside each async test. Entries are plain objects shaped like `parsePrinciple` output
  (`{id,kind,strength,status,statement,why,scopes:{stack,files,work},promotions:[],history:[]}`).
- Cover P2–P4:
  - C1 matrix: ctx `{stack:['node','express'], work:['code'], files:['lib/x.mjs']}` over A
    (node+code), B (go), C (files `lib/**`), D (work review), E (unscoped), R (rule, stack go),
    P (proposed, node), a rejected and a retired (node) ⇒ served defaults exactly {A,C,E},
    rules exactly {R}; ctx `{work:['review'], files:[]}` ⇒ defaults {D,E}, rules {R}.
    **This is the C13 mutation catcher**: an "everything matches" matcher fails it.
  - `globMatch`: `lib/**` vs `lib/x.mjs` and `lib/a/b.mjs` true, vs `libx/y.mjs` false;
    `*.test.mjs` matches `tests/a.test.mjs` (basename rule); `lib/*.mjs` vs `lib/a/b.mjs` false;
    `docs/` matches `docs/x.md`.
  - `workForStage('execute')` ⇒ `['code','test']`; `'session'` ⇒ `[]`; unknown throws naming the set.
  - Render (C2/C3): a multi-sentence default with a `why` of `WHYDEFAULT` renders as exactly
    one line containing its full id and `kind/default`, and `WHYDEFAULT` appears nowhere; a rule
    renders its full statement and `why: WHYRULE1`; 150 in-scope defaults + 3 rules (two
    out of scope) ⇒ all 3 rules with their whys present, exactly `INDEX_MAX` index lines, and a
    `+125 more` line naming `ac principles ask`; the tags line names every tag source; a
    `clash` array renders `⚠ canon may override: ADR-012`; `rulesOnly` renders no index and no
    cite line; zero served ⇒ `renderBrief` returns `''`.

### t4 — Scope matcher, selection and renderer
- **file:** `lib/principlebrief.mjs` (new)
- **depends_on:** t3
- Implement P2–P4 as pure functions (no fs, no git): `STAGE_WORK`, `workForStage`,
  `globMatch`, `inScope`, `selectBrief(entries, ctx, { rulesOnly })` →
  `{ rules, index, more, total }`, `renderBrief(brief, ctx)`; constants `INDEX_MAX`,
  `INDEX_STATEMENT_MAX`, `STACK_TAGS_SHOWN`. `clash` arrives pre-computed on each item (the
  caller owns canon reads). Header explains: AND-across-dimensions (C1's "any tag overlaps
  anything" failure), why no-files ⇒ no file-scoped match, why rules bypass scope and cap,
  why only `accepted` (ADR-058), why the cap is a count with a stated trailer.
- `node --test tests/principlebrief.test.mjs` → green.

### t5 — RED: `ask` ranking tests
- **file:** `tests/principleask.test.mjs` (new)
- **depends_on:** —
- `const { rankPrinciples, renderAsk, ASK_MAX, QUESTION_STOPWORDS } = await import('../lib/principleask.mjs')`
  inside each async test.
- Cover P7 with C5's fixture: X "Always wrap filesystem mutations in a lock" (why mentions
  concurrency), Y "Prefer named exports over default exports", Z "Use metric units in reports",
  plus a PROPOSED entry sharing every question term. Question "how should I guard concurrent
  filesystem writes" ⇒ first result X, every result's `matched` non-empty and naming real terms
  (includes `filesystem` from the statement and `concurrent≈concurrency` from why), Z absent,
  the proposed entry absent; "quantum chromodynamics" ⇒ `[]`; "how should I" ⇒ `[]`;
  scope hits reported when an entry's stack is in ctx tags; `renderAsk` of `[]` says
  `no principles match`; results beyond `ASK_MAX` produce a `+N more` line; two runs are
  deep-equal (deterministic).

### t6 — `ask` ranking module
- **file:** `lib/principleask.mjs` (new)
- **depends_on:** t5
- Implement P7. Imports `statementTokens`, `STOPWORDS` from `./principlematch.mjs` (phase 24 —
  STOP and report if absent; never re-implement). Pure. Header: why BM25-style and not raw
  overlap (long entries over-weighted, rare terms under-weighted), why the prefix rule and its
  6-char floor, why the explanation is the native return shape.
- `node --test tests/principleask.test.mjs` → green.

### t7 — RED: canon-clash candidate tests
- **file:** `tests/principlecanon.test.mjs` (new)
- **depends_on:** —
- `const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs')` inside each
  async test; a `mkdtempSync` root with a hand-written `.astrocode/CONVENTIONS.md`
  (`## Naming` + bullet "Named function exports only, no default exports") and a
  `.astrocode/DECISIONS.md` holding one live ADR titled the same idea and one RETIRED ADR on
  the same words (write entries in `lib/decisions.mjs`'s exact format).
- Cover P6: "Use default exports for modules" ⇒ candidates name the live ADR id and
  `CONVENTIONS §Naming`, each with `shared` ⊇ `['default','export']`, never the retired ADR;
  "Use metric units in reports" ⇒ `[]`; an entry whose `promotions` hold
  `{project: <basename(root)>, path: root, as:'decision', ref:'ADR-00x'}` ⇒ `[]`; a promotion
  into a DIFFERENT project still flags; a root with no `.astrocode/` ⇒ `canonItems` is `[]`;
  the canon files are byte-identical afterwards.

### t8 — Canon-clash module
- **file:** `lib/principlecanon.mjs` (new)
- **depends_on:** t7
- Implement P6: `canonItems(root)` → `[{ ref, tokens }]`, `clashCandidates(entry, items, { root, project })`
  → `[{ ref, shared }]` (max 2). Imports `statementTokens`, `MIN_SHARED` from
  `./principlematch.mjs` (phase 24; STOP if absent) and `parseDecisionEntries`,
  `decisionStatus` from `./decisions.mjs`. Header: candidates only, canon wins, nothing
  resolved automatically (D5), why promotion-into-this-project suppresses, why ADR titles only
  (bodies make everything overlap).
- `node --test tests/principlecanon.test.mjs` → green.

### t9 — RED: usage log tests
- **file:** `tests/principleusage.test.mjs` (new)
- **depends_on:** —
- `const { usageFile, recordUsage, readUsage, usageReport, IGNORED_MIN_SERVES } = await import('../lib/principleusage.mjs')`
  inside each async test; `dir` = `mkdtempSync`.
- Cover P8: `usageFile(dir)` ends in `.local/usage.jsonl`; 20 concurrent `recordUsage` calls
  (`Promise.all`) ⇒ 20 well-formed lines; each line has `at`/`event`/`id`/`by`/`stage`/`project`
  and NO statement text; a garbage line is skipped and counted; U1 served ×2 + cited,
  U2 served ×2, U3 never ⇒ `ignored` = [U2] with `served: 2`, `unused` = [U3], U1 in neither;
  only accepted entries are reported; `recordUsage` on an absent dir with `[]` events creates
  nothing.

### t10 — Usage log module
- **file:** `lib/principleusage.mjs` (new)
- **depends_on:** t9
- Implement P8 (`withLock`, `appendFileSync` of whole lines, `mkdirSync` of `.local`). Header:
  why `.local/` (per-machine, never synced — deferred on purpose, not merge-safe), why ids only
  (ADR-057/C11), why served AND cited (served-often-never-cited is the "ignored" signal).
- `node --test tests/principleusage.test.mjs` → green.

### t11 — RED: CLI tests for brief / ask / cite / list --usage / clash / override
- **file:** `tests/principles_retrieval_cli.test.mjs` (new)
- **depends_on:** —
- Subprocess only (`spawnSync(process.execPath, [AC, …])`), the `tests/principles_cli.test.mjs`
  harness shape: temp `HOME`, `ASTRO_PRINCIPLES_DIR` = temp store, a scratch project
  (`git init`, `ac init`, `package.json` with express), entries seeded with `ac principles add`
  (plus `--propose`, `reject`, `retire`), sentinel words `ZEBRA1…`.
- Cover C1–C7 and C11 end to end:
  - C1: `brief --work code --files lib/x.mjs` and `brief --work review` exactly as in t3.
  - C2/C3: the WHYDEFAULT/150-defaults/3-rules case; the index id is accepted by `principles show`.
  - C4: the tags line contains `node`; a go.mod-only dir WITHOUT `ac init` serves the `--stack go`
    entry, hides the node-only one, reports `go`; `ac config set stack '["rust"]'` flips it
    (`rust` reported, node-only hidden, rust-only served).
  - C5: the ask cases from t5, via the CLI, with `HTTPS_PROXY=http://127.0.0.1:9` set (no network).
  - C6: brief twice, `cite <U1 prefix> --stage execute --by executor`, `list --usage` names U2
    under served-never-cited and U3 under never-served, U1 in neither; the log lines carry
    stage/project/at and no `ZEBRA` text.
  - C7: CONVENTIONS bullet + `ac decision add "Named function exports only, no default exports"`;
    brief and `list` flag the default-exports principle with that ADR id; unrelated one unflagged;
    `show` output identical before/after; `principles promote <id> --as convention` then re-run
    ⇒ no flag.
  - C11: `grep -rI ZEBRA` over the project (excluding `.git`) finds nothing after `init`,
    `agents-md`, brief, ask, cite.
  - ADR-029: `brief --bogus` and `ask q --stage nope` exit non-zero naming the flag/value;
    `ac help` lists `principles brief`, `ask`, `cite`, `--usage`.
  - Empty/absent store: `brief` exits 0 with empty stdout.

### t12 — Retrieval orchestration + CLI verbs
- **files:** `lib/retrieval.mjs` (new), `bin/ac.mjs`
- **depends_on:** t2, t4, t6, t8, t10, t11
- `lib/retrieval.mjs` (keeps `bin/` a thin dispatcher): `projectContext(cwd)` (P5 root rule +
  project name), `shortlist({ dir, cwd, stage, work, files, rulesOnly, by, now })` (load →
  `projectStack` → `selectBrief` → `clashCandidates` → `recordUsage` served for rules + shown
  index items → `{ brief, text, json }`), `askStore({ dir, cwd, question, stage, by })`,
  `cite({ dir, cwd, refs, stage, by })`, `usageReview({ dir })`, `clashesFor(entries, cwd)`.
- `bin/ac.mjs`, inside `case 'principles':` as phase 24 left it: the P1 allowlist rows and
  boolean flags; the `brief`, `ask`, `cite` verbs (no sync; conflicts to stderr); `list --usage`
  (sections printed only when non-empty, one line per entry `<id>  served N× · last <date>  <statement ≤100>`;
  both empty ⇒ one `•` line; `--json` ⇒ `{ ignored, unused, log }`); the `↳ canon may override: …`
  line under each accepted `list` entry and a `canonClash` field in `list --json`; HELP lines
  (continuations indented ≥ 10 spaces so `verbHelp` picks them up), including the
  `ac config set stack '["rust"]'` override; the unknown-verb list.
- `node --test tests/principles_retrieval_cli.test.mjs tests/principles_cli.test.mjs tests/principles_sync_cli.test.mjs tests/principles_promote.test.mjs tests/forge_standalone.test.mjs tests/hostile-env.test.mjs`
  plus phase 24's `tests/principles_review_cli.test.mjs` → green.

### t13 — RED: hook delivery tests
- **file:** `tests/hooks_principles.test.mjs` (new)
- **depends_on:** —
- Spawn `hooks/astro-update.mjs` and `hooks/astro-precompact.mjs` from the repo with stdin
  `{"cwd": proj, "source": "startup"}` (and `"compact"`), temp `HOME`, `ASTRO_PRINCIPLES_DIR` =
  a seeded store (C3 shape: 150 defaults, 3 rules with `WHYRULE1..3`, one default with
  `WHYDEFAULT`). Parse stdout JSON.
- Assert (C10): SessionStart's `hookSpecificOutput.additionalContext` holds all three rule
  statements and whys and one-line index entries, never `WHYDEFAULT`; it is present for
  `source: compact` too; PreCompact's `systemMessage` holds the same rules and its existing
  resume note. With `ASTRO_PRINCIPLES_DIR` pointing at a nonexistent dir and at an empty dir:
  exit 0, empty stderr, no principles section, and the SessionStart banner (startup source) and
  PreCompact resume note still present. Outside any astro project: no output at all.

### t14 — Hooks: hard rules + compact index into the main session
- **files:** `hooks/_astro-ctx.mjs`, `hooks/astro-update.mjs`, `hooks/astro-precompact.mjs`
- **depends_on:** t12, t13
- `_astro-ctx.mjs` gains `acEntry({ hookDir, home })`, `readPrinciplesBrief(root, { run })`
  (P10 resolution + `spawnSync` with `windowsHide: true`, `timeout: 5000`; returns `''` on any
  failure, never throws — the `readJson` try/catch-to-null idiom) and
  `renderPrinciplesSection(text)` (a one-line header "Your personal principles (canon wins on
  conflict)" + the text; `''` for empty input). Still no `../lib` import; the header comment
  explains why the hook shells to `ac` instead of re-parsing entries (one parser,
  `lib/principlemd.mjs`; the `CONTEXT_MARKER_RE` mirror is the drift this avoids).
- `astro-update.mjs`: when inside a project, compute the section on EVERY source and emit
  `hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext }` alongside the
  existing `systemMessage` (which is unchanged). `astro-precompact.mjs`: append the section to
  the resume note (or emit it alone when the note is empty).
- `node --test tests/hooks_principles.test.mjs tests/hooks-update.test.mjs tests/hostile-env.test.mjs tests/statusline.test.mjs tests/install.test.mjs` → green.

### t15 — Workflow + executor/verifier prompts carry the shortlist; guard that runs them
- **files:** `workflows/execute-phase.mjs`, `workflows/plan-phase.mjs`, `agents/astro-executor.md`,
  `agents/astro-verifier.md`, `tests/principle_capture.test.mjs`, `tests/principles_prompts.test.mjs` (new)
- **depends_on:** t12
- Implement P9/P10 for workflows: the sentinel blocks, appended exactly to the roles listed in
  P10 (the plan-phase criteria prompt keeps plain `OBEY`; the researchers and planner get
  `OBEY + PRINCIPLES_*`). Executor-family text: run the brief with your stage and task files
  alongside the canon, apply rules, treat index lines as pointers (`show` for full text),
  follow canon on a `canon may override` note and say so, then cite + the
  `principles applied:` summary line. Verifier text per P10. No result schema is touched.
- `agents/astro-executor.md` / `agents/astro-verifier.md`: the same instruction for the
  Agent-tool and fast-lane tiers (verifier: `--stage verify --rules-only`, findings only).
- `tests/principle_capture.test.mjs`: the "workflows/ never mention `ac principles`" assertion
  becomes "workflows/ never PROPOSE (`ac principles add` / `--propose`)" — execute still only
  records surprises (phase 23 D3); the `astro-execute.md` assertion is unchanged (that file is
  not edited). Same task as the prose change (ADR-020).
- `tests/principles_prompts.test.mjs` (written after the prose, in this task): renders each
  sentinel block in `node:vm` with fixture `root`/`phaseSlug`/`phaseNum`, extracts every
  backticked `ac principles (brief|ask|cite) …` command, substitutes placeholders, and RUNS it
  against a C1-seeded scratch store/project: all exit 0 (ADR-029 allowlist accepts them); the
  execute-stage brief serves the code-scoped default, the plan-stage brief serves the
  plan-scoped one and not the code one; the verify brief returns the rules and none of the
  defaults (C9). Static checks: execPrompt/healPrompt/batchPrompt/remediatePrompt, the
  researcher and planner prompts and both agent defs contain the brief + cite; the criteria
  prompt and `agents/astro-criteria-author.md` contain no `ac principles`; `VERIFY_SCHEMA` has
  no principle-named property and the verify text contains "never" + "passed=false"/"fail"
  wording for principle violations; no workflow schema gained a field (compare property-name
  sets against a pinned list).
- `node --test tests/principles_prompts.test.mjs tests/principle_capture.test.mjs tests/workflows.test.mjs tests/decision_revisions.test.mjs tests/verify.test.mjs tests/forge_standalone.test.mjs` → green.

### t16 — Replace every forge read with `ac principles` (D3)
- **files:** `commands/astro-discuss.md`, `commands/astro-plan.md`, `commands/astro-new-project.md`,
  `agents/astro-researcher.md`, `agents/astro-planner.md`, `templates/forge-knowledge.md`,
  `tests/forge.test.mjs`, `tests/commands.test.mjs`
- **depends_on:** t12
- Apply P11. Drop `mcp__forge__forge_knowledge` / `mcp__forge__forge_knowledge_list` from every
  `allowed-tools`/`tools` line and all prose. Replacements:
  - discuss step 1: ONE `ac principles ask "<a few keywords from the phase goal>"` +
    `ac principles brief --stage discuss --by discuss`; step 2's "already settled" relay becomes
    "if an accepted principle already settles a fork, say so in one line ('your principle <id>
    already settles X — not re-asking')", a principle never silently drops a question.
  - plan step 2: ONE `ac principles ask "<phase-goal keywords>"`, relayed in one line; still
    never passed as a Workflow arg (the workflow's agents run their own brief — t15).
  - new-project step 3: ONE `ac principles ask "<vision-draft keywords>"` (stack/preference
    principles inform the interview), same one-line relay and placement rationale.
  - researcher / planner defs: `ac principles brief --stage research|plan --by researcher|planner`,
    optionally one `ask`, cite what was applied.
- `templates/forge-knowledge.md` → the P11 stub (no tool ids, no probe).
- `tests/forge.test.mjs` rewritten as the D3 guard: no `commands/`/`agents/` file grants or
  names any `mcp__forge__` tool or points at `forge-knowledge.md`; each of the five sites names
  an `ac principles ask|brief` call and every such backticked command, placeholders
  substituted, exits 0 against a scratch store; the stub names phase 27 and is non-empty;
  keep the write-tool and `AntiPattern|EvidencedBySignal|ToolSearch(` restatement guards.
- `tests/commands.test.mjs`: re-anchor the `astro-discuss.md` "2 brain-settled fork" slot and
  the two `astro-plan.md` slots bordering the old "opportunistically, run ONE scoped" text to
  the new wording; each new slot states its one-line bound.
- `node --test tests/forge.test.mjs tests/commands.test.mjs tests/install.test.mjs tests/principle_capture.test.mjs tests/hosts.test.mjs` → green.

### t17 — AGENTS.md block tells other hosts to run `ac principles`
- **files:** `templates/AGENTS.md`, `tests/agentsmd.test.mjs`
- **depends_on:** t12
- One bullet under "### Rules that matter": before a task, run
  `ac principles brief --stage execute --files <paths you will touch>` (hard rules in full, an
  index of the rest; `ac principles show <id>` for full text; canon wins on a clash) and
  `ac principles cite <ids>` for what you applied — the store is personal and outside the repo,
  so nothing of it is ever written here. No `Phase NN` / `Milestone N` text.
- `tests/agentsmd.test.mjs` (test-in-task): the shipped block names `ac principles brief`; with a
  seeded sentinel store, `writeAgentsMd` into a temp repo writes no sentinel into AGENTS.md or
  CLAUDE.md; the backticked brief command, placeholders substituted, exits 0.
- `node --test tests/agentsmd.test.mjs tests/install.test.mjs` → green.

### t18 — Docs, canon, final gate
- **files:** `MANUAL.md`, `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** t14, t15, t16, t17
- `MANUAL.md` (edit on top of whatever the working tree holds — it may carry uncommitted
  phase-23/24 doc edits; never revert them): Principles section gains "Retrieval" — the
  shortlist (scopes, AND rule, hard rules in full, the cap, stage→work), `ask`, `cite`,
  `list --usage`, canon-clash flags, stack detection + `ac config set stack`, where the usage
  log lives and that it does not sync, hook/AGENTS.md delivery. Cheat-sheet lines for
  `brief`/`ask`/`cite`/`list --usage`. The "Forge knowledge graph (optional)" section shrinks to
  a two-line note: reads replaced by `ac principles` in this release, the graph returns via the
  forge import. Keep the TOC link consistent.
- `node bin/ac.mjs decision add "Principle retrieval specifics this plan pinned: …" --why "…" --rejected "…"`
  covering P1–P11 (no-sync reads, AND scope rule + no-files rule, rules bypass scope/cap,
  INDEX_MAX 25, stage→work table, verify forces rules-only and violations are non-blocking
  findings, manifest-only stack detection with a replacing override, canon clash via phase
  24's tokens with promotion suppression, BM25-style ask with prefix matching, per-machine
  unsynced ids-only usage log, citations via `ac principles cite` with no schema change, hook
  shells to `ac`, forge reads replaced). Rejected: embeddings; a second tokenizer; a
  citations field in workflow schemas; syncing the usage log now; re-parsing entries inside
  hooks; inlining principles into AGENTS.md; `path.matchesGlob`. Record the output as-is;
  never hand-edit DECISIONS.
- **Final gate** (C13): record a listing of the real `~/.astro/principles` (or its absence);
  run `HOME=$(mktemp -d) node --test tests/` → 0 failures, 0 cancelled; confirm
  `package.json` has 0 dependencies; confirm the listing is unchanged.

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t3, t5, t7, t9, t11, t13 |
| 2 | t2, t4, t6, t8, t10 |
| 3 | t12 |
| 4 | t14, t15, t16, t17 |
| 5 | t18 |

Rule checks:
- **Test-first, serialized.** Every RED task (t1, t3, t5, t7, t9, t11, t13) has empty
  `depends_on`; each impl depends on its RED (t2←t1, t4←t3, t6←t5, t8←t7, t10←t9, t12←t11,
  t14←t13). Every reference to a new module is a dynamic `await import`; the CLI and hook RED
  files are subprocess-only. The three prose guards are test-in-task by choice (see header).
- **Wave-green / no split destructive edit.** Nothing is deleted or renamed. The two contract
  changes carry their broken consumers in the same task: t15 (workflows start mentioning
  `ac principles` + the `principle_capture` assertion that forbade it), t16 (forge grants and
  prose removed + `forge.test.mjs` + the `commands.test.mjs` slot anchors that quoted it +
  the template stub). No result schema changes anywhere (P9).
- **One owner per wave per file.** `bin/ac.mjs` + `lib/retrieval.mjs`: t12 only. Hooks: t14
  only. Workflows, `agents/astro-executor.md`, `agents/astro-verifier.md`,
  `tests/principle_capture.test.mjs`: t15 only. The three commands, `agents/astro-researcher.md`,
  `agents/astro-planner.md`, `templates/forge-knowledge.md`, `tests/forge.test.mjs`,
  `tests/commands.test.mjs`: t16 only. `templates/AGENTS.md`, `tests/agentsmd.test.mjs`: t17
  only. `MANUAL.md`, `.astrocode/DECISIONS*.md`: t18 only. Every other file is new and owned by
  one task. No two tasks in one wave share a file.
- **Every task declares its files and lands a stamped commit.** The final gate is folded into
  t18, so no task is `commits: none`.
