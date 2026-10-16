# Plan — phase 46: witness cites proof of a choice made elsewhere, machine-typed prefixes, witness holes (GitHub #132)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - Node ≥ 22, ESM `.mjs`, zero dependencies;
  - named exports only, `die()` for fatal CLI errors (a thrown lib error reaches `die` through
    `main().catch`), `✓ • ⚠` glyphs, machine output through `json()`;
  - `node:test` with real `mkdtempSync`, no mocks;
  - dense why-comments.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-081 is the rule this phase builds: a citation is stored beside the record and never makes
    the signer human, and a machine-typed prefix never counts as human in any composer-gated mod.
    ADR-080 is not in force, and nothing here derives from it.
  - ADR-074: witness records and never refuses.
  - ADR-077: the quoted mention.
  - ADR-033: provenance is declared.
  - ADR-071: (c) a mod keeps no state and `ac` is the only reader of `~/.astro/config.json`;
    (e) fail open.
  - ADR-029: every new flag goes in the `checkFlags` table.
  - ADR-018: RED tests use `await import`.
  - ADR-020: every wave boundary is green.
- This phase's `CONTEXT.md`, decisions 1–4, the planner defaults, the folded-in debt and the
  quoted-mention finding. The plan aims at `CRITERIA.md` C1–C12.

Principles brief (`--stage plan --by planner`), applied and cited:
- **1a0d (automation only proposes):** `--evidence` is stored in its own field. It never touches
  `accepted_kind`, `accepted_evidence` or the AGENT marker, and the witness rewrite never reads it.
- **ce7b (enforce in code):** the citation limits, the prefix rule and the four witness holes
  are enforced in code. The command docs only say when to pass the flag.
- **9173 (one place per rule):**
  - the citation rule lives in `lib/util.mjs` `checkCitation`;
  - the prefix-list validity rule lives in `lib/mods.mjs` `readMods`;
  - the prefix match lives in `hooks/lib/machine.js` `isMachineTyped`;
  - the `--witnessed` strip regex lives in `gates.js` `dropWitnessed`;
  - the config key is stated once, in MANUAL.md's mods paragraph.
- **333f (deterministic tooling):** prefix matching is a plain, case-sensitive `startsWith`. No
  regex, no judgement.
- **b940 (fail soft):** a missing or malformed list gives no prefixes and one `⚠` in
  `ac mods status`. Witness and the switches are untouched.
- **2310 (slash surface):** `/astro-accept` and `/astro-fix-accept` relay `--evidence`.

## Design decisions made here

- **D1 — Storage field: `cited_evidence`, one name everywhere.**
  - Phase accept: a top-level `cited_evidence` on the roadmap entry, beside `accepted_by`,
    `accepted_kind`, `accepted_at` and the optional `accepted_evidence`.
  - Phase reject: a `cited_evidence` on that rejection's entry in `rejections[]`. It is distinct
    from `entry.evidence`, which stays the witness value. The `state.blockers` entry carries it
    too.
  - Fix accept: a `cited_evidence` on the fix record in `fixes.json`.
  - The internal parameter name is **`cite`**, never `evidence`. `evidence` already means the
    witness composer value, and a reused name would trip the "evidence + agent contradict" walls
    in `acceptFix` and `rejectPhase`. Those walls must not fire on a citation.
  - The field is written only when a citation was given. A record without one has no key.
- **D2 — The citation rule: `checkCitation(raw)` in `lib/util.mjs`, the only place it is
  stated.** It throws a one-line `Error` or returns the trimmed string.
  - `raw === true` (a bare `--evidence`), a non-string, or a value whose trim is empty gives:
    `--evidence needs a value: the id or URL of the decision (ADR-081)`.
  - A raw value containing `\r` or `\n` gives `--evidence must be one line (ADR-081)`.
  - A trimmed length (`[...s].length`) over `CITATION_MAX = 200` gives
    `--evidence is <n> characters; at most 200 (ADR-081)`.
  - Exactly 200 characters is accepted.
  - The CLI calls it before any write. `acceptFix` and `rejectPhase` call it again on `cite` as
    a second wall. They call the one function and never restate its limits.
- **D3 — Display.**
  - **The success lines.** A `CITES_NOTE(v)` helper in `bin/ac.mjs` appends ` (cites: <v>)` to
    the accept and reject lines. The existing ` (AGENT — machine-signed, not human UAT)` and
    `WITNESSED_NOTE` suffixes are unchanged. `WITNESSED_NOTE` stays keyed on the witness value
    only, so `--evidence` alone can never print "witnessed".
  - **`ac phase show`.** It already prints the raw entry, so `cited_evidence` shows with no work.
  - **`ac fix list --all`.** This is new. It lists accepted fixes too. Each accepted line reads
    `  <id>  accepted  <title>  · by <who>[ (agent)][ · cites <v>]`.
    - Plain `ac fix list` and `--json` keep printing open fixes only, because phase-band
      reads `fix list --json`.
    - `--all --json` prints every fix record.
  - **`ac fix show <id>`.** It prints the raw record, accepted ones included, so the citation
    shows there too.
