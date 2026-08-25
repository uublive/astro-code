# astro-code v0.11.0 — end-to-end benchmark

**Project:** `cgbench` (greenfield, built for this run) · **Date:** 2026-08-25
**Run:** 5 phases, 10 workflows, full `discuss → plan → execute → accept` loop
**Operator:** automated (an agent stood in for the human at every gate)

---

## TL;DR

| | runs | total | mean | baseline (OCP, v0.9.x) |
|---|---|---|---|---|
| plan | 5 | 0.68h | 8.2 min | 12 min |
| exec | 5 | 0.98h | 11.8 min | 49 min |
| exec, passed verify first time | 5 | 0.98h | 11.8 min | 22 min |
| exec, entered remediation | 0 | — | — | 47 min |
| **remediation rate** | | | **0%** | **~50%** |

- Dedup cross-check: **10 deduped runs = 10 workflow dirs on disk** ✓
- Total subagent tokens: **1,696,705**
- Planning was **41%** of workflow time
- `ac stats`: **1.5 h elapsed** vs **1.66 h workflow time** (not interchangeable — see below)
- Final state: **168 tests, 0 failures**, working tree clean, all 5 phases `complete`
- **No verify ever failed.** No heal, no remediation cycle, on any phase.

**Verdict on ADR-031: the number moved exactly as predicted, but this run does not prove the theory.** See "Caveats" — the confound is large.

---

## 1. Preconditions

```
HEAD                   0ebcf72 feat: pipeline planning against execution,
                               size phases larger, rename the fast lane (ADR-032)
package.json           "version": "0.11.0"
~/.astro/code/version  0.11.0          <-- the authoritative one
node --test            tests 439 · pass 439 · fail 0
node                   v26.7.0
```

Two corrections to the brief's assumptions:

1. **`~/Development/astro-code` does not exist in this container.** The repo is at
   `/Users/buu/Development/astro-code` (the bind-mount path). `~/Development` is not a symlink.
2. **The installed tree at `~/.astro/code` is partially stale.** Its `lib/` and `bin/` are
   from Jul 8, missing `effort.mjs` and `tune.mjs`, and its `package.json` still reads
   `0.2.1`. This turned out to be harmless *only* because:
   - `ac` on PATH is a symlink straight to `/Users/buu/Development/astro-code/bin/ac.mjs`, and
   - `commands/`, `agents/` and `workflows/` are **byte-identical** to the 0.11.0 source (I diffed them before trusting the run).

   But `ac path workflows` resolves *into* that stale tree. One missing symlink and this
   benchmark would have silently measured old code. Worth cleaning up.

**Forge MCP tools: absent.** Confirmed with the single mandated probe
(`ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_knowledge_list,mcp__forge__forge_capture_knowledge")`),
a keyword search, and the absence of any `mcpServers` key in `~/.claude/settings.json`.

**Branch:** stayed on `main` for the whole run. `use_worktrees` left at `true`.

---

## 2. Actionable bugs found

### 2.1 `ac canon pull` silently destroys ADRs — and then `ac decision add` reissues the id

**Severity: high. Silent data loss, reports success at every step.**

Phase 5's verifier noticed 24 uncommitted deletions removing `ADR-010` from the
"append-only" `.astrocode/DECISIONS.md`. The full chain:

1. astro-code's **own planner** emitted a task instructing an executor to write an ADR
   directly into `.astrocode/DECISIONS.md` (phase 4, task t3, commit `7b84f97`).
2. `ac canon pull` — which `/astro-execute` **step 3 mandates** — overwrote the file from the
   registry orphan branch, which never had that ADR. It printed
   `✓ pulled DECISIONS.md, CONVENTIONS.md`.
3. `ac canon push` **refuses to publish `DECISIONS.md` by design** (`lib/canon.mjs:98`), so
   there is no tool-supported way to repair it.
4. `ac decision add` numbers from the registry, so it **reissued `ADR-010`**, permanently
   overwriting the original in the working tree. It now survives only in git history.

Root cause: the design assumes `ac decision add` is the only writer of `DECISIONS.md`
(`canonPull` at `lib/canon.mjs:86-88` unconditionally overwrites; `canonPush` never pushes it).
**That invariant is unenforced, and the framework's own planning path violates it.**

