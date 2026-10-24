# Plan: phase 53, registry-claimed ADR numbers for a project's own ADR store

This plan follows `.astrocode/CONVENTIONS.md`:
- Node ≥22 ESM `.mjs`, zero dependencies, `node:` builtins plus the git CLI (never `gh`).
- Named function exports only. `die()` for fatal CLI errors. `✓ • ⚠ ⊡` glyphs and `json()`.
- A `node:test` test for every `lib/` change, run against a real filesystem and real git.
- New shared-state behaviour extends `tests/registry.test.mjs`.
- Comments carry the load-bearing "why" voice. Reporting slots state a bound (§Voice).

It follows `DECISIONS.in-force.md`. The decisions that matter here are ADR-002/043 (every claim goes through `transact`, with no silent local fallback), ADR-018 (dynamic import in RED tests), ADR-020 (every wave compiles), ADR-029 (per-verb flag allowlist), ADR-039/053 (refuse-first, content-identified decisions), ADR-042, ADR-071/072/076 (canon-guard fails open, the switch is the registration, and the deny is two plain lines) and ADR-087 (this phase's own decision). It also follows CONTEXT.md D1 to D7, and aims at every criterion C1 to C9 in CRITERIA.md.

Principles applied (`ac principles brief --stage plan`):
- **1f10:** detect the ADR folder and width from the project's files, allow a config override, and report which was used.
- **9173:** state each rule once.
  - One `lib/adr.mjs` owns parsing, detection, the allocator and consistency.
  - One `ENTRY_ID` heading pattern lives in `lib/decisions.mjs`.
  - The claim rule is written once, in `templates/AGENTS.md`. Everywhere else carries a one-line pointer that names the command.
- **ce7b:** the guard enforces. Prompt text only instructs.
- **4823:** doctor and canon check only report. They never migrate.
- **333f:** relabel detection is exact title equality plus digit width, with no similarity score.
- **1a0d:** backfill is a dry run by default. `--apply` is the human act.
- **5116:** nothing prompts. Every refusal is a deny or a report.
- **2310:** `/astro-decision` gains the renumber and backfill forms.

## Decisions this plan pins (CONTEXT "Open / for the planner", plus gaps)

**P1. The claim is the shared DECISIONS.md CAS plus one sibling file on the orphan branch: `adr-claims.json`. There is no `adr` type in `registry.json`.**
- **Why not `registry.json`:** an `adr` type there would need changes in `computeMatches`, `milestoneClaims`, `claimDrift` and `markComplete` (ADR-020 blast radius). It would also give the series a second counter that could drift from the first.
- **How a claim works:** in an ADR-active project, `addDecision`'s existing `transact` callback computes the next number as max(numbers in `adr-claims.json`, every `ADR-`/`D-` heading number in the merged DECISIONS.md text, every `NNNN-*.md` number in the working-tree ADR folder) + 1. The callback writes `{ 'DECISIONS.md': …, 'adr-claims.json': … }` in ONE commit.
- **Why concurrency is safe:** the non-force push is the mutual exclusion, and the retry re-reads (C1). D4 asks for the next number to sit above every existing number in both stores, so D-series numbers count toward the floor.
- **Shape of `adr-claims.json`:**
  ```json
  { "version": 1,
    "claims": [{ "number": 11, "title": "…", "owner": "<git email>", "branch": "<branch>",
                 "claimed_at": "<ISO>", "source": "add|backfill|renumber", "from": 42 }],
    "backfill": null | { "at": "<ISO>", "owner": "…", "log_width": 3, "folder_width": 4,
                         "relabel": { "ADR-001": "D-001", "ADR-003": "ADR-0003" } } }
  ```
  `from` is present only on renumber claims.
- **When it is written:** only in ADR-active projects. A project without an ADR folder never writes it, so C9 holds: astro-code's own registry is untouched.

**P2. The ADR file is written to the working tree, never to the orphan branch, and only AFTER the CAS push succeeds.**
- **Why after:** a lost race must never leave an orphan file under a number someone else now owns.
- **Name:** `<adr_dir>/<NNNN>-<slug>.md`. The slug is `lib/roadmap.mjs` `slugify`, capped at 60 characters, with `decision` when it comes out empty.
- **Body:** `# ADR-<NNNN> — <title>`, then the same date/commit line, `**Why:**` and `**Rejected:**` as the DECISIONS.md entry. The DECISIONS.md heading is `## ADR-<NNNN> — <title>`, at the folder's width.
- **A retried add finds a live twin (#77):** if the twin's number is at folder width and no file has that number, the add writes the missing file. Otherwise it writes nothing.
- **Never overwritten:** the writer never overwrites an existing `NNNN-*.md`.

**P3. Local claims mirror: `.astrocode/.local/adr-claims.json`.** `.local/` is gitignored by its own `.gitignore` `*`, which is created if absent.
- **Contents:** the shared object plus `adr_dir`, `width` and `source` from detection.
- **Who writes it:** `decision add`, `decision backfill --apply`, `decision renumber` and `canon pull`, in ADR-active projects only.
- **Who reads it:** canon-guard, plus canon check and doctor when the registry is unavailable. Doctor and canon check never write it (C4: they write nothing).

**P4. Detection (D6, principle 1f10). `detectAdrDir(root)` returns `{ active, dir, abs, source, width, candidates }`.**
- **Config is read first.** `loadConfig(root).decisions?.adr_dir`:
  - `false`, `""` or `"off"` (case-insensitive) → `source: 'off'`, inactive.
  - Any other string → `source: 'configured'`, active. The folder may not exist yet; the first add creates it.
- **Otherwise the candidates are probed in order:** `docs/adr`, `adr`, `doc/adr`. A candidate counts only if it holds at least one file matching `^\d{3,4}-.+\.md$`.
  - Exactly one hit → `source: 'detected'`.
  - More than one → `source: 'ambiguous'` with `candidates`. `decision add` refuses with `ac config set decisions.adr_dir <dir>` before it writes anything. Doctor reports it.
  - None → `source: 'none'`, inactive. Today's DECISIONS.md-only path runs, byte-identical (C2d, C9).
- **Width:** the digit count of the highest-numbered file. An empty configured folder takes the width of a detected candidate if there is one, else 4.
- **No extra config validation is needed.** `ac config set decisions.adr_dir off` already works through the dotted-key setter.

**P5. C7: in an ADR-active project, a configured registry remote that fails (`transact` returns `!ok`, unreachable or unreadable) REFUSES the add.**
- It returns `{ ok: false, refused: 'registry-unreachable', error }` and writes no DECISIONS.md entry, no ADR file and no mirror.
- **No remote configured at all:** the project has no registry, so this is a mode, not a fallback. Allocation is local, under `withLock`, floored on both local stores plus the mirror (ADR-043), and is reported `[local]`.
- **Non-ADR projects keep today's code path unchanged** (C9: "today's behaviour").
  - **FLAGGED for the human at plan review:** that path's existing "fall through to local on contention/error" sits uneasily with CONVENTIONS' "never reintroduce a silent local-only fallback". It predates this phase and is not widened here. Suggest a debt item.

**P6. The canon-guard ADR rule is new code in the existing hook, judged before the PROTECTED match, and it fails open.**
- **When it applies:** only when the target's project is ADR-active.
  - **Finding the project root:** for an ADR-folder file, walk up from the target's directory to the FIRST ancestor that contains a `.astrocode/` dir. For DECISIONS.md, the parent is `.astrocode`.
  - **ADR-active means:** the mirror exists, OR `config.json` `decisions.adr_dir` is a non-off string, OR exactly one candidate folder holds `NNNN-*.md` files.
  - **Why reading config does not break ADR-072:** `decisions.adr_dir` is project data naming a folder, not the guard's switch. The header comment is updated to say this.
- **Claimed set:** mirror claim numbers ∪ `## ADR-(\d+)` heading numbers in the local `.astrocode/DECISIONS.md`.
- **Deny cases:**
  - (a) A Write/Edit/MultiEdit, or a Bash target from `bashTargets`, that CREATES a not-yet-existing file in the active ADR folder whose name matches `^\d{3,4}-` and whose number is not in the claimed set.
  - (b) A Write/Edit/MultiEdit of `.astrocode/DECISIONS.md` that ADDS an `## ADR-<n>` heading (present in the new text, absent from the old text) whose number is not claimed. For Write the old text is the current file; for Edit it is `old_string`; for MultiEdit it is each edit's `old_string`.
- **Allowed cases:**
  - Editing or overwriting any EXISTING file. Grandfathered unclaimed ADRs stay editable, and doctor reports them.
  - Non-numbered files such as `README.md` or `template.md`.
  - Bash content: only paths are judged, which is the guard's existing scope.
  - Every non-ADR project.
- **Deny reason: two plain lines (ADR-076).**
  - Line 1: `canon-guard: <display> uses ADR number <NNNN>, which is not claimed (ADR-087). Use: ac decision add "<title>" (or ac decision renumber <file> next)`.
  - Line 2: `If a teammate just claimed it, run \`ac canon pull\`; otherwise run \`ac mods disable canon-guard\` first.`
- **Fails open:** any internal error allows the call.
- **No `child_process` in this rule.**
- **Detection candidates and off-values are mirrored from `lib/adr.mjs`**, and a parity test guards the copy, as the hook already does for `principlesDir`.
- **ADR-071 clash noted:** the guard is optional and off by default, so doctor and canon check are the authoritative layer and the guard is the early warning.

**P7. Consistency findings: `adrConsistency(…)` in `lib/adr.mjs` returns `[{ kind, subject, detail, fix }]`.** It is pure and is the one function doctor and canon check share.

| kind | when | fix |
|---|---|---|
| `not-backfilled` | ADR-active, but no `adr-claims.json` exists (registry and mirror both lack it) | `ac decision backfill --apply` (ONE row, not one per file: noise, R9) |
| `unclaimed` | a file, or a folder-width `ADR-` heading, whose number is not claimed | `ac decision renumber <rel-or-id> next` |
| `duplicate` | two or more different files share a number | `ac decision renumber <later file> next`, with the detail naming BOTH files. The later file is second in lexical order; there is one row per extra file. |
| `old-series` | after backfill, a `## ADR-<digits>` heading whose digit width equals `backfill.log_width` and differs from `folder_width` | `ac decision renumber ADR-<digits> next` |
| `mismatch` | a file numbered N where a DECISIONS.md `ADR-` entry with numeric value N has a different normalized title | `ac decision renumber <rel> next` |
| `ambiguous-dir` | detection is ambiguous | `ac config set decisions.adr_dir <first candidate>` |

- Numbers compare NUMERICALLY, so `ADR-103` and `ADR-0103` are the same number (R3).
- Titles compare with exact normalized equality: the `decisions.mjs` title normaliser, dash-variant tolerant, never similarity (ADR-053).
- A project that is not ADR-active returns `[]` (C9).

**P8. Backfill and relabel: `ac decision backfill [--apply]`, a dry run by default.** The MANUAL documents running it once and then with `--apply`, as the upgrade step.

*Classification.* Each DECISIONS.md entry is one of:
1. **Mirror:** its normalized title equals an ADR file's title. The file title is its `# ` heading with any `ADR-NNNN —`/`NNNN.` prefix stripped, falling back to the slug. A mirror is relabelled to `ADR-<file number at folder width>`.
2. **Folder-series:** its digit width equals the folder width and differs from the log width. It is kept as it is.
3. **Already `D-`:** kept.
4. **Otherwise:** relabelled `D-<its own digit string>`, so `ADR-001` becomes `D-001`.

The log width is the digit width of the ADR headings that are not at folder width (3 when there are none).

*Reference rewrite.* One pass over `git ls-files -co --exclude-standard`:
- **Skipped files:** binary or NUL-containing files, files over 2 MiB, `.astrocode/.local/**` and `.astrocode/DECISIONS.in-force.md` (it is regenerated). DECISIONS.md is rewritten through the transact path.
- **Matching:** `(?<![\w-])ADR-(\d+)(?!\d)` is rewritten only when the digit string is EXACTLY a relabel-map key AND its width differs from the folder width. So `ADR-002` becomes `D-002` while `ADR-0002` is never touched (C5).
- **When the log width equals the folder width,** references are not rewritten. Each occurrence is listed as `file:line` for a human (333f).
- **ADR file names and numbers are never touched.**

*Claims.* One claim per distinct number across the folder files and the post-relabel `ADR-` headings, with `source: 'backfill'`. The `backfill` marker carries the relabel map.

*Apply.* One `transact`: the shared DECISIONS.md (merged with local, relabelled) plus `adr-claims.json` with its claims and marker. After the CAS succeeds, it writes the local DECISIONS.md through `writeDecisionLog` (which regenerates in-force), the mirror and the rewritten reference files.

*Idempotent.* If a `backfill` marker exists, the run reports `• already backfilled <date>` and changes nothing. The callback checks this, so a concurrent second developer is a no-op too.

*Other cases:*
- **Duplicates and mismatches** are reported with their renumber fix and never resolved (ADR-053).
- **A non-ADR project** prints one line and changes nothing (C9).
- **An unreachable registry** refuses, as in P5.

**P9. A stale teammate copy is relabelled on first contact.** When the shared `adr-claims.json` has a `backfill.relabel` map and the local DECISIONS.md still carries a mapped old heading id, `addDecision` and `canonPull` first apply that map to the local text: headings plus in-entry references, under P8's width rule. Only then do they run `mergeDecisions`. This stops ADR-039's local-only rescue from resurrecting `ADR-001…` entries next to their `D-001…` relabels. `applyRelabel(text, map, { folderWidth })` lives in `lib/adr.mjs`, and backfill and canon share it.

**P10. `ac decision renumber <file|id> <N|next> [--dry-run]` writes by default.** `--dry-run` prints the same report and writes nothing.

*Resolving the target:*
- **A path in the ADR folder:** that file, plus the DECISIONS.md entry whose number is numerically equal and whose normalized title equals the file's title (if any).
- **An `ADR-…` id:** the single file plus entry carrying that number and title. If several files carry the number, it refuses with "ambiguous — name the file" and changes nothing. A DECISIONS-only id moves the heading alone, which is the `old-series` and `unclaimed`-heading fix.

*New number:*
- `next` is allocated as in P1.
- An explicit `N` is refused, with nothing changed, if any claim, any `ADR-`/`D-` heading or any file already uses that number. It is checked before AND inside the callback.
- The claim lands via `transact`, with `source: 'renumber'` and `from: <old>`. If the shared DECISIONS.md holds the moving entry (same id and title), its heading is rewritten in the same commit.

*Local rewrite (after the CAS):*
- **The move itself:** rename the file (same slug, new number at folder width), rewrite its `# ADR-` heading and the local DECISIONS.md entry heading, and regenerate in-force.
- **Exact old-filename references** are rewritten everywhere. They are unambiguous because the slug identifies the decision.
- **Self-references inside the moving decision's own file and entry** are rewritten.
- **Every other `ADR-0*<old>(?!\d)` citation line is classified by D5 attribution (P11):**
  - own branch → rewritten;
  - the other same-numbered decision's branch → left alone and counted;
  - anything else, including uncommitted lines when the decision's branch is merged → left alone and listed as `file:line`.
- **Atomicity:** all new contents are computed in memory first, then written. On any write error the originals are restored. A claim that landed but was never used is a harmless gap.

*Output:* every changed file, one per line; the unattributed lines; one count line for the other side.

**P11. D5 attribution in `lib/git.mjs` (git CLI only).**
- `addingCommit(cwd, rel)` is the oldest commit that added the path.
- `branchSideOf(cwd, commit)`:
  - **Merged:** walk `git rev-list --first-parent --merges HEAD` for the OLDEST merge M where `commit` is an ancestor of `M^2` and not of `M^1`. The result is `{ kind: 'merged', merge: M, commits: Set(rev-list M^1..M^2) }`.
  - **Unmerged feature branch:** otherwise, if HEAD is not the default branch and `commit` is not reachable from the default branch, the result is `{ kind: 'unmerged', commits: Set(rev-list <default>..HEAD) }`. Uncommitted lines count as own here.
  - **Everything else is `{ kind: 'unattributable', reason }`.** That covers squash and fast-forward onto the default branch, a missing merge base, a shallow clone and a git failure. Everything is then listed and nothing is guessed.
- `defaultBranch(cwd)`: `git symbolic-ref --short refs/remotes/origin/HEAD` with the remote prefix stripped, else the first local `main`, `master` or `develop` that exists, else null.
- `blameCommits(cwd, rel)`: `git blame --porcelain -w -M -C -- <rel>` against the working tree. It returns per-line commit SHAs, with 40 zeros for uncommitted lines, or null on failure.

**P12. Test strategy.**
- **Engine tasks are test-first inside the task.** The new test file is written first and imports every NEW symbol via `await import('../lib/<m>.mjs')` inside async test bodies, never statically (ADR-018).
  - Existing test files keep their static imports untouched.
  - New files have no static import of a symbol this phase adds.
- **t5 and t14 are explicitly test-after.** They are cross-cutting suites that `depends_on` the implementation tasks.
- No RED test is left failing at a wave boundary.

**P13. Agent text (C8).**
- **The claim rule is written once,** as a bullet in `templates/AGENTS.md` "Rules that matter" (the seed every project receives): "ADR numbers are claimed, never computed…".
- **One-line pointers that name the command:** `agents/astro-planner.md`, `agents/astro-executor.md` and `commands/astro-decision.md`. These are what planners and executors actually read.
- **`workflows/*.mjs` prompts** contain no decision-recording instruction today. They are left as they are, and the guard test covers them.

## Tasks

### t1: `D-NNN` entry ids parse everywhere `ADR-NNN` does, from one exported pattern
- **id:** t1
- **file:** `lib/decisions.mjs`, `tests/decisions_dseries.test.mjs` (new)
- **depends_on:** none
- **Test first** (dynamic import of the new `ENTRY_ID`). Each of these is a named test:
  - "a D-NNN heading starts its own entry and is not swallowed by the previous one";
  - "parseDecisions keys D-001 and ADR-0003 entries side by side";
  - "normalizeDecision and decisionTitle strip a D- heading id like an ADR- one, so sameDecision converges `## ADR-003 — X` and `## ADR-0003 — X`";
  - "inForceText keeps D- entries and stubs a superseded D- entry";
  - "decisionStatus reads `superseded by D-002` and `duplicate of D-002`";
  - "a log with only ADR-NNN headings parses byte-identically to before".
- **Implement:**
  - Export `ENTRY_ID = '(?:ADR|D)-\\d+'`.
  - Use it in `EOI`, `parseDecisionEntries`, `normalizeDecision`, `decisionTitle`, the `decisionStatus` `by` captures, `inForceText`'s first-heading search, and anything else in the file that hard-codes `##\s+ADR-\d+`.
  - Leave no second copy of the pattern in this file.
- **Done:** the full suite stays green, since astro-code's own log is unchanged.

### t2: `lib/adr.mjs` core: refs, detection, scan, file naming, allocator, claims codec, relabel map
- **id:** t2
- **file:** `lib/adr.mjs` (new), `tests/adr.test.mjs` (new)
- **depends_on:** t1
- **Test first** (dynamic import). Uses an Astrobot-shaped fixture under `mkdtempSync`: `docs/adr/0001…0010` with two different `0007-*.md`, and DECISIONS.md `ADR-001…006` with one entry titled like `0003`. Named tests:
  - "parseAdrRef reads ADR-103 and ADR-0103 as the same number with widths 3 and 4, and never matches ADR-01030";
  - "detectAdrDir reports detected/configured/off/none/ambiguous with the folder and width" (P4);
  - "an empty configured folder takes width 4";
  - "scanAdrFiles returns number, width, rel path and title, and skips README/template";
  - "nextAdrClaim is above every claim, every ADR- and D- heading and every file";
  - "adrFileName slugs, caps at 60 and falls back to `decision`";
  - "claims text round-trips and tolerates a missing or corrupt file as empty with no marker";
  - "applyRelabel rewrites `ADR-002` and leaves `ADR-0002`, the ADR-01020 lookalike and a D- id untouched";
  - "writeClaimsMirror creates `.local/.gitignore` and the mirror".
- **Implement** (pure apart from fs reads, plus mirror writes via `atomicWriteText`):
  - Exports: `ADR_CLAIMS_FILE`, `ADR_DIR_CANDIDATES`, `ADR_OFF_VALUES`, `ADR_FILE_RE`, `parseAdrRef`, `formatAdrId(n, width)`, `detectAdrDir(root)`, `scanAdrFiles(abs)`, `adrFileName(n, width, title)`, `adrFileText(id, fields)`, `nextAdrClaim({ claims, decisionsText, files })`, `parseClaims(text)`, `claimsText(obj)`, `readClaimsMirror(root)`, `writeClaimsMirror(root, claims, detection)`, `applyRelabel(text, map, { folderWidth })`.
  - Headings are parsed only through `ENTRY_ID` and `decisions.mjs` helpers, never a new heading regex (9173).
- **Covers:** C1, C2, C5 (building blocks).

### t3: `adrConsistency`, the one finding producer for doctor and canon check (P7)
- **id:** t3
- **file:** `lib/adr.mjs`, `tests/adr_consistency.test.mjs` (new)
- **depends_on:** t2
- **Test first** (dynamic import). Named tests:
  - "an unclaimed file, a duplicate pair, a post-backfill 3-digit heading and a title-mismatched file each yield exactly one finding of their kind with a concrete fix";
  - "a duplicate names both files";
  - "no claims record yields one not-backfilled finding, not one per file";
  - "a clean backfilled project yields none";
  - "a non-ADR project yields none";
  - "ADR-103 vs file 0103 compare numerically".
- **Implement:** `adrConsistency({ detection, files, decisionsText, claims })` → `[{ kind, subject, detail, fix }]`, with `claims` null meaning not backfilled. Each fix string must be a runnable `ac` command line.
- **Covers:** C4, C9.

### t4: `addDecision` claims in ADR-active projects and writes both stores; canon pull keeps the mirror
- **id:** t4
- **file:** `lib/canon.mjs`, `tests/adr_claim.test.mjs` (new)
- **depends_on:** t1, t2
- **Test first** (dynamic import, real bare remote plus one working copy). Named tests:
  - "an ADR project tops out at 0010: decision add writes DECISIONS `## ADR-0011` and `docs/adr/0011-<slug>.md`, and the registry's adr-claims.json records 11";
  - "a 3-digit `adr/` project gets a 3-digit file and heading, and the result says detected";
  - "decisions.adr_dir pointing elsewhere writes there and says configured";
  - "decisions.adr_dir off writes only the DECISIONS entry";
  - "a project with no ADR folder gets today's entry, no folder, no adr-claims.json on the branch and no mirror" (byte-compare the entry shape against the pre-phase format);
  - "an unreachable remote in an ADR project refuses and writes neither store" (C7);
  - "ambiguous ADR folders refuse with the config fix";
  - "a retried add returns the twin's id and writes a missing file once";
  - "canon pull refreshes the mirror";
  - "a stale copy holding pre-relabel ADR-00x entries is relabelled before merge, not resurrected" (P9).
- **Implement:**
  - The ADR-active branch of `addDecision` per P1, P2, P3 and P5. The non-ADR path stays byte-identical.
  - Return `adr: { file, dir, source, width } | null` beside the existing fields, so both CLI callers stay compatible.
  - `titleOf` and `preambleParagraphs` use `ENTRY_ID`. `nextAdrNumber` stays `ADR-` only for the non-ADR path.
  - Export `writeDecisionLog(root, text)` (wrapping `writeDecisions`) and `mergeDecisions` for t9 and t11.
  - `canonPull` applies P9 and writes the mirror when ADR-active.
- **Covers:** C1 (single-copy), C2, C7.

### t5: Two working copies on separate branches add concurrently and never collide (test-after)
- **id:** t5
- **file:** `tests/registry.test.mjs`
- **depends_on:** t4
- **Explicitly test-after,** extending the contract suite. The setup:
  - a bare remote and `alice`/`bob` clones, each on its own feature branch off a default branch carrying `docs/adr/0001…0010`;
  - registry initialised.
- **Spawn both `node bin/ac.mjs decision add …` concurrently** with async `spawn` and await both. Then assert:
  - both exit 0;
  - each copy has exactly one new file and one new heading with the same 4-digit number;
  - the numbers differ and are both above 0010;
  - the registry's `adr-claims.json` lists both;
  - merging both branches into the default branch leaves no number with two decisions in either store.
- **No production code.**
- **Covers:** C1, C9 (the bare-remote test).

### t6: canon-guard refuses unclaimed ADR files and headings at write time (P6)
- **id:** t6
- **file:** `hooks/astro-canon-guard.mjs`, `tests/canon_guard_adr.test.mjs` (new)
- **depends_on:** t2
- **Test first:** spawn the hook with PreToolUse JSON on stdin and cwd set to an ADR fixture, the way `tests/canon_guard.test.mjs` does. The parity test does `await import('../lib/adr.mjs')`. Named tests:
  - "a Write creating docs/adr/0150-x.md is denied and the reason names ac decision add";
  - "an Edit adding `## ADR-0150 — …` to DECISIONS.md is denied";
  - "`cat > docs/adr/0150-x.md` is denied";
  - "a hand mv to an unclaimed number is denied";
  - "editing the body or title of an existing claimed ADR is allowed";
  - "a Write of a just-claimed number is allowed";
  - "README.md in the ADR folder is allowed";
  - "a non-ADR project's DECISIONS.md heading edit is allowed";
  - "a corrupt mirror fails open";
  - "the deny is exactly two lines";
  - "the hook's candidates and off-values equal lib/adr.mjs's".
- **Implement:** the rule, judged before the PROTECTED match, plus the header comment update.
- **Must not break:** `tests/canon_guard.test.mjs`, `guard_hooks.test.mjs` and `guards_spec.test.mjs` must stay green unedited.
- **Covers:** C3.

### t7: `canonCheck` returns ADR findings, including when no registry is in use
- **id:** t7
- **file:** `lib/canon.mjs`, `tests/canon_check_adr.test.mjs` (new)
- **depends_on:** t3, t4
- **Test first** (dynamic import of the new `adr` field behaviour). Named tests:
  - "canonCheck lists the four seeded problems from the registry claims";
  - "with no registry it falls back to the mirror, and reports not-backfilled when there is neither";
  - "a clean ADR project and a non-ADR project report `adr: []`";
  - "canonCheck changes neither the working tree nor the registry tip" (`git status --porcelain` and `ls-remote` before and after).
- **Implement:** compute `adr: adrConsistency(…)` in every return branch, including unavailable and unreachable. Claims come from the snapshot's `adr-claims.json`, else the mirror, else null. Add `adrOk`. Existing `ok`/`drift` semantics are unchanged.
- **Covers:** C4, C9.

### t8: `ac doctor` reports ADR consistency, one row per finding with its fix
- **id:** t8
- **file:** `lib/doctor.mjs`, `tests/doctor_adr.test.mjs` (new), `tests/doctor.test.mjs` (fix-up only if an id-order assertion needs `'adr'`)
- **depends_on:** t7
- **Test first.** Named tests:
  - "each seeded ADR problem is its own failing `adr` row ending in its fix";
  - "a clean ADR project has one ok `adr` row";
  - "outside a project, a non-ADR project and an unreachable registry are skipped, not failed";
  - "`--json` failing rows all carry fix".
- **Implement:**
  - Add `'adr'` to `DOCTOR_CHECKS` right after `'registry'`.
  - `checkRegistry` stores its root and `canonCheck` result on `ctx`. `checkAdr` reuses them: no second fetch, and it skips when `ctx` has no root. That keeps "a check that throws becomes one failing row" at exactly one row.
  - Doctor stays read-only.
- **Covers:** C4.

### t9: `lib/adrbackfill.mjs`, the one-time claim plus D-series relabel (P8, P9)
- **id:** t9
- **file:** `lib/adrbackfill.mjs` (new), `tests/adr_backfill.test.mjs` (new)
- **depends_on:** t3, t4
- **Test first** (dynamic import, bare remote plus two clones, using the C5 fixture). Named tests:
  - "dry run reports the relabel map, the reference rewrites, the claims and the duplicate 0007, and writes nothing";
  - "apply relabels log entries to D-001…, keeps the 0003 mirror as ADR-0003, rewrites `ADR-002`→`D-002` and leaves `ADR-0002` and every ADR file name alone";
  - "the duplicate 0007 is reported with `ac decision renumber … next`";
  - "after apply, the next decision add from either clone gets 0011";
  - "a second apply changes no file and claims nothing" (byte-compare the tree and the registry tip);
  - "equal log and folder widths list references instead of rewriting them";
  - "a project without an ADR folder is untouched, byte-identical DECISIONS.md" (a copy of a plain `ADR-NNN` log);
  - "an unreachable registry refuses with nothing written".
- **Implement:** `backfillAdr(root, { apply = false })` → `{ active, already, relabel, rewrites, ambiguous, claims, findings, files }`. It uses `writeDecisionLog`, `mergeDecisions`, `applyRelabel` and `adrConsistency`. It does not edit `lib/adr.mjs` or `lib/canon.mjs`; any helper it needs stays local to this module.
- **Covers:** C5, C9.

### t10: git attribution helpers for renumber (P11)
- **id:** t10
- **file:** `lib/git.mjs`, `tests/git_attribution.test.mjs` (new)
- **depends_on:** none
- **Test first** (dynamic import, real repos). Named tests:
  - "a commit merged via a merge commit maps to that merge's second-parent side";
  - "a commit on an unmerged feature branch maps to default..HEAD";
  - "a squash-merged change is unattributable";
  - "a post-merge commit on default is not on either side";
  - "blameCommits marks uncommitted lines with the zero SHA and returns null for an untracked path";
  - "defaultBranch reads origin/HEAD, then main/master/develop, else null".
- **Implement:** `defaultBranch`, `addingCommit`, `branchSideOf`, `blameCommits`, all through the existing `git()` helper.

### t11: `lib/adrrenumber.mjs`, move one decision and rewrite only its own branch's references (P10)
- **id:** t11
- **file:** `lib/adrrenumber.mjs` (new), `tests/adr_renumber.test.mjs` (new)
- **depends_on:** t3, t4, t10
- **Test first** (dynamic import, using C6's fixture):
  - a bare remote and two clones;
  - alice's and bob's branches each add a different `0042` file plus citing lines;
  - both merged into the default branch;
  - one later `ADR-0042` citation committed on default.

  Named tests:
  - "renumbering bob's file moves the file, its heading and its DECISIONS entry to one new claimed number";
  - "every citation bob's branch added names the new number, and alice's still read 0042";
  - "the post-merge citation is untouched and listed";
  - "every changed file is listed";
  - "the other clone's next add skips the new number";
  - "an explicit number already used or claimed is refused with nothing changed";
  - "an id carried by two files is refused as ambiguous";
  - "renumber ADR-045 next moves a DECISIONS-only heading";
  - "on an unmerged feature branch its own uncommitted citation lines are rewritten";
  - "a squash-merged decision rewrites only its own file and entry and lists every other citation";
  - "--dry-run writes nothing";
  - "only the named decision changes".
- **Implement:** `renumberDecision(root, target, to, { dryRun = false })` → `{ ok, from, to, changed[], unattributed[], otherSide, refused? }`. It does not edit `lib/adr.mjs`, `lib/canon.mjs` or `lib/git.mjs`.
- **Covers:** C6.

### t12: CLI: decision add reporting, `decision backfill`, `decision renumber`, ADR rows in `canon check`, D- ids
- **id:** t12
- **file:** `bin/ac.mjs`, `tests/adr_cli.test.mjs` (new)
- **depends_on:** t4, t7, t9, t11
- **Test first** (spawn `bin/ac.mjs`). Named tests:
  - "decision add in an ADR project prints the id line, then `✓ wrote <rel> (ADR folder <dir>, detected|configured)`";
  - "a non-ADR add prints exactly today's lines";
  - "an unreachable registry exits non-zero naming the registry";
  - "decision backfill prints the dry-run plan and `--apply` applies it";
  - "decision renumber prints the changed files and the unattributed lines";
  - "canon check prints one `✖ <subject>: <detail> → <fix>` row per ADR finding and exits non-zero, and stays silent on ADR in a clean project";
  - "unknown flags on backfill and renumber die" (ADR-029);
  - "decision supersede accepts a D- id".
- **Implement:**
  - In `decision add`: handle `refused: 'registry-unreachable'` and `adr-ambiguous` with `die`, and print the ADR file line.
  - Make the same refusal handling hold in the `principles promote --as decision` caller.
  - Add the `backfill` and `renumber` subcommands and the `checkFlags` entries `'decision backfill': ['apply']` and `'decision renumber': ['dry-run']`.
  - Change the supersede/retire/amend id check to `^(?:ADR|D)-\d+$`.
  - Render ADR rows in `canon check`. Update the help lines.
- **Reporting bounds:**
  - Add: one extra line.
  - Backfill: one summary line plus one line per finding, reference file and ambiguous site.
  - Renumber: one line per changed file plus one per unattributed site, plus one count line.
  - Silence on ADR when there is nothing to report.
- **Covers:** C2 (reporting), C4, C5, C6, C7.

### t13: Planner and executor instructions route every decision through the claim (P13)
- **id:** t13
- **file:** `templates/AGENTS.md`, `agents/astro-planner.md`, `agents/astro-executor.md`, `commands/astro-decision.md`, `tests/adr_instructions.test.mjs` (new)
- **depends_on:** none
- **Test first.** Named tests:
  - "the AGENTS.md seed states the claim rule once";
  - "astro-planner, astro-executor and astro-decision each point to `ac decision add` for recording a decision";
  - "no file under commands/, agents/, workflows/ or templates/AGENTS.md tells an agent to compute the next ADR number or create an ADR file by hand". This greps for `max *\+ *1`, `highest.*\+ *1`, `next (free )?ADR number` outside a negation, and an instruction to write `NNNN-*.md`.
- **Implement:**
  - The `templates/AGENTS.md` bullet: claim via `ac decision add` (which writes DECISIONS.md and `<adr_dir>/NNNN-<slug>.md`); move with `ac decision renumber`; never compute max+1 or hand-write an ADR file; canon-guard refuses it.
  - One pointer bullet each in the two agents.
  - In `/astro-decision`: steps for `renumber <file|id> <N|next>` and `backfill` (dry run, then `--apply` on the user's word), with argument-hint updated, step 4's report extended to name the ADR file (still one line), and no line from `tests/commands.test.mjs` loosened.
  - Keep `tests/agentsmd.test.mjs` green (no `Milestone N`/`Phase NN` text).
- **Covers:** C8.

### t14: End-to-end Astrobot scenario through the CLI (test-after gate)
- **id:** t14
- **file:** `tests/adr_e2e.test.mjs` (new)
- **depends_on:** t5, t6, t8, t12, t13
- **Explicitly test-after.** It drives only `node bin/ac.mjs` and the hook script, against one scratch fixture following the CRITERIA shared fixture, in this order:
  1. pre-phase ADR project, backfill dry run, then `--apply` (C5);
  2. concurrent adds from both clones (C1);
  3. guard denies 0150 and allows a claimed edit (C3);
  4. seeded problems in canon check and doctor `--json`, with the tree and the registry tip unchanged (C4);
  5. collision, then renumber (C6);
  6. unreachable registry (C7);
  7. a copy of this repo's `.astrocode/` through backfill and canon check, byte-identical (C9).
- **No production code.** If it exposes a defect, the fix belongs to the owning task, re-run.
- **Covers:** C1, C3 to C7, C9.

### t15: MANUAL and CHANGELOG
- **id:** t15
- **file:** `MANUAL.md`, `CHANGELOG.md`
- **depends_on:** t6, t12, t13
- **MANUAL §Canon gains "ADR numbers in a project with an ADR folder".** It covers:
  - detection, `decisions.adr_dir` and its off value, and what `decision add` reports;
  - the claim and the two stores;
  - the canon-guard rule and its escapes;
  - doctor and canon check rows with their fixes;
  - the upgrade step (`ac decision backfill`, then `--apply`), the D-series relabel and its width rule, and that it runs once;
  - `ac decision renumber`, its attribution rule and the listed-not-guessed cases.
- **CHANGELOG** gets an Unreleased entry citing ADR-087.
- No version bump; that is the release's job.
- **Covers:** C8 (MANUAL clause).

## Wave shape
- Wave 1: t1, t10, t13
- Wave 2: t2
- Wave 3: t3, t4, t6
- Wave 4: t5, t7, t9, t11
- Wave 5: t8, t12
- Wave 6: t14, t15

## Same-file ownership check
Every file with more than one owning task is serialized:
- `lib/adr.mjs`: t2, then t3.
- `lib/canon.mjs`: t4, then t7.

Every other file has exactly one owning task, including `bin/ac.mjs` (t12), `tests/registry.test.mjs` (t5) and `tests/doctor.test.mjs` (t8). No task deletes or renames a symbol. t4 keeps `nextAdrNumber`/`buildDecision` for the non-ADR path and only adds exports, so every wave boundary compiles. No task carries `commits: none`.
