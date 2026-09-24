# Phase 25 — Retrieval into prompts: success criteria

> Pre-registered, plan-blind. Derived from the phase goal, CONTEXT.md (D1–D7) and canon only.
> The verifier checks these by running the system — never by reading PLAN.md.

**Common fixture used below (a scratch world, never the real `~/.astro`):**
`AC="node /Users/buu/Development/astro-code/bin/ac.mjs"`;
`W=$(mktemp -d)`; `export ASTRO_PRINCIPLES_DIR=$W/store HOME=$W/home`;
a scratch project `$W/proj` (`git init -q`, `$AC init`, a `package.json` with a dependency,
e.g. `{"dependencies":{"express":"^4"}}`). Seed the store with `$AC principles add … `
(accepted directly), plus `--propose` for proposed ones and `principles reject/retire` for
the rest. Every seeded statement carries a unique sentinel word (e.g. `ZEBRA1`, `ZEBRA2`…)
so presence/absence in output is unambiguous. "The shortlist command" means whatever
`ac principles …` retrieval verb `$AC help` documents for per-task shortlists; the verifier
discovers its name/flags from `$AC help`, not from the plan.

### C1 — The per-task shortlist serves only in-scope accepted principles, plus every hard rule
- **Observe:** In the fixture, seed accepted defaults: A scoped `--stack node --work code`,
  B scoped `--stack go`, C scoped `--files 'lib/**'`, D scoped `--work review`, E unscoped
  (if the store treats unscoped as universal); one accepted hard rule R (`--strength rule`)
  scoped `--stack go`; one PROPOSED entry P scoped `--stack node`; one REJECTED and one
  RETIRED entry scoped `--stack node`. From `$W/proj`, run the shortlist command for work
  `code` and files `lib/x.mjs`. Expect A and C present, R present, B and D absent, P and the
  rejected/retired entries absent. Re-run for work `review` with no files: D present, A and C
  absent, R still present.