Suggested fixes, in preference order:
- Have the planner emit `ac decision add` calls instead of "write to DECISIONS.md" tasks; **or**
- make `canonPull` detect and preserve local-only ADR ids; **or**
- at minimum, have pull refuse to silently drop `## ADR-` headings it is about to delete, and warn.

*(Recovered during this run: the lost decision was re-added through the supported path as
ADR-011. Canon is now consistent at 11 ADRs with no collisions.)*

### 2.2 ADR-032 pipelining can never fire under the documented command order

The gate requires phase N+1 to be **pending, unplanned, and `ac phase context` = `ready`**.
The documented per-phase order — `discuss N → plan N → execute N → accept N` — leaves phase
N+1 **undiscussed** when execute N runs, so the gate returns `missing` and pipelining never
happens.

Compounding it: the gate is **deliberately silent** when unmet. So "correctly gated off",
"the model skipped step 4b", and "the feature is broken" are **indistinguishable** — all three
produce no output whatsoever.

Also worth flagging: **ADR-032 lives in the command prompt** (`commands/astro-execute.md`
step 4b), **not in `workflows/execute-phase.mjs`**. It is a model-followed instruction, not a
mechanical guarantee — nothing enforces it, and nothing logs whether it ran.

Suggested fix: either move the pipeline launch into the workflow script, or have the command
emit one line when the gate is evaluated and not met (`pipeline: phase 3 not discussed, skipping`).

### 2.3 A pre-registered criterion shipped internally self-contradictory

Phase 3's criterion C5 required (b) the BREAKING CHANGES entry text to be the
`breakingDescription` (`drops node 18`) **and** (c) the string `new api` to appear "exactly
twice". Under (b), (c) is unsatisfiable — I reproduced it; the string appears once.

Because `CRITERIA.md` is written plan-blind and never re-checked against reality, nothing
catches such derivation slips. The verifier caught it at verify time, reasoned that failing
would "push the code away from canon D3", and passed with a documented note. I independently
confirmed that reasoning was **sound, not a rationalisation**.

It worked — but it rests entirely on verifier diligence, and the same latitude that let it
excuse a broken criterion could let it excuse a real failure.

### 2.4 `ac decision add` cannot record a title starting with `--`

`ac decision add "--since <ref> is a revision..."` is parsed as a flag and rejected, and `--`
is **not honoured** as an end-of-options separator. It fails loudly (exit 1 — correct), but
there is no escape hatch and no hint in the usage line. Worked around by rewording the title.

### 2.5 Automated acceptance is recorded as a human signature

`ac phase accept` logged **"accepted by matteo@labtroniq.com"** for all five phases. An agent
accepted them, not a human. The framework attributes acceptance to the git identity and has
**no way to record that a gate was machine-signed** — so a fully automated run is
indistinguishable from genuine human UAT in the project record.

Fine for a benchmark; **not fine for production**. Worth an `--automated` / `--by agent` flag
that stamps the record honestly.

---

## 3. Measurement protocol — the extraction script in the brief is broken

**The provided script would have reported a 0% remediation rate no matter what happened.**

Workflow result payloads are stored **JSON-escaped** in the transcript. The bytes on disk are:

```
\"remediationCycles\":0     \"strategy\":\"sequential\"     \"passed\":true
```

The brief's script matches the **plain** form (`/"remediationCycles":(\d+)/`), which never
matches. So `remediationCycles`, `healed`, `strategy` and `passed` silently read
`0 / 0 / null / false` for **every** run — and the headline metric prints `0%` regardless.

Confirmed by grep: **5 occurrences of the escaped form, zero of the plain form.**

The XML-ish wrapper tags (`<duration_ms>`, `<task-id>`, `<subagent_tokens>`) are **not**
escaped — which is why durations and token counts look correct while the verdict fields are
quietly wrong. That mix is what makes this hard to notice.

**Fix:** unescape each notification block before matching:

```js
const unesc = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
```

After the fix, fields populate correctly (`strat=sequential`, `stop=passed`, `passed=true`).

Two further corrections to the protocol:

- **Duplication is 2.10×, not exactly 2×** (21 duration-carrying blocks → 10 deduped runs).
  Dedup by `<task-id>`+duration; never divide the raw count by two.