- **D4 — Flags (ADR-029).**
  - `'evidence'` is added to `'phase accept'`, `'phase reject'` and `'fix accept'`.
  - New entry `'fix list': ['json', 'all']`, and `fix list` now calls `checkFlags`.
  - `--evidence` never conflicts with `--agent`, `--by` or `--witnessed`. Every combination is
    stored as given.
- **D5 — Ambiguous fix ref.**
  - New `resolveFix(root, ref)` in `lib/fixes.mjs` returns one of three shapes:
    - `{ fix }`;
    - `{ ambiguous: [ids] }`, from the same two tiers as today: `endsWith('-'+ref)`, then
      `includes`;
    - `{}`.
  - `findFix` becomes a thin wrapper that returns `resolveFix(...).fix ?? null`. Its existing
    test, which expects null when ambiguous, and its other callers are unchanged.
  - The CLI's one lookup, used for `show`, `status` and `accept`, dies with
    `ambiguous fix "<ref>": matches <id1>, <id2> — use the full id`. It lists at most 5 ids, then
    `, … (+N more)`. The `no such fix` message stays for the zero-hit case.
- **D6 — Config key: `mods.machinePrefixes` in `~/.astro/config.json`.**
  - It is per user, beside the switches. `lib/mods.mjs` is already the only reader and writer of
    `mods`, and `setMod` keeps unknown `mods` keys.
  - **Validity, in `readMods` only:**
    - the key is absent: `[]`, no warning;
    - otherwise it must be an array of at most 50 entries, each a string that is non-empty after
      trim, has no leading whitespace (it could never match a trimmed prompt), and is at most 200
      characters long;
    - any violation, or a non-array value: the WHOLE list becomes `[]`, never half-applied, plus
      exactly ONE warning:
      `mods.machinePrefixes in ~/.astro/config.json must be a list of non-empty strings — no machine-typed prefixes apply`.
  - Entries are used verbatim, so `"[relay] "` keeps its trailing space.
  - When the file is invalid JSON, or `mods` is not an object, the existing single warning is the
    only notice and `machinePrefixes` is `[]`.
  - `readMods` returns `{ switches, warnings, configured, machinePrefixes }`. The
    `--switches-only` payload becomes `{ switches, warnings, machinePrefixes }`.
- **D7 — The plugin side of the prefixes.**
  - **`switches.js`.**
    - `setSwitches` also stores `machinePrefixes`, but only when it is an array of non-empty
      strings; otherwise it stores `[]`. This is a shape guard like "only a literal `true` is
      on", not the validity rule.
    - A missing field (an older `ac`) gives `[]`.
    - A bad field never throws and never touches the switches.
    - New export `getPrefixes()`. `resetSwitches` clears the prefixes, and so does the all-off
      start of `setSwitches`.
  - **New pure module `hooks/lib/machine.js`** (no `$`, no imports):
    - `isMachineTyped(text, prefixes)` is true iff `typeof text === 'string'` and some `p` in
      `prefixes` satisfies `text.trimStart().startsWith(p)`. It is case-sensitive, has no regex,
      and anchors at the start only.
    - `commandText(command, args)` gives `'/' + command.replace(/^\//, '') + (args ? ' ' + args : '')`,
      the text a typed slash command was, for `command.run`.
  - **The plugin emits no notice about the list.** The one notice is the `⚠` in `ac mods status`,
    which C6 and CONTEXT ("at most one") allow.
  - Prefixes are read at session start, so a change needs `/reload-plugins`. MANUAL says so.