- **Fails if:** an out-of-scope default appears (scope ignored or matched as "any tag
  overlaps anything"); a file-scoped entry is shown for a non-matching path or missed for a
  matching one; the hard rule is dropped because its scope does not match; or a proposed,
  rejected, retired or superseded entry is served (a machine proposal governing agents before
  a human accepted it — ADR-058).

### C2 — The shortlist is a compact index (one line per default) with full text on demand
- **Observe:** Seed an accepted in-scope default whose `--why` contains a sentinel
  (`WHYDEFAULT`) and whose statement is multi-sentence. Run the shortlist: that entry occupies
  exactly one line which carries its id (or unique id prefix) and its kind/strength, and
  `WHYDEFAULT` does NOT appear. Then run `$AC principles show <that id>`: the full statement
  and `WHYDEFAULT` appear. Seed 150 accepted in-scope defaults and re-run: output is bounded
  (a stated cap / truncation note, not 150+ lines of index), and it says how to see the rest.
- **Fails if:** defaults are dumped in full (why/body text in the index), an index entry spans
  multiple lines or lacks an id that `principles show` accepts, or the index grows without
  bound with store size (no cap, no truncation notice).

### C3 — Hard rules always appear in full and are never truncated
- **Observe:** In the 150-default store from C2, also seed 3 accepted hard rules (one
  in-scope, two out-of-scope by stack/work) each with a `--why` sentinel (`WHYRULE1..3`).
  Run the shortlist: all three hard-rule statements AND all three why sentinels appear,
  regardless of scope and regardless of the index cap truncating defaults.
- **Fails if:** any hard rule is missing, shown only as a one-line index entry without its
  full text, or cut by the size cap.

### C4 — Stack tags are inferred from project manifests, overridable per project, and named in the output
- **Observe:** In `$W/proj` (package.json with express), the shortlist states which stack
  tags it used and they include `node` (lowercased). Create a second scratch project with only
  `go.mod`: a `--stack go` entry is served there and a `--stack node`-only entry is not; the
  reported tags include `go`. Then set the project's explicit stack override through the
  documented `.astrocode/` config mechanism (e.g. to `rust`) in `$W/proj`: the reported tags
  follow the override and a `--stack node`-only entry is no longer served while a
  `--stack rust` entry is.
- **Fails if:** stack is not detected (node/go entries served or hidden regardless of
  manifest), tags are not reported in the output, tag case mismatches stored tags so nothing
  matches, or the explicit override is ignored.

### C5 — `ac principles ask "<question>"` ranks by keyword and explains every match
- **Observe:** Seed accepted entries: X "Always wrap filesystem mutations in a lock" (why
  mentions concurrency), Y "Prefer named exports over default exports", Z unrelated
  ("Use metric units in reports"). Run `$AC principles ask "how should I guard concurrent
  filesystem writes"`: X is ranked first, each listed result states why it matched (the
  matched terms and/or scope hits), and Z is not listed (or ranked below X with an
  explanation showing only weak/no overlap). `$AC principles ask "quantum chromodynamics"`
  exits 0 and reports no matches rather than returning arbitrary entries. Runs with no
  network (e.g. unset proxy / offline) and completes promptly.
- **Fails if:** ranking ignores the question (store order), a result carries no reason, a
  question with zero overlapping terms still returns "matches", proposed/rejected entries are
  returned as if governing, or the command needs a network/embedding service.

### C6 — Serving and citing are both logged, and unused / ignored principles are surfaced
- **Observe:** Seed accepted in-scope defaults U1, U2 and an out-of-scope default U3. Run the
  shortlist twice (so U1 and U2 are served twice; U3 never). Record a citation of U1 through
  the documented citation path (the `ac` verb or mechanism `$AC help`/the command docs name for
  agents' cited ids). Then view the review surface (`$AC principles list` with the documented
  flag/section, or the phase-24 review command if that is where it lives): U2 is reported as
  served-but-never-cited, U3 as never-served, and U1 in neither bucket. The usage record holds,
  per serve event, who/stage/project/time (inspect the log file or its `--json` view).
- **Fails if:** serving is not logged (U2/U3 indistinguishable), citations do not reach the
  same log (U1 still reported as ignored), the review surface does not exist or lists the
  wrong buckets, or serve events lack stage/project/time.

### C7 — Canon clashes are flagged as candidates naming the canon item, and never auto-resolved
- **Observe:** In `$W/proj`, put a convention in `.astrocode/CONVENTIONS.md` and an in-force
  ADR via `$AC decision add` (or directly in the scratch project's canon) that both say, e.g.,
  "named function exports only, no default exports". Seed an accepted principle that
  conflicts/overlaps ("Use default exports for modules"), and an unrelated one. The shortlist
  marks the overlapping one with a `canon may override`-style note naming the specific ADR id
  and/or CONVENTIONS section; the unrelated one carries no such note; `$AC principles list`
  shows the same flag. The principle's stored text and status are unchanged afterward
  (`principles show` before/after identical). Record a promotion of that principle into this
  project (via the documented promote path) and re-run: it is no longer flagged as clashing
  with this project.
- **Fails if:** no clash is flagged, the flag doesn't name which canon item, unrelated
  principles are flagged, anything is rewritten/retired/hidden automatically, or a principle
  promoted into this project is flagged as clashing with its own promotion.

### C8 — Workflow-spawned agents receive a working retrieval instruction scoped to their stage; the criteria-author receives none
- **Observe:** Inspect the prompts/role definitions that the plan, execute (executor, batch
  executor, heal executor), and research paths hand to agents (workflow scripts' prompt
  builders and `agents/*.md`). Each directs the agent to run the shortlist command with its
  stage/work and (for executors) its task files, alongside the canon. Take that instruction as
  written for one executor and one planner/researcher, substitute the fixture's values, run it
  from `$W/proj`, and confirm it succeeds and yields the C1-shaped shortlist for the mapped
  work value (planning stage vs code). Inspect the criteria-author's prompt/definition: it is
  given no principle retrieval. Also confirm agents are told to cite the ids they applied.
- **Fails if:** any of those roles lacks the instruction; the instruction as written errors,
  uses flags the CLI rejects (ADR-029 allowlist), or omits stage/files so it cannot scope; the
  criteria-author is handed principles; or no role is asked to cite applied ids.

### C9 — The verifier sees only hard rules, and a violation becomes a non-blocking finding, never a failed criterion
- **Observe:** Inspect what the verify path gives the verifier: it retrieves hard rules only
  (running the instruction as written against the C3 store returns the hard rules and none of
  the defaults), and it is told that a hard-rule violation is reported as a finding (the
  existing findings→debt channel) and must not fail any criterion. Confirm the phase verdict
  is still computed from CRITERIA.md alone: the verify result schema/verdict logic has no path
  where a principle violation sets passed=false. Run the verify-related test(s) in the suite.
- **Fails if:** the verifier is given default-strength principles, a personal rule can fail a
  phase (a new blocking field or instruction to FAIL), or violations have no route into
  findings.

### C10 — The main Claude session gets hard rules in full plus the compact index from session hooks, and degrades silently
- **Observe:** With the C3 store and cwd `$W/proj`, run the SessionStart hook and the
  PreCompact hook the installer registers (feed each the JSON stdin shape the host sends,
  e.g. `echo '{"cwd":"'$W/proj'"}' | node hooks/<hook>.mjs`): the emitted context contains all
  hard-rule statements with their why sentinels and a compact one-line-per-entry index of
  in-scope defaults (no default why sentinels). Then point `ASTRO_PRINCIPLES_DIR` at a
  nonexistent directory and at an empty one: both hooks exit 0, emit no error text, and emit
  no principles section; the rest of their existing context output is still present.
- **Fails if:** hooks omit hard rules, dump full default text, crash or print a stack trace
  when the store is absent/empty, or suppress their pre-existing context when principles are
  unavailable.

### C11 — Personal principles never land in the repository; other hosts are told to run `ac`
- **Observe:** With a store containing sentinel statements, run the path that writes the
  managed AGENTS.md block (and any install/init that renders repo-facing agent files) into
  `$W/proj`. The managed block instructs the agent to run the `ac principles` retrieval
  command, and `grep -rI ZEBRA $W/proj` (excluding `.git`) finds nothing; `git -C $W/proj
  status --porcelain` shows no file containing principle text. Also run a full shortlist +
  hook cycle and re-check: still no sentinel in any repo file (a usage log, if one exists,
  lives outside the repo or contains ids only, never statements).
- **Fails if:** any principle statement/why is written into AGENTS.md, CLAUDE.md or any other
  file in the project tree (it would land in a teammate's clone — ADR-057), or the AGENTS.md
  block gives other hosts no way to retrieve principles.

### C12 — No astro command or agent can read the forge knowledge graph any more; the retrieval replaces it
- **Observe:** Across installed `commands/*.md` and `agents/*.md`, no allowed-tools/tools
  list grants a `forge_knowledge` tool and no step instructs calling one; the discuss, plan,
  new-project, researcher and planner call sites that used it now direct `ac principles`
  retrieval (`ask` or the shortlist), and running that instruction as written in the fixture
  succeeds. No command references `templates/forge-knowledge.md` (it is gone or a stub that
  points to the later import phase). The guard tests that pinned forge wording pass against
  the new wording.
- **Fails if:** any agent can still call the forge read tool, a call site was removed without
  a working replacement, or a command still points agents at the forge template.

### C13 — The full test suite is green, with the new retrieval behaviour under test
- **Observe:** `cd /Users/buu/Development/astro-code && node --test tests/` exits 0 with no
  failing or cancelled tests. Temporarily break the scope matcher (e.g. make it return every
  entry) in a scratch copy and re-run the principle tests: at least one test fails.
- **Fails if:** any test fails, or the new behaviour (scoping, hard-rule-in-full, ask
  ranking, usage logging, clash flagging, stack detection) has no test that catches a
  regression (CONVENTIONS: every `lib/` change needs a test).
