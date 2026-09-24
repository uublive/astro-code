# Plan — phase 22: Principle store and CLI

Obeys `.astrocode/CONVENTIONS.md` (Node ≥22 ESM, zero deps, `node:` builtins only, named
function exports, `die()` + `✓`/`•`/`⚠` glyphs, a test per engine change, real fs + real
git in tests), `.astrocode/DECISIONS.in-force.md` (ADR-004 CLI-owned lock-guarded writes;
ADR-013 dated-slug ids; ADR-018 red-test imports; ADR-020 wave-green; ADR-029 per-verb
flag allowlist; ADR-030 no forge in the engine; ADR-043 unreachable ≠ empty; ADR-053
refuse-first canon; ADR-055 voice; **ADR-057** home-dir store; **ADR-058** human data is
authoritative), this phase's `CONTEXT.md` (D1–D8), and aims at every criterion in
`CRITERIA.md` (C1–C16).

**Test strategy — test-first, paired in-wave.** Every behavioural engine module gets a
RED-test task with the **same `depends_on`** as its implementation task, so both land in
the same wave and the boundary integrates red + green together. Every RED test that
touches a symbol not yet on the branch uses `const { fn } = await import('../lib/x.mjs')`
**inside an async test body** (ADR-018) — never a static top-level import. The two small
helpers (t5, t6) are single test-with tasks (test written first inside the task, still via
dynamic import). CLI tests (t12, t14, t15) drive `bin/ac.mjs` as a subprocess; they may
statically import only modules already on the branch when their wave starts
(`lib/git.mjs`, `lib/planning.mjs`, `lib/principlemd.mjs`, `lib/registry.mjs`, …) — a
missing verb is then a non-zero exit, not a module-load crash.

**Guard to respect everywhere:** `tests/forge_standalone.test.mjs` fails any file in
`lib/`, `bin/`, `workflows/` matching `/mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i`.
ADR-058's own text mentions a "knowledge graph" — do **not** paraphrase it into a code
comment. Cite "ADR-058" instead.

---

## Decisions this plan pins (CONTEXT.md "Open for the planner" + what the surface needs)

**P1 — Modules.** Four new engine modules, one responsibility each:
`lib/redact.mjs` (pure secret masking), `lib/principlemd.mjs` (pure entry-file codec +
enums + index line), `lib/principles.mjs` (the store: dir resolution, strict reads,
lock-guarded lifecycle mutations — **no git**), `lib/principlesync.mjs` (git: repo setup,
offline-first sync, conflict handling). Plus `lib/editor.mjs` ($EDITOR round-trip) and one
new export in `lib/canon.mjs` (`appendConvention`). No glob matcher: `scopes.files` is
stored and validated only; matching is retrieval (phase 25).