- **D8 — Witness wiring (`features/witness.js`).**
  - **`witnessCommand`, composer.** When `isMachineTyped(commandText(e.command, e.args), getPrefixes())`,
    set `turn = { origin: 'machine', typed: null, expansion: true }`. The expansion
    `prompt.submit` that follows keeps that verdict through the existing `expansion` path.
  - **`witnessPrompt`, composer, not an expansion.** When `isMachineTyped(e.text, getPrefixes())`,
    set `turn = { origin: 'machine', typed: null, expansion: false }`. The check runs BEFORE
    `parseBang`, which covers `   [relay] ! ac phase accept 41`.
  - **Mid-turn prompts** (`turnId`) are unchanged.
  - **Effect.** `witnessed()` is false (the origin is not `composer`), and `turn !== null`. So a
    gate call gets `--agent claude` and a human marker becomes the agent marker, through the
    existing paths. A machine-typed `/astro-discuss 41` therefore demotes the marker as well.
  - **The cold `--witnessed`.** Every `undetermined` return in `decideBash` drops a
    self-supplied `--witnessed`: a known-null turn, or a typed gate with an empty id.
    - Readable hit: `rewriteGate(cmd, hit, { strip: ['--witnessed'] })`, with no add.
    - Ambiguous or unreadable: `dropWitnessed(cmd)`.
    - Nothing else changes: no `--agent` is added, so the call stays as declared (ADR-071 e),
      minus a forged claim. `NOTICE.undetermined` gains `(a self-supplied --witnessed is
      dropped)`.
  - **The variable verb.** The ambiguous branch also signs when `VAR_VERB.test(command)`: the
    condition becomes `(GATE_VERBS.test(shellText(c)) && !RAW_SEES.test(c)) || VAR_VERB.test(c)`,
    and the work goes to `signSegments`.
  - **The Bash marker write.** `decideBash` runs a marker pass FIRST:
    - call `bashMarkerRewrite(command)`;
    - if it returns non-null and the turn is null or `undeterminedFor('discuss marker')`, the
      command is left alone with `undetermined`;
    - if every phase it names is `witnessed('discuss marker', String(n), e)`, the command is left
      alone;
    - otherwise the rewritten command is used, with `marker`.

    The gate pass then runs on the resulting command. The first non-null `say` wins.
- **D9 — The pure changes in `gates.js`.**
  - **`readGate`** returns `{ bad: true }` in two cases: the word in verb position (`b`) after
    `phase` or `fix` contains `$` or a backtick, or the subcommand word `a` contains `$` or a
    backtick and `b` is `accept` or `reject`.
  - **`VAR_VERB`** (new export) matches:
    - an `ac`, `…/ac` or `ac.mjs` word followed by `phase|fix` and an optionally quoted `$` or
      backtick word;
    - or an `ac` word followed by an optionally quoted `$` or backtick word and then
      `accept|reject`.
  - **`signSegments`** signs a segment when `GATE_VERBS.test(shellText(p)) || VAR_VERB.test(p)`.
    It appends ` --agent claude` at the segment end, so `--reason x` and the ref stay intact.
  - **`onlyQuotedMention`.** An unquoted `ac`, `astrocode` or `ac.mjs` word no longer bails by
    itself.
    - Quoted spans are replaced by a placeholder token, not a space. So `ac "phase" "accept" 4`
      still bails: the next word is the placeholder.
    - The command is a mention only when two things hold:
      - the word right after every unquoted `ac` is a plain subcommand word (`/^[a-z][a-z-]*$/`)
        other than `phase` or `fix`;
      - the existing `GATE_VERBS` check on the unquoted remainder stays false.
    - `RUNS_TEXT` stays on the raw text. A quoted runner word keeping the command unreadable is a
      documented gap, and it is the safe direction.
  - **`dropWitnessed(command)`** (new export) returns the command with every `--witnessed[=v| v]`
    removed, or null when nothing changed. `rewriteRaw` uses it, so there is one regex.
  - **`bashMarkerRewrite(command)`** (new export) returns `{ command, phases }` or null. It
    applies when both of these hold:
    - the raw command contains the inline human marker (`HUMAN_INLINE`);
    - at least one token (split on whitespace, quotes and `;&|<>()`) gives a non-null
      `isPhaseContextPath`.

    Each inline human marker in the raw text is replaced with `AGENT_MARKER`. The agent marker
    contains no `/`, `&`, `'`, `"`, `%` or `\`, so it stays valid inside `sed s///`, `printf` and
    heredocs. `phases` is the sorted unique phase numbers. A false positive, such as a `grep` that
    reads the marker, is accepted: it writes no file. The parser is a mistake-catcher, not a
    sandbox. These forms are documented as gaps:
    - a path held in a variable;
    - a `cd` followed by a bare `CONTEXT.md`;
    - a marker split across quoting.
  - **The header's "Known gaps"** paragraph is updated to match.

## Test strategy (ADR-018)

Every behaviour task is **test-first inside the task**: the tests are written first and land in the
same stamped commit. There are no separate RED tasks.
- Every new symbol is reached through `await import(...)` inside async test bodies:
  - `checkCitation` and `resolveFix` (t1);
  - `dropWitnessed`, `VAR_VERB` and `bashMarkerRewrite` through the existing `gates()` dynamic
    import (t4);
  - `machine.js` and `getPrefixes` (t5).
- The plugin tasks (t6, t7) drive the plugin through `tests/fixtures/mods_engine.mjs` `boot()`,
  which imports `register.js` dynamically.
- The CLI tasks spawn `bin/ac.mjs`.
- **Test-after is chosen for t8 only.** It holds docs plus the full-suite gate, and it depends on
  every behaviour task because `tests/contracts.test.mjs` checks that verbs named in command docs
  exist.

## Tasks