- **The dir-count cross-check only holds when no workflow is in flight.** A running workflow
  has a directory but no notification yet, which reads as a false dedup failure. My interim
  check tripped exactly this way (6 vs 7) before the final quiescent check matched 10 = 10.

### Why the 0% is real

Given a bug that forces 0%, I re-verified three independent ways:

1. Every recorded `remediationCycles` value in the transcript is `0` (12 occurrences).
2. Every `stoppedReason` is `passed` (11); every `healed` is `[]` (11).
3. Injecting a synthetic `\"remediationCycles\":3` into the corrected parser **does** yield `3`
   — so the extractor would have caught remediation had any occurred.

---

## 4. Did ADR-031 work?

**The number moved exactly as the theory predicted. I do not think this run proves the theory.**

Remediation went ~50% → 0%, and the exec mean (11.8 min) beat even the baseline's *clean-run*
figure of 22 min. That is the predicted direction and more. But the confounds are large:

- cgbench is a **greenfield, zero-dependency, pure-logic library** — the easiest possible case.
  No legacy code to integrate with, no framework, no I/O beyond a single git adapter.
- Every phase was small (4–6 tasks), so **all five ran `strategy: sequential`**. The parallel
  worktree path, the integrator, and the heal ladder were **never exercised at all**. A
  plausible share of the baseline's remediation cost lives in exactly those paths.
- I front-loaded unusually detailed `CONTEXT.md` files (2 rounds per phase, all decisions
  pre-settled), and the criteria authors clearly read them. A thinner discussion would likely
  produce a weaker bar and more remediation.

What this run *does* show is that the **mechanism works as designed**: criteria are
pre-registered plan-blind, the executor sees them, and on an easy project that combination
produces first-time passes.

**To actually validate ADR-031, re-run on a messier existing codebase with phases large enough
to trigger parallel waves.** That is the datapoint still missing.

---

## 5. Did anything game the criteria?

**No.** I audited three phases by probing behaviour **deliberately absent from** `CRITERIA.md`:

| Probe (not in CRITERIA.md) | Expected | Observed |
|---|---|---|
| Indented `BREAKING CHANGE:` — not a footer | not breaking | `false` ✓ |
| Lowercase `breaking change:` | not breaking | `false` ✓ |
| CRLF-terminated subject | trimmed | `"x"` ✓ |
| `--since "v1; rm -rf /"` | verbatim argv element | no shell ✓ |
| Runner throws `ENOENT` | mapped code | `GIT_MISSING` ✓ |
| Unknown git stderr | preserved verbatim | `GIT_FAILED` + text ✓ |
| 0.x pre-major: `0.3.1` + breaking | `0.4.0` | `0.4.0` ✓ |

All generalised correctly — these are real implementations, not fits to the criteria tables.

**The verifiers went well beyond their bar, unprompted:**

- Mutation testing on **every** phase — deliberately breaking source and confirming the suite
  turned red. Phase 4 alone ran **eleven** mutations, all killed.
- Phase 2's verifier ran a **live shell-injection probe** (`--since 'v1.0.0; touch /tmp/PWNED'`)
  and confirmed no file was created.
- Phase 5's verifier flagged **four real non-blocking defects** rather than hiding or inflating
  them.

This is the strongest part of the framework.

---

## 6. ADR-032 pipelining — results

Once the ordering trap (§2.2) was worked around by front-loading all five discussions, it
fired on **all four phases with a successor**, and correctly stood down on phase 5 (no phase 6)
— the negative control.

| Pipelined plan | Ran under | Hidden | Exposed |
|---|---|---|---|
| plan 02 (9.6 min) | exec 01 (9.8 min) | 9.6 min | 0.0 |
| plan 03 (6.7 min) | exec 02 (15.9 min) | 6.7 min | 0.0 |
| plan 04 (5.9 min) | exec 03 (12.4 min) | 5.9 min | 0.0 |
| plan 05 (11.9 min) | exec 04 (9.5 min) | 9.5 min | 2.4 |
| **total planning 41.0 min** | | **31.7 min** | **9.3** |

**77% of all planning time was removed from the critical path.** Only phase 1's plan is
unavoidably serial.

This is also why **workflow time (1.66 h) exceeds elapsed time (1.5 h)** — impossible without
genuine concurrency. Note that elapsed also includes agent thinking and idle gaps, so neither
figure alone is "the" run cost.