**P2 — Store dir.** `principlesDir(env = process.env)` →
`env.ASTRO_PRINCIPLES_DIR || join(env.HOME || homedir(), '.astro', 'principles')`
(mirrors `lib/stats.mjs`'s `configDir()` env-override shape). Every other engine function
takes an explicit `dir` argument — nothing below `principlesDir` reads `process.env`.
**Readers never create the dir** (an absent dir is an empty store); only writers
`mkdirSync(dir, { recursive: true })`, and only **after** validation passes (C2's
byte-identical rule, C16's "no `.astro/principles` created by tests").

**P3 — Entry file format** (`<dir>/<id>.md`, one per entry, D6). Exactly:

```
<!-- astro-principle -->
id: 2026-09-24-never-mock-the-database-in
kind: antipattern
strength: rule
status: accepted
created: 2026-09-24T08:30:00.000Z
stack: postgres, go
work: test, review
files: migrations/**
files: **/*.test.*
reason: <text>                       (present iff status rejected|retired)
superseded-by: <id>                  (present iff status superseded)
source: {"session":"…","project":"…","at":"…","ref":"ADR-057","excerpt":"…"}
promotion: {"project":"…","path":"/abs/root","as":"decision","ref":"ADR-059","at":"…"}
history: {"at":"…","action":"amended","reason":"…","statement":"<prior>","why":"<prior>"}
---

# <statement — one line>

<why — prose, may be empty>
```

Rules: line 1 is exactly the marker; header lines are `key: value` up to the `---` line;
fixed key order on render (as shown); keys `id kind strength status created` required
exactly once; `id` must equal the filename stem; `stack`/`work` are comma lists (omitted
when empty), `stack` lowercased+trimmed on write, `work` ⊂ enum; `files`, `promotion`,
`history` are **repeatable** (one glob / one JSON object per line — globs may contain
commas, so no comma list); `source` at most once, a JSON object; `promotion`/`history`/
`source` values must `JSON.parse` to objects. The body after `---` must contain a
`# <statement>` line (non-empty) and everything after it (trimmed) is the why.
**Damaged** = anything else: missing/extra/duplicate/unknown key, out-of-enum value,
unparseable JSON, id ≠ filename, missing statement, rejected/retired without `reason`,
superseded without `superseded-by`, **or any line starting with `<<<<<<<`, `=======` or
`>>>>>>>`** (C12: an entry with conflict markers must never read as valid). No YAML.

Enums (exported from `lib/principlemd.mjs`):
`KINDS = ['principle','pattern','preference','antipattern']`,
`STRENGTHS = ['rule','default']`,
`WORK_SCOPES = ['plan','code','test','review','git','ui','data','docs','ops']`,
`PRINCIPLE_STATUSES = ['proposed','accepted','rejected','retired','superseded']`.
Default strength on add is `default`; `--kind` is required.

**P4 — Lifecycle** (D3/D5, C4). Allowed moves, nothing else:
`proposed → accepted` (accept) · `proposed → rejected` (reject, reason required) ·
`accepted → retired` (retire, reason required) · `accepted → superseded` (supersede
`--by` an **existing, different, accepted** entry) · `accepted → accepted` (amend, reason
required, must change at least one field; promote). Every mutation appends exactly one
`history:` line (`action` ∈ `accepted|edited|rejected|retired|superseded|amended|promoted|refreshed`);
`amended`/`edited` lines carry the **prior** `statement` and `why`. Nothing is ever
deleted. An illegal move throws naming the current status and the legal moves, and
writes nothing.

**P5 — Ids** (D4, C6). `principleId(statement, now) = datedId(statement, now, 40, 'principle')`
(imported from `lib/fixes.mjs`); on an existing file with that id (damaged or not —
`existsSync`, never parse) append `-2`, `-3`, … exactly as `addBacklog` does. Resolution:
an exact id wins; otherwise the unique id starting with the ref; several → error naming
the candidates; none → error. Damaged files' ids are included in the candidate set, so
`show <damaged-id>` reports the damage, never "not found".

**P6 — ADR-058 refresh rule** (C15). `proposePrinciple(dir, { id, … })` rewrites an
entry **only if** its status is `proposed` and its history holds no `edited`/`amended`
action; otherwise it returns `{ ok: false, reason }` and writes nothing. Without `id` it
always creates a new proposed entry (dedupe is phase 24). `add --propose` goes through
it. No propose path can yield `accepted`.

**P7 — Source + redaction** (D3, C9). CLI flags on `add`: `--from-session <id>`,
`--from-project <name>`, `--from-ref <ADR/phase>`, `--excerpt "<text>"`; `at` defaults to
now when any is given. The excerpt passes through `redactSecrets` **before** anything is
written and is then capped at 500 chars (redact first, truncate second, so truncation
can never cut a secret into an unmatched fragment). Masks with `[REDACTED]`:
GitHub tokens `gh[pousr]_[A-Za-z0-9]{36,}` and `github_pat_[A-Za-z0-9_]{20,}`; AWS
`(AKIA|ASIA)[0-9A-Z]{16}`; `Bearer <token>` → `Bearer [REDACTED]`; `Authorization:`
header values; credentialed URLs `scheme://user:pass@` → `scheme://[REDACTED]@`;
`(token|secret|password|passwd|api[_-]?key)\s*[:=]\s*\S+` → keeps the key, masks the value;
`sk-[A-Za-z0-9_-]{20,}`; Slack `xox[abprs]-[A-Za-z0-9-]{10,}`; PEM
`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`. Pure,
fixed list, not configurable. Surrounding words survive.

**P8 — `--edit` mechanics** (D5, C5). Both forms: flags (`accept <id> --statement "…"
[--why "…"]`, `amend <id> --reason "…" [--statement …] [--why …] [--kind …] [--strength …]
[--stack …] [--files …] [--work …]`) **and** an `$EDITOR` round-trip (`accept <id> --edit`,
`amend <id> --reason "…" --edit`). `lib/editor.mjs` `editText(initial, { env })` writes
`<statement>\n\n<why>\n` plus `#`-comment instructions to a temp file in
`mkdtempSync(join(tmpdir(), 'ac-edit-'))`, runs `env.VISUAL || env.EDITOR || 'vi'` via
`spawnSync('/bin/sh', ['-c', `${editor} "$1"`, 'ac-edit', tmp], { stdio: 'inherit' })`
(Windows: `spawnSync(`${editor} "${tmp}"`, { shell: true, stdio: 'inherit' })`) so an
`EDITOR` with arguments (`sed -i 's/…/…/'`) works exactly like git's; strips `#` lines;
first non-empty line = statement, the rest trimmed = why; removes the temp dir. Non-zero
editor exit → throws "editor exited N — nothing changed". **Unchanged text → the command
refuses** (git's commit-template rule): `accept --edit` never accepts unedited text.

**P9 — Sync** (D1/D2, C10–C12; ADR-043). The store is a git repo **only after
`ac principles remote <url>`**, and "is a repo" means **`existsSync(join(dir, '.git'))`**
— never `isRepo(dir)`, which is true inside a parent repo (a dotfiles-managed `$HOME`)
and would commit principles into it. Without its own `.git` no git command ever runs
(C1: no git, no network). Branch `main`, remote `origin`. `.gitignore` = `.lock/` and
`*.tmp-*`. Store commits use `git -c commit.gpgsign=false commit --no-verify`, adding
`-c user.name=astro-code -c user.email=astro-code@localhost` only when
`git config user.email` is empty in the store.
`syncPrinciples(dir)` under `withLock(join(dir, '.lock'))`:
1. not a repo / no `origin` → `{ state: 'local' }`, touches nothing;
2. `git add -A` + commit if anything is staged (so writes made by any lib helper, even
   via `node -e`, are carried);
3. `git fetch origin` — **failure = `{ state: 'unreachable' }`, stop**: no merge, no
   push, no deletion (unreachable is never empty);
4. `origin/main` absent after a successful fetch (fresh bare remote) → push `-u origin main`;
5. otherwise `git merge --no-edit [--allow-unrelated-histories] origin/main`. Different
   entries merge cleanly by construction. On a conflicted `*.md` entry: read `:2:` (ours)
   and `:3:` (theirs) via `git show`, parse both, `compareRevisions` (history lines as
   the marker list — ADR decisions' strict-prefix rule): strict prefix → take the newer;
   byte-equal → take it; otherwise **genuine conflict** → keep ours in `<id>.md`, write
   theirs to `conflicts/<id>.<theirs-sha7>.md`, `git add` both, commit the merge. Any
   other unmerged path or type → `git merge --abort`, report `{ state: 'diverged' }`,
   nothing overwritten;
6. push (never `--force`); a rejected push retries steps 3–6 up to 3 times, then
   reports "not pushed, will retry" — local commits stay.
Returns `{ state: 'local'|'synced'|'unreachable'|'diverged', pulled: [ids], pushed, conflicts: [{ id, file }] }`.
`openConflicts(dir)` lists `conflicts/*.md` (so both sides warn until resolved).
`resolveConflict(dir, id, { take: 'mine'|'theirs' })`: `theirs` replaces `<id>.md` with the
(validated) conflict copy plus one `history: {action:'amended', reason:'resolved sync conflict', …prior}`
line; either way the copies for that id are removed. `loadPrinciples` reads only
top-level `*.md` — never `conflicts/`.
`setRemote(dir, url)`: mkdir, `git init -b main` if no `.git`, write `.gitignore`, commit
local entries, set/replace `origin`, then `syncPrinciples`. An unreachable url still
records the remote and exits 0 with the advisory.

**P10 — CLI surface** (`ac principles …`, all in one `case 'principles':`):
`add "<statement>" --kind K [--strength rule|default] [--why …] [--stack t]… [--files g]… [--work w]… [--propose] [--from-session …] [--from-project …] [--from-ref …] [--excerpt …]`
· `list [--proposed|--accepted|--rejected|--all] [--json]` · `show <id> [--json]`
· `accept <id> [--edit | --statement … [--why …]]` · `reject <id> --reason …`
· `retire <id> --reason …` · `supersede <id> --by <id>` · `amend <id> --reason … [fields… | --edit]`
· `promote <id> [--as decision|convention]` · `remote [<url>]` · `resolve <id> [--take mine|theirs]`.
Bare `ac principles` = `list`. Multi-value: `--stack`, `--work`, `--files` are
**repeatable** (a local `flagValues(tail, name)` scans the raw `tail`, because `parseArgs`
keeps only the last value — do **not** change `parseArgs`); `--stack`/`--work` values are
also comma-split. Boolean flags (`propose edit all proposed accepted rejected json`)
that `parseArgs` handed a string value push that string back onto the positionals.
`ALLOWED_FLAGS` gets an entry for **every** principles verb (C2 demands typo refusal on
`add`/`reject`/`promote`; the rest are cheap). Only `promote` calls `root()`; every other
verb works outside a project.

**P11 — `list` rendering** (CONTEXT open question, C3). One line per entry via
`indexLine(entry)` in `lib/principlemd.mjs` (the phase-25 index shape):
`<id>  <status>  <kind>/<strength>  <statement>`. Oldest first (id order). Default =
accepted; when proposals exist, one closing line
`• N proposed awaiting review — ac principles list --proposed`; `--all` includes every
status; empty → `• no principles yet`. Damaged files print
`⚠ damaged entry <file>: <reason>` on stderr, the rest still list, exit 0.

**P12 — Sync reporting** (ADR-055). Every principles verb runs `syncPrinciples` before
(pull) and — for mutations — after (push). Silent on a clean or local-only sync; one line
`• principles: pulled N change(s)` when something arrived; one advisory
`⚠ principles remote unreachable — kept locally, will sync on the next command`; one
`⚠ conflict on <id> — this machine's version kept; the other is in <file> (ac principles resolve <id> [--take theirs])`
per open conflict, on **every** command while it stays open. None of these change the
exit code.

**P13 — Promote** (D8, C13/C14). Requires status `accepted`. `--as decision` (default):
`addDecision(root, { title: statement, why })`; a refusal dies and records nothing;
on success prints `✓ promoted <id> → <ADR> [shared: <branch>]` (or `[local]`). `--as
convention`: `appendConvention(root, bullet)` where bullet = `- <statement>` + (why ?
` — <why>` : ''), then prints `• publish it to the team: ac canon push`; never pushes.
Then `recordPromotion(dir, id, { project: loadState(root).project || basename(root), path: root, as, ref: ADR-id | 'convention', now })`
— **appends** a `promotion:` line; an identical project+as+ref record already present is
not duplicated. The entry stays `accepted`, its file stays in the home store.

**P14 — `appendConvention(root, bullet)`** in `lib/canon.mjs`, under
`withLock(paths(root).lock)`: the existing file content is kept as a **byte-identical
prefix**; if a line equal to the bullet exists → `{ appended: false }`; else, if the
last `## ` heading in the file is not `## Promoted from personal principles`, append
`\n## Promoted from personal principles\n\n` first, then the bullet + `\n`. Never touches
the registry; never touches `.conventions-synced` (so `canon push`/`decision add` see it
as a local edit, per ADR-053).

**Not built:** automatic proposing (23), batch review / dedupe (24), glob matching,
injection, `ask`, canon-conflict detection (25), transcript mining (26), forge import
(27), no slash command, no statusline segment.

---

## Engine API contract (tasks t1–t15 must agree exactly)

`lib/redact.mjs`: `redactSecrets(text) -> string`, `REDACTED = '[REDACTED]'`.

`lib/principlemd.mjs` (pure, no fs):
```
KINDS, STRENGTHS, WORK_SCOPES, PRINCIPLE_STATUSES, ENTRY_MARKER = '<!-- astro-principle -->'
parsePrinciple(text, { file, id }) -> entry            // throws Error naming file + problem (damaged)
renderPrinciple(entry) -> string                       // canonical; parse(render(e)) deep-equals e
normaliseFields({ kind, strength, stack, files, work, statement, why }) -> fields   // throws on invalid
indexLine(entry) -> string                             // single line (whitespace collapsed)
compareRevisions(a, b) -> 'same'|'older'|'newer'|'conflict'   // a relative to b, by history lines
```
entry = `{ id, kind, strength, status, created, scopes: { stack:[], files:[], work:[] },
statement, why, reason?, supersededBy?, source?: { session?, project?, at?, ref?, excerpt? },
promotions: [], history: [] }`.

`lib/principles.mjs`:
```
principlesDir(env = process.env)
principleId(statement, now)
loadPrinciples(dir) -> { entries, damaged: [{ id, file, error }] }     // absent dir → empty, creates nothing
resolvePrinciple(dir, ref) -> entry                     // throws: not found / ambiguous (names ids) / damaged
addPrinciple(dir, { statement, kind, strength, why, stack, files, work, source, propose, now }) -> entry
proposePrinciple(dir, { id?, statement, kind, strength, why, stack, files, work, source, now }) -> { ok, entry?, refreshed?, reason? }
acceptPrinciple(dir, ref, { statement?, why?, now }) -> entry
rejectPrinciple(dir, ref, { reason, now }) -> entry
retirePrinciple(dir, ref, { reason, now }) -> entry
supersedePrinciple(dir, ref, { by, now }) -> entry
amendPrinciple(dir, ref, { reason, statement?, why?, kind?, strength?, stack?, files?, work?, now }) -> entry
recordPromotion(dir, ref, { project, path, as, ref: target, now }) -> entry
```
Every mutator: validate args → `mkdirSync(dir)` → `withLock(join(dir, '.lock'))` →
re-read the target **strictly** (damaged → throw, file untouched) → check the transition →
`atomicWriteText(<dir>/<id>.md, renderPrinciple(next))` — that one file only.

`lib/principlesync.mjs`: `isStoreRepo(dir)`, `getRemote(dir)`, `setRemote(dir, url)`,
`syncPrinciples(dir)`, `openConflicts(dir)`, `resolveConflict(dir, id, { take })` — P9.

`lib/editor.mjs`: `editText(initial, { env = process.env }) -> { text, changed }`.

`lib/canon.mjs`: `appendConvention(root, bullet) -> { appended, file }`.

---

## Tasks

### t1 — RED: redaction tests
- **file:** `tests/redact.test.mjs` (new)
- **depends_on:** —
- `const { redactSecrets } = await import('../lib/redact.mjs')` inside each async test.
- Sentence-form tests: each P7 shape is masked (fake `ghp_` + 36 alnum, `AKIA` + 16,
  `Bearer <40-char token>`, `https://alice:s3cr3tpass@git.example.com/r.git`, `password=hunter2`,
  PEM block, `sk-…`, `xoxb-…`); the secret substring is absent from the output and the
  surrounding words (`"deploy with"`, `"git.example.com/r.git"`) survive; plain prose
  without secrets is returned byte-identical; redaction is idempotent.

### t2 — Secret redactor
- **file:** `lib/redact.mjs` (new)
- **depends_on:** —
- Implement P7's fixed pattern list as a pure `redactSecrets`. Module header (repo voice):
  why a fixed allowlist of high-signal shapes and not entropy guessing, why it lives on its
  own now (phases 23/26 feed real transcript text through it), why redact-then-truncate.

### t3 — RED: entry-file codec tests
- **file:** `tests/principlemd.test.mjs` (new)
- **depends_on:** —
- Dynamic import of `../lib/principlemd.mjs` in every test body.
- Cover: round-trip `parse(render(e))` for a fully populated entry (two globs incl. one
  with a comma in braces, stack + work lists, source with excerpt containing a newline and
  quotes, two promotions, two history lines) and `render(parse(text)) === text` for the
  canonical text; stack lowercased on normalise; `normaliseFields` throws for kind `habit`,
  strength `maybe`, work `cooking`, empty statement, multi-line statement; **damaged**
  cases each throw naming the file: missing `status`, garbage kind, id ≠ filename,
  duplicate key, unknown key, unparseable `history` JSON, missing marker, missing
  `# statement`, rejected without reason, superseded without superseded-by, a file
  containing `<<<<<<< HEAD` … `>>>>>>>` lines; `indexLine` is one line containing id and
  statement; `compareRevisions` returns `older`/`newer` for strict-prefix histories,
  `same` for equal text, `conflict` for divergent histories and for equal histories with
  different text.

### t4 — Entry-file codec
- **file:** `lib/principlemd.mjs` (new)
- **depends_on:** —
- Implement P3 + the codec contract. Hand-written line parser anchored on the marker and
  the `---` separator (the `parseDecisionEntries` style: structural anchors, no free-text
  scanning, no YAML). Header comment: why one file per entry (conflict-free merges of
  different entries, readable diffs on GitHub), why damaged throws rather than reading as
  absent (the 2026-09-18 incident `readJSONStrict` documents), why conflict markers are
  damage, why `history` lines double as the revision-marker list (decisions #35/#36).

### t5 — `$EDITOR` round-trip (test-with)
- **files:** `lib/editor.mjs` (new), `tests/editor.test.mjs` (new)
- **depends_on:** —
- Write the test first (dynamic import): `EDITOR` = a `sed -i 's/Use pnpm/Always use pnpm/'`
  command → `{ changed: true }` and the reworded statement; `EDITOR=true` → `changed:false`;
  an editor exiting 1 throws; `#` lines are stripped; the temp dir is gone afterwards; an
  `EDITOR` containing arguments works (the sh `-c … "$1"` form). Then implement P8.
  Header comment: why it is isolated (the only TTY-dependent piece; tests inject `EDITOR`).

### t6 — `appendConvention` for promote-as-convention (test-with)
- **files:** `lib/canon.mjs`, `tests/canon_append.test.mjs` (new)
- **depends_on:** —
- Test first (dynamic import of `appendConvention` in each async test; static imports only
  of `lib/planning.mjs`/`lib/paths.mjs`): in an `initPlanning` temp project, the old
  CONVENTIONS.md is a byte-identical prefix of the new one; the heading is added once and
  reused by a second different bullet; the same bullet twice → `{ appended: false }`, file
  unchanged; `.conventions-synced` untouched; no git command needed (no remote in the test).
- Then add P14's `appendConvention` as a new named export. Do not change any existing
  export's behaviour. Comment why it is append-only and never publishes (ADR-053 refuse-first;
  D8 "no implicit publish").

### t7 — RED: store engine tests
- **file:** `tests/principles.test.mjs` (new)
- **depends_on:** t2, t4
- Dynamic import of `../lib/principles.mjs` in every async test body; each test uses its
  own `mkdtempSync` dir passed explicitly. Cover:
  - `principlesDir({ HOME: h })` = `h/.astro/principles`; `ASTRO_PRINCIPLES_DIR` wins;
    `loadPrinciples` on an absent dir returns empty and **creates nothing** (C16).
  - add → accepted, dated id with today + slug, exactly one `.md` file, readable prose
    (C1); `propose:true` → proposed (C3).
  - invalid kind/strength/work → throws, dir file set + bytes unchanged (C2).
  - identical statement twice same day → `-2` id, two files, first untouched (C6);
    exact-id-wins, unique prefix, ambiguous prefix error naming both, unknown id error.
  - every legal move of P4 and every illegal one (retire/supersede a proposed, reject an
    accepted, accept a rejected, supersede `--by` missing/self/non-accepted) — illegal
    ones leave the file byte-identical; reject/retire without reason throw (C4).
  - accept with reworded statement records an `edited` history line with the prior text;
    amend keeps the id, writes one file, records reason + prior text; amend with no reason
    or no change throws (C5).
  - with 4 entries, one mutation changes exactly that entry's file hash (C7).
  - a damaged file: listed under `damaged`, `resolvePrinciple` on it throws naming the
    file, mutating it throws and leaves it byte-identical, mutating others leaves it
    byte-identical, a new add whose id would collide gets `-2` (C8).
  - source excerpt with the four C9 secrets: `grep`-equivalent over every file in the
    dir finds none, surrounding words and pointers round-trip (C9).
  - `proposePrinciple({ id })` refreshes a plain proposed entry, and returns `ok:false`
    with the file byte-identical for accepted, rejected, amended and edited-on-accept
    entries; no propose path yields `accepted` (C15).
  - `recordPromotion` appends (two promotions kept), status stays accepted.

### t8 — The principle store
- **file:** `lib/principles.mjs` (new)
- **depends_on:** t2, t4
- Implement the store contract (P2, P4, P5, P6, P7, P13's `recordPromotion`). Imports:
  `datedId` from `lib/fixes.mjs`, `withLock`/`atomicWriteText` from `lib/util.mjs`,
  `redactSecrets` from `lib/redact.mjs`, the codec from `lib/principlemd.mjs`. **No git**
  (that is `lib/principlesync.mjs`). Module header in the voice of `lib/backlog.mjs`:
  ADR-057 (why the home dir, why it is an explicit exception to ADR-048), ADR-058 (why
  accept is the only way in and why refresh touches only untouched proposals, why rejections
  are kept), ADR-013/#45 (why dated slugs that are never reissued), and why every function
  takes `dir` (tests never touch the real home).

### t9 — RED: sync engine tests (real bare remote, two stores)
- **file:** `tests/principlesync.test.mjs` (new)
- **depends_on:** t4
- Dynamic import of `../lib/principlesync.mjs`; static imports allowed for `lib/git.mjs`
  and `lib/principlemd.mjs` (on the branch from wave 1). Entries are written with
  `renderPrinciple` + `writeFileSync` so this suite does not depend on t8. Harness in the
  `tests/registry.test.mjs` shape: `mkBareRemote()` + two store dirs ("machines"), with
  `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env set. Cover:
  - no `.git` → `state:'local'`, no `.git` created, even when the store sits **inside**
    another git repo (create the store dir under a `git init`ed parent; the parent's
    `git status` is unchanged) — P9's dotfiles trap.
  - `setRemote` on A with entries → remote `main` holds them; `setRemote` on B → B holds
    them (unrelated-history first merge) (C10).
  - different entries edited on both → both converge, no conflicts, identical file hashes
    (C10).
  - remote moved aside → `state:'unreachable'`, local files and commits intact, nothing
    deleted; moved back → next sync pushes; every earlier remote tip is an ancestor of the
    new tip (`git merge-base --is-ancestor`, no force) (C11).
  - divergent edits to one entry while offline on both → second sync reports a conflict
    naming the id, `<id>.md` parses (no markers), the other version sits in
    `conflicts/` on both machines after one more sync; `resolveConflict` both ways (C12).
  - older-vs-newer revision (only A changed x) → B takes A's silently, no conflict (C12).
  - a store with an uncommitted file written by a helper is committed by the next sync.

### t10 — Offline-first git sync for the store
- **file:** `lib/principlesync.mjs` (new)
- **depends_on:** t4
- Implement P9 with `git()`/`gitOk()` from `lib/git.mjs` and `withLock` from
  `lib/util.mjs`. Header comment: why a plain repo and not `shared.mjs`'s orphan-branch
  CAS (one owner, readable history; CONVENTIONS' "cross-machine only via `transact`" rule
  governs team-shared numbering/canon, not a personal store — say so explicitly), why
  fetch failure stops everything (ADR-043), why conflicts become a side file instead of
  markers or a silent winner (ADR-053's no-prose-merge precedent), why `.git` presence and
  not `isRepo`, why never `--force`.

### t11 — CLI: `ac principles` core verbs
- **file:** `bin/ac.mjs`
- **depends_on:** t5, t8, t10
- New `case 'principles':` in the `case 'backlog':` shape: `const dir = principlesDir();`
  `const sub = pos[0] || 'list';` every verb `checkFlags('principles <sub>', flags)` before
  any side effect; unknown sub → `die()` naming every verb. Implements P10 for
  `add | list | show | accept | reject | retire | supersede | amend` plus the P12 pre/post
  `syncPrinciples` wiring and conflict/advisory lines (sync is a no-op until t13's
  `remote` exists). Engine errors are caught and `die(err.message)`.
  - `add` → `✓ principle <id> (accepted|proposed)`; `--propose` goes through
    `proposePrinciple` (P6).
  - `list` → P11. `show` → a human block: id, status (+ reason / superseded-by), kind,
    strength, stack/files/work, statement, why, source pointers + (already redacted)
    excerpt, promotions (one line each), history (one line each with reason); `--json`
    prints the entry.
  - `accept` → `--edit` uses `editText` (unchanged → `die`, nothing written);
    `--statement/--why` reword without an editor. `amend` likewise, `--reason` required.
  - `ALLOWED_FLAGS` entries (ADR-029) for **all** P10 verbs, including `promote`,
    `remote`, `resolve` now so t13 only adds code:
    `'principles add': ['kind','strength','why','stack','files','work','propose','from-session','from-project','from-ref','excerpt']`,
    `'principles list': ['proposed','accepted','rejected','all','json']`,
    `'principles show': ['json']`, `'principles accept': ['edit','statement','why']`,
    `'principles reject': ['reason']`, `'principles retire': ['reason']`,
    `'principles supersede': ['by']`,
    `'principles amend': ['reason','statement','why','kind','strength','stack','files','work','edit']`,
    `'principles promote': ['as']`, `'principles remote': []`, `'principles resolve': ['take']`.
  - `HELP` lines, each starting `  ac principles ` (so `verbHelp` finds them), for the
    verbs this task implements.
  - Never call `root()` in this case except for `promote` (t13).

### t12 — CLI tests: store, lifecycle, damage, redaction, isolation
- **file:** `tests/principles_cli.test.mjs` (new)
- **depends_on:** t5, t8, t10
- Subprocess harness: `spawnSync(process.execPath, [AC, …], { env })` where every "machine"
  gets `HOME = mkdtempSync(…)`, `GIT_AUTHOR_*`/`GIT_COMMITTER_*` set, and
  `ASTRO_PRINCIPLES_DIR` **deleted** from the env (so the default `$HOME/.astro/principles`
  path is what is exercised); one extra test sets `ASTRO_PRINCIPLES_DIR` and asserts
  nothing appears under `$HOME`. Run from a scratch project (`git init` + `ac init`).
  Drive each criterion's *Observe* literally: C1 (incl. project `git status --porcelain`
  unchanged, no `.git` in the store), C2 (show fields; the four refusals + `--knd`, and a
  typo'd flag on `reject` and `promote`, each with every store file hashed before/after),
  C3, C4, C5 (`EDITOR="sed -i 's/Use pnpm/Always use pnpm/'" … accept <id> --edit`, and
  `--edit` with `EDITOR=true` refused), C6, C7, C8 (corrupt the status line, then kind),
  C9 (`--excerpt` with the four secrets; recursive read of the store finds none; `show`
  prints the masked excerpt and the pointers), C15 (`add --propose` with an accepted
  entry's statement leaves that file byte-identical). C16 guard: `ac status`, `ac help`
  and `ac principles list` on a fresh `HOME` leave no `$HOME/.astro/principles`.

### t13 — CLI: `promote`, `remote`, `resolve`
- **file:** `bin/ac.mjs`
- **depends_on:** t6, t11
- Add the three verbs to the `principles` case: `promote` per P13 (`root()` here only;
  status must be accepted; `--as` ∈ `decision|convention`, anything else dies; reuse the
  `ac decision add` block's refusal/⚠ reporting for `addDecision` results rather than a
  thinner copy), `remote` per P9 (`remote` alone prints the url or
  `• local only — no remote`), `resolve` per P9 (`--take` ∈ `mine|theirs`, default mine).
  Add their `HELP` lines. `ALLOWED_FLAGS` entries already exist from t11.

### t14 — CLI tests: promote into project canon
- **file:** `tests/principles_promote.test.mjs` (new)
- **depends_on:** t6, t11
- Harness from `tests/flags.test.mjs` (`mkBareRemote` + `mkWorkdir` + `ac registry init`)
  plus the isolated `HOME` of t12. C13: default promote → a new ADR in DECISIONS.md with
  the statement, the same ADR on `astro-registry:DECISIONS.md` in the bare remote, all
  pre-existing ADR headings still present with the same numbers, `show` lists the
  promotion with project + ADR id, status accepted, store file under `$HOME`. C14:
  record the registry tip, `promote <id2> --as convention` → CONVENTIONS.md has the
  statement with the old content as a prefix, registry tip unchanged, stdout names
  `ac canon push`; promoting the same entry into a second project adds a second
  promotion; promoting a proposed entry and `--as foo` both exit non-zero with no change.

### t15 — CLI tests: two machines on one private remote
- **file:** `tests/principles_sync_cli.test.mjs` (new)
- **depends_on:** t6, t11
- Two `HOME`s + one bare `remote.git`, all via the CLI. C10 (a1 → remote → B sees it; b1
  reaches A on A's next `list --all`; A amends a1 while B accepts a proposal → both `show`s
  agree, entry-file hashes match, no `⚠ conflict`). C11 (move `remote.git` aside: `add`,
  `accept`, `amend`, `list` all exit 0 with at most the advisory; move back: next command
  exits 0, B sees the offline work, every pre-outage remote tip is an ancestor of the new
  one). C12 (remote moved aside, A and B amend x differently, restore, sync A then B: a
  `⚠ conflict on <id>` line, both texts recoverable from the stores/remote, `show x`
  parses; `resolve --take theirs` clears the warning; and the one-sided amend case reports
  nothing).

### t16 — Docs and canon: the principle store on the record
- **files:** `MANUAL.md`, `.astrocode/CONVENTIONS.md`, `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** t13
- `MANUAL.md`: a "Principles" subsection (what the store is, where it lives,
  `ASTRO_PRINCIPLES_DIR`, accept-is-the-only-way-in, rejected entries are kept, `remote`
  and offline-first sync, conflicts + `resolve`, promote vs. personal) and the
  `ac principles …` lines in the `ac` cheat sheet — only verbs the CLI has
  (`tests/contracts.test.mjs` checks every `ac …` code span). Add it to the MANUAL's table
  of contents like the Backlog entry.
- `.astrocode/CONVENTIONS.md` "State / data flow": one bullet — the personal principle
  store (`~/.astro/principles/`, one Markdown file per entry, written only through
  `lib/principles.mjs`/`lib/principlesync.mjs`) is the ADR-057 exception to "state lives
  under `.astrocode/`", and its cross-machine safety is plain git merge + non-force push,
  not `transact()`.
- Record the pinned specifics with the CLI (never hand-edit DECISIONS.md):
  `ac decision add "Principle-store specifics this plan pinned: …" --why "…" --rejected "…"`
  — the P3 file format with conflict markers as damage, P5 exact-id-wins resolution, P8
  flags + $EDITOR with unchanged-refuses, P9 repo-only-after-remote / `.git`-presence /
  fetch-failure-stops / conflict side-file + `resolve`, P13 promotion record. Rejected:
  YAML front matter, a JSON index file, orphan-branch CAS for a personal store, automatic
  conflict resolution. `ac decision add` rewrites `DECISIONS.md` and regenerates
  `DECISIONS.in-force.md` itself (and publishes the CONVENTIONS.md edit above, ADR-053) —
  commit exactly what the CLI wrote.
- Final gate inside this task: `node --test tests/` green with `HOME=$(mktemp -d)`, and
  that `HOME` holds no `.astro/principles` afterwards (C16).

---

## Wave shape

| wave | tasks |
| --- | --- |
| 1 | t1, t2, t3, t4, t5, t6 |
| 2 | t7, t8, t9, t10 |
| 3 | t11, t12 |
| 4 | t13, t14, t15 |
| 5 | t16 |

Rule checks: RED tests are paired with their implementation by identical `depends_on`
(t1/t2, t3/t4, t7/t8, t9/t10, t12/t11, t14+t15/t13), so every boundary integrates green;
all RED imports of not-yet-existing symbols are dynamic; no task deletes or renames a
module or symbol, so no consumer fixups are split; `bin/ac.mjs` is owned by t11 then t13
(serialized), `lib/canon.mjs` only by t6, every new file by exactly one task; every task
declares its files and commits.

## Definition of done

`HOME=$(mktemp -d) node --test tests/` green from the repo root with no test skipped and
no `.astro/principles` left in that `HOME`, and every criterion in `CRITERIA.md` drivable
from the shipped CLI exactly as its *Observe* paragraph describes.