### t1 — Engine: the citation rule, citation storage on fix accept and phase reject, `resolveFix`
- **id:** t1
- **file:** `lib/util.mjs`, `lib/fixes.mjs`, `lib/roadmap.mjs`, `tests/citation.test.mjs` (new), `tests/fixes.test.mjs`
- **depends_on:** []
- **Test first.** Write `tests/citation.test.mjs` with sentence-form names, real `mkdtempSync`
  projects, and `await import('../lib/util.mjs')` / `'../lib/fixes.mjs'` / `'../lib/roadmap.mjs'`
  inside async bodies. Cover:
  - **`checkCitation`:**
    - refuses `true`, `''`, `'   '`, `'a\nb'`, `'a\rb'` and a 201-character string, each with a
      single-line message containing `--evidence`;
    - returns a 200-character string unchanged;
    - trims `'  DEC-7  '` to `'DEC-7'`.
  - **`acceptFix(root, id, { agent: 'claude', cite: 'https://board.example/f/3' })`:**
    - stores `cited_evidence`;
    - keeps `accepted_kind: 'agent'`;
    - writes no `accepted_evidence`;
    - does NOT throw the evidence/agent contradiction.
  - **`acceptFix` with both `evidence: 'composer'` and `cite: 'DEC-1'`** stores both fields.
  - **`acceptFix` without `cite`** writes no `cited_evidence` key.
  - **`acceptFix` with `cite: 'a\nb'`** throws, and the fix stays open.
  - **`rejectPhase(root, slug, { reason: 'x', agent: 'claude', cite: 'DEC-9' })`:**
    - the rejection entry carries `cited_evidence: 'DEC-9'` and `kind: 'agent'`;
    - no `evidence` key is written;
    - a bad `cite` throws before the write, and the phase status is unchanged.
  - **`resolveFix`:**
    - gives `{ fix }` for an exact id and for a unique suffix;
    - gives `{ ambiguous: [both ids] }` for two fixes `2026-10-01-foo` and `2026-10-02-foo`
      (created with `addFix` and different `now`) on ref `foo`;
    - gives `{}` for `no-such-slug`.
  - **In `tests/fixes.test.mjs`:** extend the existing phase-41 ambiguity test to assert that
    `findFix` still returns `null`. It stays as written.
- **Implement:**
  - `export const CITATION_MAX = 200` and `export function checkCitation(raw)` in `lib/util.mjs`,
    with a why-comment citing ADR-081 and 1a0d ("a citation, never a signer").
  - A `cite` option on `acceptFix` and on `rejectPhase`. Each calls `checkCitation` when
    `cite !== undefined`, inside the lock and before any mutation. It writes `cited_evidence`
    and never feeds the evidence/agent wall.
  - `export function resolveFix(root, ref)`, plus `findFix` as its wrapper (D5).
- **Commit:** `feat(evidence): citation rule and cited_evidence on fix accept and phase reject, resolveFix (phase 46 t1)`.

### t2 — CLI: `--evidence` on phase accept, phase reject and fix accept; `fix list --all`; the ambiguous-slug message; help
- **id:** t2
- **file:** `bin/ac.mjs`, `tests/evidence_cli.test.mjs` (new), `tests/flags.test.mjs`, `tests/fixes.test.mjs`
- **depends_on:** [t1, t3]
- t3 is a dependency only to serialize `bin/ac.mjs`.
- **Test first**, in `tests/evidence_cli.test.mjs`. Use a real tmp project (`git init`,
  `ac init`, `ac phase add`, then `ac phase verify 1`; no CRITERIA.md, so the verdict gate passes)
  and `spawnSync(process.execPath, [AC, …])` with `HOME` set to a tmp dir. Cover:
  - **C1:**
    - `phase accept 1 --agent claude --evidence "https://board.example/d/42"`:
      - prints `(cites: https://board.example/d/42)` and the AGENT marker;
      - `phase show 1` (with and without `--json`) has `cited_evidence` equal to that URL,
        `accepted_kind: 'agent'`, and no `accepted_evidence`.
    - In a second project, `--witnessed composer --evidence "DEC-7"` stores
      `accepted_evidence: 'composer'` and `cited_evidence: 'DEC-7'`, and prints both notes.
    - `--evidence` alone, with no `--witnessed`, never prints `witnessed`.
  - **C2:**
    - `phase reject 1 --reason x --agent claude --evidence DEC-9`: the last rejection entry has
      `cited_evidence: 'DEC-9'` and `kind: 'agent'`, and the line prints `(cites: DEC-9)`.
    - `fix accept <id> --agent claude --evidence "https://board.example/f/3"`:
      - prints the cites note;
      - `fix list --all` shows the fix line with `accepted`, `(agent)` and
        `cites https://board.example/f/3`;
      - `fix show <id>` JSON has `cited_evidence`;
      - plain `fix list` still omits accepted fixes;
      - `fix list --all --json` includes the record.
  - **C3:** for each of `phase accept 1`, `phase reject 1 --reason x` and `fix accept <id>`, each
    of these exits non-zero with exactly one stderr line starting `✖`:
    - `--evidence <201 chars>`;
    - `--evidence "$'a\nb'"` (pass the real newline in argv);
    - `--evidence ""`;
    - a bare trailing `--evidence`.

    Afterwards `phase show 1 --json` is still `verified` with no `rejections` or `accepted_*`,
    and the fix is still open. A 200-character citation is accepted.
  - **C12, in `tests/fixes.test.mjs`:**
    - two fixes `…-foo` on different dates: `fix accept foo` exits non-zero with one line
      matching `/ambiguous fix "foo".*matches .*-foo, .*-foo/`, and `fix list` still shows both
      open;
    - `fix accept no-such-slug` still says `no such fix`;
    - `fix accept <full id>` accepts exactly that one.
  - **`tests/flags.test.mjs`:** one ADR-029 typo row: `phase accept 1 --evidnce x` exits with
    `unknown flag`. Also, `fix list --bogus` exits with `unknown flag`.