---

## 7. Forge knowledge graph — phase-15 UAT **could not be run**

The forge MCP tools are **not connected** in this session, so the connected-mode UAT remains
**never run**. This run does not discharge it.

Degradation behaved exactly to spec:

- `/astro-new-project`'s browse step (`forge_knowledge_list`), `/astro-discuss`'s and
  `/astro-plan`'s scoped `forge_knowledge` reads, and `/astro-decision`'s capture all skipped
  **silently, with no output** — no dead references, no "forge unavailable" noise.
- **No astro-code capture reached the queue.** Still zero — but *untestable here*, not regressed.
  Four ADRs in this run (notably ADR-004, "honour out-of-band signals even in input classified
  as malformed") would have been genuine candidates to lift into project-agnostic generators.

**The grep trap is real:** grepping the transcript for `mcp__forge__` returns **53 hits** — all
of them command frontmatter, agent tool grants, or the template file. Grepping for actual calls
(`"name":"mcp__forge__`) returns **zero**. Anyone checking the loose way would wrongly conclude
the integration fired.

---

## 8. Other observations

**Zero stale-worktree events — but worktrees were never exercised.** All ten workflows chose
`strategy: sequential` (every phase fell under the 8-task `seqBudget`), so no worktree was ever
created and only `refs/heads/main` ever existed. Staying on the default branch was correct
advice, but **this run did not test it**. The two grep hits for
`worktree branches are STALE` are the brief's own text echoed into the transcript.

**Two real defects survived phase 5's criteria** (recorded as ADR-010 rather than silently carried):
- `src/git-adapter.js` uses `execFileSync`, which inherits child stderr, so a failing run prints
  git's `fatal:` line **twice** — violating the canon rule that only `bin/` writes to stderr.
- `src/cli.js` reads git *before* validating `--from-version`, so a non-repo plus a bad version
  exits `1` (runtime) rather than `2` (usage).

Neither breached a criterion, because the criteria injected a *succeeding* reader — so the two
error classes never interacted. A small reminder that pre-registered criteria constrain the
happy path better than they constrain interactions.

---

## 9. What was built

`cgbench` — a conventional-commit changelog generator. Zero runtime **and** zero dev
dependencies, ESM, Node ≥ 22, fully offline and deterministic.

- `src/parse-commit.js` — conventional-commit parser (subject grammar + breaking-change footers)
- `src/git-adapter.js` — the only module touching the process; injectable subprocess runner
- `src/group-commits.js`, `src/render-markdown.js` — pure grouping + deterministic Markdown
- `src/semver-bump.js` — bump policy + version arithmetic (0.x pre-major convention)
- `src/cli.js` + `bin/cgbench.js` — `runCli(argv, deps)` returns a result; only `bin/` exits

**168 tests, 0 failures.** Working tree clean. All 5 phases `complete`.

```
$ node bin/cgbench.js --from-version 0.1.0 --since HEAD~6
## 0.1.1

### Chores
- **astrocode:** phase 4 accepted (c0b42f6)

### Other
- Add bin/cgbench.js shim and wire it via package.json bin field (7aca397)
...
[stderr] suggested bump: patch (0.1.0 -> 0.1.1)
```

---

## 10. Recommended next actions

1. **Fix the `canon pull` / `decision add` data-loss chain (§2.1)** — highest value; it destroys
   work and reports success.
2. **Make ADR-032's gate observable (§2.2)** — one log line, or move it into the workflow script.
   Also fix the documented command order in the docs, or the feature is off by default in practice.
3. **Re-run this benchmark on an existing, messier codebase** with larger phases, to actually
   exercise parallel waves + integrator + heal and give ADR-031 a real test.
4. **Run the forge phase-15 connected-mode UAT** in a session where the MCP server is attached —
   still never run.
5. Add an `--automated` acceptance flag (§2.5) and an end-of-options escape for
   `ac decision add` (§2.4).
6. Clean up the stale `~/.astro/code/lib` + `bin` (§1) so `ac path workflows` cannot ever point
   at old code.

---

*Measured from 10 deduped workflow runs, cross-checked against 10 workflow directories.
Acceptance for all five phases was automated — the two-gate guarantee (REQ-006) is weakened for
this run by design.*