- **Implement in `bin/ac.mjs`:**
  - `ALLOWED_FLAGS`, each with a one-line why-comment:
    - `'evidence'` added to the three gate verbs;
    - `'fix list': ['json', 'all']`.
  - `citedEvidence(flags)`: when `flags.evidence !== undefined`, return `checkCitation(flags.evidence)`,
    turning a throw into `die`. Call it before any write in the three verbs.
  - Phase accept: spread `...(cite !== undefined ? { cited_evidence: cite } : {})` into
    `setPhaseStatus`'s extra.
  - Phase reject: pass `cite` to `rejectPhase`, and add `cited_evidence` to the blockers entry
    when given.
  - Fix accept: pass `cite` to `acceptFix`.
  - `CITES_NOTE(v)` on the three success lines (D3).
  - The fix lookup uses `resolveFix`, and the ambiguous `die` follows D5.
  - `fix list --all` follows D3.
  - Usage `die`s and help lines gain `[--evidence "<id or URL>"]`:
    - `ac phase accept <p> … --evidence "<id or URL>"`, described as "cite a decision made
      elsewhere (stored as cited_evidence; never makes the signer human, ADR-081)";
    - the same on reject and fix accept;
    - `ac fix list [--all]`, described as "open fixes (--all: accepted too)".
  - Run `node --test tests/flags.test.mjs tests/fixes.test.mjs tests/rejections.test.mjs tests/contracts.test.mjs tests/fleet.test.mjs`
    as well.
- **Commit:** `feat(cli): --evidence cites an outside decision on accept, reject and fix accept; fix list --all; ambiguous fix ref (phase 46 t2)`.

### t3 — `ac` hands the machine-typed prefixes to the mods (`mods.machinePrefixes`)
- **id:** t3
- **file:** `lib/mods.mjs`, `bin/ac.mjs`, `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`
- **depends_on:** []
- **Test first:**
  - **`tests/mods.test.mjs`** (`readMods` with a tmp home), covering D6:
    - absent key gives `machinePrefixes: []` and no warning;
    - `["[relay] ", "/astro-accept", ".*"]` is returned verbatim, trailing space kept;
    - each of these gives `[]` plus exactly one warning naming `mods.machinePrefixes`, and the
      switches still read as configured:
      - `"x"`;
      - `{}`;
      - `[1]`;
      - `["ok", 2]` (never half-applied);
      - `[""]`;
      - `["  "]`;
      - `[" lead"]`;
      - 51 entries;
      - a 201-character entry;
    - invalid JSON gives `[]` and only the existing single warning.
  - **`tests/mods_cli.test.mjs`:**
    - update the `--switches-only` keys test to `['machinePrefixes', 'switches', 'warnings']`;
    - add: a config with `mods.machinePrefixes: ["[relay] "]` prints it in the payload;
    - add: a malformed list prints `machinePrefixes: []` and one warning, with exit 0;
    - add: `ac mods status`, human form, prints that warning once as `⚠`.
- **Implement:**
  - `readMods` validates and returns `machinePrefixes` on every return path. The rule lives only
    here, with a why-comment: the empty string matches every prompt, and that is the failure
    ADR-081 warns about.
  - `modsStatus` passes warnings through as today.
  - `bin/ac.mjs` `--switches-only` prints `json({ switches: r.switches, warnings: r.warnings, machinePrefixes: r.machinePrefixes })`.
- **Commit:** `feat(mods): ac mods status --switches-only carries the user's machine-typed prefixes (phase 46 t3)`.

### t4 — `gates.js`: variable verb, quoted mention behind an `ac` head, `dropWitnessed`, Bash marker rewrite
- **id:** t4
- **file:** `mods/astro-mods/hooks/lib/gates.js`, `tests/witness.test.mjs`
- **depends_on:** []
- **Test first**, as new rows in `tests/witness.test.mjs`, through the existing `gates()` dynamic
  import:
  - **C11, the exact CONTEXT command:**
    `ac decision add "A human gate (phase accept/reject, fix accept) may cite a decision made elsewhere with --evidence \"<id or URL>\", stored beside the record; a citation never makes the signer human"`.
    `onlyQuotedMention` is true, and `findGates` is `none`.
  - **More C11 rows:**
    - `git commit -m "docs: say \"ac phase accept 41\" in the manual"` is a mention;
    - a variant with `\"` right before the verb is a mention;
    - regressions stay non-mentions:
      - `ac "phase" "accept" 4`;
      - `ac decision add x; ac phase accept 4`;
      - `ac $X accept 41`;
    - `echo "say \"hi\"" && ac phase accept 41`: `findGates` is `one`, with ref `41`.
  - **C10:**
    - each of these gives `findGates` `ambiguous` and `VAR_VERB` true:
      - `V=accept; ac phase $V 41`;
      - `V=accept && ac phase "$V" 41`;
      - `export V=reject; ac phase $V 41 --reason x`;
      - `G=accept; ac fix $G 2026-10-01-foo`;
      - `ac $X accept 41`;
    - `signSegments` on each appends ` --agent claude` to the `ac` segment only, leaving the
      assignment segment and `--reason x` intact;
    - `ac phase show $N` is not ambiguous.
  - **C9:**
    - `dropWitnessed('ac phase accept 41 --witnessed composer')` gives `'ac phase accept 41'`;
    - the `=` form and the quoted form work;
    - a command without `--witnessed` gives null;
    - the existing `rewriteRaw` rows still pass.
  - **C8 `bashMarkerRewrite`.** The three CRITERIA forms each return `phases: [41]`, with only
    the marker text replaced by `AGENT_MARKER` and every other byte identical:
    - the `printf … > .astrocode/phases/41-x/CONTEXT.md` form;
    - the `sed -i '1s/.*/<!-- astro-discuss: captured -->/' …` form;
    - the heredoc `cat > … <<'EOF'` form.

    It returns null when there is no marker, when the path is not a phase CONTEXT.md, and when
    the text already holds the agent marker.
  - **C4:**
    - `rewriteGate` on `ac phase accept 41 --evidence "https://board.example/d/42?x=1&y=2"`
      with `add: '--witnessed composer'` inserts right after `41` and leaves the evidence bytes
      identical;
    - with `strip: ['--witnessed','--agent']` and `add: '--agent claude'`, the evidence also
      survives;
    - an evidence value `"see phase accept 12"` still gives `findGates` `one`, with ref `41`.
- **Implement D9** in `gates.js`. `rewriteRaw` uses `dropWitnessed`. Update the module header's
  "Known gaps" paragraph and the `onlyQuotedMention` and `signSegments` docs, explaining why each
  hole was closed and naming the debt id.
- **Commit:** `fix(witness): variable gate verbs, quoted mentions behind an ac head, Bash marker writes and --witnessed dropping in gates.js (phase 46 t4)`.

### t5 — The shared machine-typed check: `hooks/lib/machine.js` and the prefixes in `switches.js`
- **id:** t5
- **file:** `mods/astro-mods/hooks/lib/machine.js` (new), `mods/astro-mods/hooks/lib/switches.js`, `tests/mods_machine.test.mjs` (new)
- **depends_on:** []
- **Test first**, in `tests/mods_machine.test.mjs`, with `await import` of both modules:
  - **`isMachineTyped`, prefix list `["[relay] ", "/astro-accept", ".*"]`:**
    - true: `[relay] /astro-accept 41`;
    - true: `   [relay] ! ac phase accept 41`;
    - true: `/astro-accept 41`;
    - false: `[RELAY] x` (case);
    - false: `hi [relay] x` (not at the start);
    - false: `hello` with list `[".*"]` (not a regex);
    - false: a non-string;
    - false: an empty list.
  - **`commandText`:** `('astro-accept','41')` gives `'/astro-accept 41'`, and
    `('/astro-accept','')` gives `'/astro-accept'`.
  - **`setSwitches`:**
    - with `{switches:{witness:true}, warnings:[], machinePrefixes:['[relay] ']}`: `getPrefixes()`
      gives `['[relay] ']` and `isOn('witness')` is true;
    - with `machinePrefixes` absent, `'x'`, `[1]` or `['ok', 2]`: `getPrefixes()` is `[]`, it
      does not throw, and witness is still on;
    - `resetSwitches()` empties the prefixes;
    - a failing `setSwitches` (exit 1) leaves the prefixes empty.
- **Implement D7:**
  - `machine.js` is pure, with a header saying why it is shared (one rule for witness and
    live-capture, ADR-081) and why it is plain `startsWith` (333f).
  - `switches.js` gains the `prefixes` state, `getPrefixes`, and the reset. Its header comment
    gains the prefixes line.
- **Commit:** `feat(mods): one shared machine-typed prefix check, fed by ac at session start (phase 46 t5)`.

### t6 — Witness: machine-typed turns, the cold `--witnessed`, variable verbs and Bash marker writes, wired
- **id:** t6
- **file:** `mods/astro-mods/hooks/features/witness.js`, `tests/mods_plugin.test.mjs`
- **depends_on:** [t4, t5]
- **Test first**, in `tests/mods_plugin.test.mjs`, through `boot()`. Extend `armed()` with an
  optional `machinePrefixes` placed in the switches payload. Cover:
  - **C5, prefixes `["[relay] ", "/astro-accept", ".*"]`:**
    - (a) a composer `[relay] /astro-accept 41`, and also `   [relay] ! ac phase accept 41`,
      then `ac phase accept 41`: the result carries ` --agent claude` and never `--witnessed`;
    - (b) a typed `run('astro-accept','41')` plus its composer submit matches `/astro-accept`,
      and the call gets `--agent`;
    - (b) a prefix-matched typed `/astro-discuss 41` (prefix `/astro-discuss`) followed by a
      human-marker Write gives the agent marker;
    - (c) controls:
      - with `["[relay] "]` only, a typed `/astro-accept 41` still gets `--witnessed composer`;
      - `[RELAY] …` is not a match;
      - a prompt containing `[relay] ` after other text is not a match;
      - with `[".*"]`, a typed accept stays witnessed.
  - **C6:**
    - `machinePrefixes` absent, `'x'`, or `[1]`: a typed accept is still witnessed, and an
      sdk-turn accept gets `--agent`;
    - no hook rejects, every switch stays as answered, and no toast is about the list.
  - **C4:**
    - after a typed `/astro-accept 41`, `ac phase accept 41 --evidence "https://board.example/d/42?x=1&y=2"`
      gets `--witnessed composer`, with the evidence byte-identical;
    - in an sdk turn and in a composer `hi` turn, it gets `--agent claude` and never
      `--witnessed`;
    - the same holds for `ac fix accept 2026-10-01-foo --evidence "DEC-1"` after
      `/astro-fix-accept 2026-10-01-foo`.
  - **C9:**
    - `session.start` with no prompt, then each of `ac phase accept 41 --witnessed composer`,
      `ac phase reject 41 --witnessed composer --reason x` and
      `ac fix accept 2026-10-01-foo --witnessed composer` reaches the engine without
      `--witnessed`, and is not denied;
    - the same after a typed accept followed by a second `session.start`;
    - one `undetermined` toast across them.
  - **C10:** in an sdk turn, a composer `hi` turn, and a typed `/astro-accept 40` turn, the four
    CRITERIA variable-verb commands each reach the engine with ` --agent claude` on the `ac`
    segment.
  - **C11:**
    - the exact ADR command and the `git commit -m` one are byte-identical in an sdk turn and in a
      composer `hi` turn;
    - `echo "say \"hi\"" && ac phase accept 41` in an sdk turn gets `--agent claude` after `41`,
      with the echo string unchanged.
  - **C8:**
    - in an sdk turn, a composer `/astro-autonomous` turn, and a typed `/astro-discuss 40` turn,
      the three Bash forms reach the engine with the agent marker and a `marker` toast;
    - after a typed `/astro-discuss 41`, the `printf` form is byte-identical;
    - with no turn, it is byte-identical with `undetermined`.
  - **Regression:** every existing witness row still passes.
- **Implement D8** in `witness.js`:
  - import `isMachineTyped` and `commandText` from `../lib/machine.js`, and `getPrefixes` from
    `../lib/switches.js`;
  - every hook still opens with `if (!isOn('witness')) return next(e)`, and computes its rewrite
    before `return next(...)`;
  - update the header: what a machine-typed turn is (ADR-081), and why a cold `--witnessed` is
    dropped but no `--agent` is added (ADR-071 e);
  - update `NOTICE.undetermined`.
- **Commit:** `feat(witness): machine-typed prompts sign as agent; drop a cold --witnessed, sign variable verbs and Bash marker writes (phase 46 t6)`.

### t7 — live-capture skips machine-typed prompts
- **id:** t7
- **file:** `mods/astro-mods/hooks/features/live-capture.js`, `tests/mods_live_capture.test.mjs`
- **depends_on:** [t5]
- **Test first**, in `tests/mods_live_capture.test.mjs`, using the existing harness with
  `$.model.complete` and `$.process.run` recorded:
  - with live-capture on and prefixes `["[relay] "]`, a composer `prompt.submit` of
    `[relay] always run the full suite before pushing`, and the same with leading spaces, cause
    no `model.complete` and no `ac principles` argv once `liveSettled()` resolves;
  - the prompt passes through unchanged and is not delayed;
  - control: the unprefixed text in a fresh session reaches the judge;
  - a payload with no `machinePrefixes` keeps today's behaviour.
- **Implement:**
  - `qualifies(e)` adds `!isMachineTyped(e.text, getPrefixes())` beside the existing structural
    filters;
  - a one-line header note: machine-typed prompts are the tool's, never the owner's rules
    (ADR-081; f8d0's "only what the human typed").
- **Commit:** `feat(live-capture): a prompt starting with a machine-typed prefix is never captured (phase 46 t7)`.

### t8 — Docs, debt closure and the full-suite gate
- **id:** t8
- **file:** `MANUAL.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, `commands/astro-accept.md`, `commands/astro-fix-accept.md`, `.astrocode/debt.json` (through `ac debt drop` only)
- **depends_on:** [t2, t6, t7]
- **MANUAL.md:**
  - **The mods switches paragraph** states the key ONCE:
    - `mods.machinePrefixes: ["…"]`;
    - per user;
    - a plain, case-sensitive prefix on the trimmed prompt, no regex;
    - honoured by witness and live-capture;
    - read at session start, so run `/reload-plugins`;
    - a malformed list means no prefixes and one `⚠` in `ac mods status`.
  - **The witness section** references that paragraph and adds:
    - `--evidence`, stored as `cited_evidence`, never a signer;
    - the cold `--witnessed` drop;
    - variable verbs and Bash marker writes are now witnessed;
    - an updated known-gaps list.
  - **The live-capture section** references that paragraph.
  - **The `ac` reference block** gains `--evidence` and `fix list --all`.
- **ARCHITECTURE.md:** the witness line names `hooks/lib/machine.js` and the prefixes in the
  `--switches-only` payload.
- **CHANGELOG.md `## Unreleased`:** one bullet each for:
  - `--evidence`;
  - the machine-typed prefixes;
  - the closed witness holes;
  - the ambiguous fix message.

  Each bullet cites ADR-081 and #132.
- **`commands/astro-accept.md` and `commands/astro-fix-accept.md`,** in the "Who is signing"
  sections:
  - pass `--evidence "<id or URL>"` only when the user relayed a decision made elsewhere, using
    the id they gave verbatim;
  - it never replaces `--agent` and never makes the record human (ADR-081, 1a0d).

  No reporting-slot bound changes.
- **Debt:** run `ac debt drop <id> --reason "closed by phase 46 <task>"` for each of the four
  folded items:
  - `2026-10-12-witness-a-bash-write-of-the-human` (t4, t6);
  - `2026-10-12-witness-a-self-supplied-witnessed` (t4, t6);
  - `2026-10-12-witness-assigning-the-gate-verb-to-a` (t4, t6);
  - `2026-10-12-ac-fix-accept-on-an-ambiguous-slug-says` (t1, t2).

  Use the `ac` CLI, never a hand edit.
- **Gate:** `npm test`, the full suite: `node scripts/test.mjs`. It must be green, including
  `tests/commands.test.mjs`, `tests/contracts.test.mjs`, `tests/witness.test.mjs` (with the
  marker drift test) and every `tests/mods_*.test.mjs`. Fix only doc-induced failures here; a
  behaviour failure goes back to its task.
- **Commit:** `docs(phase 46): --evidence, machine-typed prefixes and closed witness holes in MANUAL, ARCHITECTURE, CHANGELOG and the accept commands; folded debt closed (phase 46 t8)`.

## Waves (derived from depends_on)

| wave | tasks | files are disjoint because |
|---|---|---|
| 1 | t1, t3, t4, t5 | t1 is lib/util+fixes+roadmap; t3 is lib/mods + bin/ac.mjs; t4 is gates.js; t5 is machine.js + switches.js. Each has its own test file. |
| 2 | t2 (after t1, t3), t6 (after t4, t5), t7 (after t5) | t2 is bin/ac.mjs (serialized after t3); t6 is witness.js; t7 is live-capture.js |
| 3 | t8 | docs and debt only |

Wave-green check (ADR-020):
- No task deletes or renames an exported symbol. `findFix` keeps its signature, and
  `rewriteRaw` keeps its behaviour while delegating to `dropWitnessed`.
- t3's extra payload key is ignored by the plugin until t5.
- t4's `readGate` change makes a variable-verb call `ambiguous`, which is left as declared with
  one notice. That is a safe intermediate state, and t6 adds the signing.
- Every boundary compiles and is test-green on its own.

## Criteria coverage

| criterion | tasks |
|---|---|
| C1 | t1, t2 |
| C2 | t1, t2 (`fix list --all`, `fix show`, success lines; declared, so the mod state does not matter) |
| C3 | t1 (`checkCitation`), t2 (before any write, one line) |
| C4 | t4, t6 |
| C5 | t3, t5, t6 |
| C6 | t3, t5, t6 |
| C7 | t5, t7 |
| C8 | t4, t6 |
| C9 | t4, t6 |
| C10 | t4, t6 |
| C11 | t4, t6 |
| C12 | t1, t2 |
