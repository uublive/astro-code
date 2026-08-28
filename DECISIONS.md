# Decisions — astro-code

> Append-only ADR-lite log. Each entry: what we decided, why, and what we rejected.
> Add entries with `ac decision add "<title>" --why "…" --rejected "…"` or
> `/astro-decision`. Agents read this so past decisions are respected, not relitigated.

## ADR-001 — Dependency-free ESM-only Node ≥22 substrate
_2026-06-05_

**Why:** Claude Code 4.8 runs the framework directly; no build/transpile/bundler and node: builtins only keeps it lean, auditable, and instantly runnable

**Rejected:** TypeScript + build step; runtime deps for CLI/arg parsing

## ADR-002 — Orphan-branch git compare-and-swap for all shared state
_2026-06-05_

**Why:** lib/shared.mjs transact() makes numbering, decisions, and canon collision-proof across developers using a non-force push whose rejection is the mutual exclusion — no server, no gh, works on any remote

**Rejected:** server-side coordination; local-only numbering; gh API

## ADR-003 — Project-global phase numbering (never restart per milestone)
_2026-06-05_

**Why:** registry claims allocate max+1 across the whole project to prevent the milestone-1-twice counter-reset drift

**Rejected:** per-milestone phase counters

## ADR-004 — Plain-file state owned by the CLI; ROADMAP.md generated
_2026-06-05_

**Why:** all .astrocode JSON is mutated only through lock-guarded lib helpers; the human-readable roadmap is rendered, never the source of truth

## ADR-005 — Workflow-tool execution: dependency waves + worktree isolation + sole integrator
_2026-06-05_

**Why:** parallel executors run in isolated worktrees; the integrator is the only git actor (Workflow scripts can't run git) and folds waves onto the branch; same-file tasks are never co-scheduled

**Rejected:** parallel agents committing to one working tree (caused integration collisions)

## ADR-006 — Two-gate phase closure: AI verifies, only humans accept
_2026-06-05_

**Why:** the AI verifier reaches verified at best; ac phase accept refuses unless verified, so a human UAT gate is required to reach complete

**Rejected:** AI auto-closing phases

## ADR-007 — GitFlow mapping: milestone = feature branch (Option A)
_2026-06-05_

**Why:** User-chosen model: each milestone is one feature/m<N> branch off develop, phases commit on it, milestone complete = PR to develop. Simplest and matches the original proposal

**Rejected:** Option B (phase = feature, milestone = release/<N>); long-lived milestone branches must be kept small to avoid develop drift

## ADR-008 — Without the Workflow tool, execution degrades to sequential — never parallel-without-isolation
_2026-06-05_

**Why:** The Workflow path is the only place parallel-safe execution is done deterministically (worktree isolation + integrator). When the Workflow tool is unavailable, the Agent-tool fallback runs tasks one-at-a-time in dependency order (one atomic commit each) so parallel agents can never commit to the same working tree — the root cause of the integration conflicts

**Rejected:** re-implementing the worktree+integrator orchestration in markdown prose (fragile); hybrid auto-strategy in the fallback

## ADR-009 — GitFlow exposed as separate 'ac flow' commands, not by extending lifecycle commands
_2026-06-05_

**Why:** Branching stays decoupled from the planning lifecycle (milestone new / phase add untouched); GitFlow is opt-in per action via explicit ac flow subcommands and gitflow.enabled config. Keeps each command a thin, inspectable git wrapper

**Rejected:** auto-creating branches inside ac milestone new / ac phase add (couples lifecycle to branching)

## ADR-010 — GitFlow Option A: .astrocode state stays on the milestone feature branch (defer orphan-roadmap migration)
_2026-06-05_

**Why:** Phase 3 is pure branch automation; .astrocode roadmap/state lives on the milestone feature branch and merges to develop at close. Moving the roadmap to the shared orphan branch is a separate, later phase (todo.md phasing)

**Rejected:** moving the roadmap onto the astro-registry orphan branch now (too big for branch-automation phase)

## ADR-011 — Opt-in forge CLI for PRs; pure-git pr:none default
_2026-06-11_

**Why:** PR creation defaults to push + compare URL (pure git, any remote); gh/glab run only when gitflow.pr opts in AND the CLI is installed, degrading gracefully to the URL. The never-gh canon constraint protects the registry, which forge CLIs never touch

**Rejected:** pure-git-only phase (defers value); GitLab push-options (forge-specific)

## ADR-012 — Releases are develop-to-main PRs tagged v<milestone>; no release/* branches
_2026-06-11_

**Why:** Under Option A the milestone feature branch already plays the stabilization role, so release branches add ceremony without benefit; tags derive from the project-global milestone number (v3, hotfix patches v3.1) with zero config

**Rejected:** full release start/finish branch pair; user-supplied semver; calver

## ADR-013 — Hotfixes consume no registry numbers
_2026-06-11_

**Why:** hotfix/<user-slug> is named directly so the emergency path works fully offline; push rejection already prevents cross-developer branch collisions and the v<N>.<k> tag carries identity

**Rejected:** a dedicated hotfix claim type (remote round-trip on an emergency path); consuming project-global phase numbers

## ADR-014 — Wave-conflict healing is drop-and-rerun at the integrated tip — never rebase
_2026-06-11_

**Why:** A conflicted worktree branch was written against a stale tip; rescuing it textually is the proven phase-04 trap (auto-merge stacked duplicate helpers with no conflict markers). Re-running the task sequentially on-branch is always semantically fresh and cannot conflict by construction; healed waves are test-gated before the next wave proceeds

**Rejected:** rebase rung with test gate (tests-green does not prove no stale/duplicated code); raw rebase acceptance; skip-and-continue on re-run failure

## ADR-015 — Stale fork-base branches always route to the heal ladder — clean cherry-picks prove nothing
_2026-06-11_

**Why:** Only the integrator advances HEAD, so HEAD at integration time IS the correct fork base; merge-base(HEAD, branch) != HEAD means stale. Phase-04 showed auto-merge can stack duplicate code with zero conflict markers, so textual cleanliness never overrides staleness

**Rejected:** cherry-pick stale branches behind a test gate; warn-only advisories; threading expected-base SHAs through the script

## ADR-016 — File-ownership enforcement is hard only on intra-wave collision
_2026-06-11_

**Why:** Overflow into a file claimed by another task in the same wave is the real co-scheduling hazard and routes to the heal ladder; overflow into unclaimed files integrates with a named warning advisory plus the wave test gate (legitimate out-of-file fixes like phase-04 t14 must not be rejected)

**Rejected:** blanket-hard enforcement (rejects legitimate fixes); warn-only (leaves the phase-04 t5 hazard open)

## ADR-017 — Task commits stamp '(phase NN tK)' in the subject; a found stamp means done on re-run
_2026-06-12_

**Why:** Codifies the suffix executors already converged on (visible in oneline logs, plain-grep matchable, retroactively compatible with pre-feature phases); Discover checks stamps and skips done tasks so /astro-execute is resumable, with the end-of-phase verifier as the backstop for wrongly-skipped work and a missing stamp merely re-running the task (safe-over-fast)

**Rejected:** git trailers (invisible in oneline, no retro match); pre-flight suite or file-touch checks before trusting a stamp

## ADR-018 — RED-test tasks never statically import missing symbols — dynamic-import is the canonical test-first pattern
_2026-06-12_

**Why:** A static import of a not-yet-existing export crashes the whole test file at module load, pushing executors to implement the export and overflow their declared file (the phase-04 t5 trap); await import inside async tests fails only the new tests at call time, preserving test-first cadence and one-file ownership. Test-after serialization stays allowed when explicitly chosen

**Rejected:** test tasks declaring the impl file (blurs ownership); abandoning test-first

## ADR-019 — Worktree-hostile environments: honor use_worktrees + adaptive sequential downgrade
_2026-06-15_

**Why:** The harness creates one git worktree per parallel agent; under wide waves the concurrent 'git worktree add' calls lose a lock race so a majority fail with 'not in a git repository' while a few succeed. The execute-phase workflow now (1) honors config.use_worktrees=false via args to force sequential up front, and (2) latches a sequential downgrade for the rest of a run once a parallel wave shows majority worktree failure — so the failure noise happens at most once and correctness (on-branch commits) is always preserved

**Rejected:** leaving use_worktrees as dead config; per-wave re-run only (repeats the failure noise every wave); throttling the harness's worktree creation (not controllable from the script)

## ADR-020 — M3 'trustworthy self-judgment' opened for the verify-hardening directive; P9 hardens astro-verify (goal-derived criteria + adversarial verification), P10 (per-phase effort dial) is QUEUED and must not start until P9 is accepted
_2026-07-11_

**Why:** Terminal-Bench 2.0 finding: internal verify PASSed work ground-truth scored 0.0; in real projects there is no external verifier so false-PASS silently ships broken work

## ADR-021 — Goal-derived CRITERIA.md is the verifier's bar: a plan-blind agent derives falsifiable, goal-sourced success criteria (each with a concrete observation method) as a NEW FIRST stage of /astro-plan, before the researcher fan-out. The verifier checks ONLY goal + CRITERIA.md + independently-gathered evidence (run the thing, test behavior); it is FORBIDDEN to read PLAN.md or trust task/commit summaries. Overall PASS requires every criterion to independently pass. ACCEPTANCE.md stays the human-UAT doc for /astro-accept
_2026-07-11_

**Why:** Terminal-Bench 2.0: internal verify PASSed work ground-truth scored 0.0. Plan-derived acceptance is self-referential and the verifier re-read the plan and agreed — 'goal-backward' degraded to 'trust the plan'. Structural independence (criteria precede and are separate from the plan; verifier blind to the plan) beats relying on the verifier's willpower, which is exactly what failed

**Rejected:** B repurpose ACCEPTANCE.md (over-couples the AI gate and human UAT into one doc); C verifier self-derives criteria at verify time with no artifact (bar not reviewable pre-execution, cannot catch a bad goal early, independence rests on prompt discipline only)

## ADR-022 — Per-phase effort dial: an AUTOMATED verify->remediate loop in execute-phase, bounded by the level's max cycles AND stop-on-no-progress (no new commit, or the failing-criteria set didn't shrink -> bail to human FAIL). A remediation pass reuses astro-executor scoped to ONLY the unmet criteria + the verifier's evidence, then re-verifies with the P9 adversarial verifier. Levels light/standard/deep map to 0/1/3 cycles (deep also opus tier for execute+verify); research stays 3 angles at every level. Reaches 'verified' at best -> human /astro-accept still closes (REQ-006). effort is an additive roadmap-entry field, default standard
_2026-07-11_

**Why:** Quota tokens are the scarce resource; spend depth on verify->remediate cycles (proven to converge), NOT wider planning fan-outs. Safe to automate only because ADR-021 made the verifier's PASS/FAIL trustworthy

**Rejected:** raw per-phase token budget (hard to choose a number); a new astro-remediator agent (extra surface vs scoping the executor); widening research at high effort (the wrong place to spend); re-running failing tasks unchanged (reproduces the failure)

## ADR-023 — Kit commands use the astro-kit-<verb> naming convention (astro-kit-new, astro-kit-publish, astro-kit-convert)
_2026-08-19_

**Why:** Groups all kit commands as a coherent family in the slash-command list and scales as more are added; chosen over the astro-<verb>-kit suffix form. New kit commands MUST follow this prefix.

## ADR-024 — astro-kit-convert reuses the astro-kit-new scaffold (shared templates/kit tree + vendored tools) rather than forking scaffolding
_2026-08-19_

**Why:** One source of truth for kit anatomy; convert = scaffold + port + parity layer. Prevents drift between the two kit-creation paths.

## ADR-025 — Kit-conversion feature parity is proven by a golden-fixture parity contract: capture the source's real outputs on representative inputs, then the converted kit must reproduce equivalent (normalized) outputs, checked as falsifiable CRITERIA
_2026-08-19_

**Why:** Parity must be measured against the original's actual behavior, not asserted by a human checklist; normalization is limited to declared benign nondeterminism so parity can't be silently loosened.

## ADR-026 — Sequential phases execute as ONE warm batched astro-executor (all tasks flattened in dependency order, one atomic stamped commit per task) when >=2 executable tasks; per-task is the escape hatch (execMode/lean_execution=false) and the worktree-hostile downgrade path
_2026-08-21_

**Why:** Eliminates the per-task cold-start + canon/CONTEXT/PLAN re-read that made small phases far slower than plain Claude Code; preserves ADR-017 stamps/resumability and falls back to per-task for any task the batch fails to commit.

## ADR-027 — The wave integrator is the single documented exception to the opus→sonnet-only rule: models.integrator hard-defaults to haiku (a floor, not an inherit), and integrateWave bails per-BRANCH to the existing heal ladder at executor tier. Every profile (max sonnet, balanced/fast haiku) carries the role so a profile switch cannot leave it unset. Heal re-runs, teardown and the healed-wave test gate stay at models.executor.
_2026-08-22_

**Why:** The integrator is mechanical git, not judgment: with branch→task mapping reduced to an ADR-017 stamp grep, a schema-pinned return, destructive teardown restricted to this-run clean picks and cross-checked script-side via a tornDown subset assertion, and ADR-014/015 routing anything non-clean to drop-and-rerun, the cheap tier has no quality-critical decision left to get wrong. Pinning it to sonnet would have been a literal no-op — models.executor is already sonnet under balanced and fast — so the milestone's win required the carve-out. Bail is per-branch because resolveHealList re-runs every task not confirmed integrated, so stopping the wave early costs more in executor-tier heals than the cheap tier saves.

## ADR-028 — The healed-wave test gate reports THREE outcomes via a required ranSuite flag: no runnable suite (ranSuite:false) lets the wave proceed UNPROVEN behind a loud advisory and still tears down healed branches; a suite that ran and failed — including a load/collect/compile error — still stops the phase as an integration failure.
_2026-08-23_

**Why:** passed was schema-required with no way to say 'this project has no tests', so the gate agent had to guess and a guess of false aborted the whole phase over a suite that never existed — non-deterministically, since the same repo could pass one run and fail the next. Failing closed is wrong here because the gate protects against a bad heal, and a project with no tests has nothing to protect; the end-of-phase verifier remains the backstop. The no-suite path deliberately shares the green-gate branch so teardown still runs — short-circuiting would strand worktree-* branches and false-FAIL the verifier's rev-list check (the phase-05 UAT gap). A suite that exists but cannot be collected stays a hard failure (ADR-020 non-compiling wave boundary).

## ADR-029 — The ac CLI validates flags against a per-verb allowlist on the shared/destructive verbs (canon push, decision add, registry init, phase accept, phase reject) and dies on anything unknown; ac canon push gains a real --dry-run that reads the registry via snapshot() and publishes nothing.
_2026-08-23_

**Why:** parseArgs collected any --x into flags and no verb ever validated them, so an unknown or typo'd flag was silently discarded and the command ran with DEFAULT behavior. Combined with --dry-run not existing, that made 'ac canon push --dry-run' perform a real publish to the branch the whole team reads — the safest-sounding invocation was the most dangerous one, and it was hit in practice on the ocp project. The check runs before any side-effecting work so a typo can never half-apply. Scoped per-verb rather than globally because blanket enforcement would break existing invocations on read-only verbs for no safety gain.

**Rejected:** Global unknown-flag rejection for every verb (breaks harmless stray flags on read-only commands); implementing --dry-run alone (leaves every other typo silently degrading to default behavior); warn-only on unknown flags (a warning on stderr is exactly what gets missed in an agent transcript)

## ADR-030 — Optional external-service integrations live ONLY in the prose layer (commands/agents) and reach the service ONLY through MCP tools — never through lib/, bin/, workflows/, imports, subprocesses, or config keys; absence of the tools is silent, a failing call says so once
_2026-08-23_

**Why:** Keeps the tool standalone-by-construction rather than standalone-by-intention: if no executable code path can reference the service, there is nothing to break when it is absent, and REQ-001's dependency-free substrate stays structurally true. Detection must probe deferred tools (toolset check, then one ToolSearch) because a connected-but-unloaded MCP tool is otherwise indistinguishable from an uninstalled one, and that failure mode looks exactly like correct degradation. Absence is expected and must be invisible; a configured-but-broken server is a real problem and must not stay silent.

**Rejected:** Importing or shelling to the service (hard dependency); a config key toggling the integration (a second source of truth that drifts from actual tool availability); restating the integration rules in each command (drift bait — they live once in templates/ and are referenced); treating a failed call the same as an absent tool (hides a broken server indefinitely)

## ADR-031 — The implementer sees the acceptance bar: execPrompt, healPrompt and batchPrompt all carry CRITERIA.md read-only, with an explicit 'implement the goal, not the criterion text' caution. The verify->remediate re-verify gains a focusIds hint that REDIRECTS adversarial depth to the just-remediated criteria while still independently observing EVERY criterion.
_2026-08-25_

**Why:** Measured on a real project: half of all execute runs failed first-pass verification and cost 2.1x as a result (47min vs 22min mean), and the remediation loop was catching genuine severe defects (an indexing step that soft-deleted every other live policy, a sync tool run on a worker thread against a module-level connection). The failures were structural, not verifier strictness: the executor implemented against PLAN.md and was judged against a pre-registered bar it had never read, while the planner had already aimed every task at that bar. ADR-021 constrains the VERIFIER to stay plan-blind and gather its own evidence; it never required the implementer to be criteria-blind, and showing the acceptance test to whoever writes the code is ordinary engineering. Coverage on re-verify stays total because the stop-on-no-progress bail compares the COMPLETE failing-criteria set across cycles: narrowing re-verify to the previously-failing ids would make a remediation that fixes one criterion while breaking another invisible, and could return passed=true on a phase the cycle just broke.

**Rejected:** Scoping the re-verify to only the failing criteria (defeats the cross-cycle regression comparison the no-progress bail depends on — the exact false-PASS mode ADR-020/021 exist to prevent); folding the bar into OBEY (would also steer the integrator, teardown and test gate, none of which implement anything); weakening or skipping the verify gate to save time (the loop was catching real data-loss bugs); giving the executor PLAN.md-derived acceptance instead (self-referential — the whole point of ADR-021 is that the bar precedes and is independent of the plan)

## ADR-032 — Execution is pipelined against planning: /astro-execute launches the NEXT phase's plan-phase workflow concurrently when that phase is pending, unplanned and passes the ac phase context discuss gate. Phases are sized as the largest chunk with ONE coherent verifiable goal. The fast lane is /astro-fast (renamed from /astro-alex, no alias).
_2026-08-25_

**Why:** Measured on a real project, deduped from transcripts: 9.9h of workflow across 19 runs, of which execution was 8.1h (49min mean) against 1.8h for planning (12min mean). Planning phase N+1 needs nothing from executing phase N, so serializing them wastes ~12min per phase for no benefit. Per-phase fixed overhead (one discuss round, one plan run, one execute run, one verify pass, one human accept) is largely independent of phase size, so two small phases cost roughly twice one merged phase for the same code — but merging is bounded by verifiability: a phase whose criteria cannot be stated as one coherent bar is too big, and verification degrades into a checklist, which is what ADR-021 exists to prevent. The pipelined plan is hard-gated on ac phase context printing ready, because auto-planning an undiscussed phase would defeat the discuss gate.

**Rejected:** Auto-planning the next phase unconditionally (defeats the discuss gate); keeping /astro-alex as a deprecated alias (no alias precedent survives in the repo and the installer prunes renamed commands cleanly, so an alias file would be new phantom surface); merging phases purely to reduce overhead (unbounded merging makes the verify gate a checklist); reordering the human accept gates to overlap phases (REQ-006 closes phases one at a time)

## ADR-033 — Phase acceptance records accepted_kind ('human' | 'agent') alongside accepted_by; an autonomous signer MUST pass 'ac phase accept <p> --agent <name>', which records kind=agent and prints an AGENT marker. Provenance is DECLARED, never detected.
_2026-08-25_

**Why:** REQ-006 is the two-gate guarantee: the AI verifier reaches verified, only a human accept reaches complete. accepted_by defaulted to the repo's git identity, so an agent accepting on the operator's behalf was recorded AS the operator — and --by only renamed the signer, so a machine signature and a human one had the identical shape. The guarantee was therefore unauditable from the record: nothing on disk could distinguish the gate REQ-006 requires from a machine rubber-stamping itself. It cannot be auto-detected — when the operator accepts, their assistant runs the same command, so both paths are an agent invoking ac and the only difference (whether a human made the judgement) lives outside the process; sniffing it would manufacture false confidence in the one record the guarantee rests on. Default stays human because every acceptance to date was genuinely the operator's, and defaulting to unknown would retroactively cast doubt on correct records; the burden sits on the agent path instead.

**Rejected:** Auto-detecting agent context from env or harness signals (impossible in principle — the human's own accepts also run through an agent, so any signal produces false confidence); reusing --by with an agent name (a bare string is indistinguishable from a human with an unusual name, which is the defect); defaulting accepted_kind to 'unattested' (retroactively casts doubt on historically-correct human sign-offs); blocking agents from accepting at all (unattended benchmark and autonomous runs are legitimate — the record just has to say so)

## ADR-034 — ac canon pull preserves and reports local-only ADRs instead of overwriting DECISIONS.md wholesale; the ADR-032 pipeline gate emits one line when it does not fire, and the ordering trap (the next phase must be discussed BEFORE executing the current one) is documented in astro-execute and surfaced by astro-status.
_2026-08-25_

**Why:** Found by the v0.11.0 benchmark. (1) DECISIONS.md is append-only and ac decision add is assumed to be its only writer, but that invariant is unenforced and astro-code's OWN planner emitted a task writing an ADR directly into the file; canon pull then overwrote it from the registry and printed success, canon push refuses to publish DECISIONS.md so there was no repair path, and ac decision add reissued the same id because numbering comes from the shared branch. Three steps, each reporting success, ending in silent data loss. A pull is a refresh, not a reset. (2) The pipeline gate requires the next phase to be discussed, but the documented loop order leaves it undiscussed at execute time, so the feature could never fire; and because the gate was silent when unmet, correctly-gated-off, model-skipped and broken were indistinguishable — the benchmark could only detect it by front-loading every discussion.

**Rejected:** Aborting the pull on divergence (canon pull is best-effort inside /astro-execute; failing it would block execution over a recoverable condition); teaching canon push to publish DECISIONS.md (bulk-pushing an append-only log loses concurrent entries — the reason addDecision uses CAS append); moving the pipeline launch into workflows/execute-phase.mjs (the script would have to nest a workflow, sharing the concurrency cap, so the plan would no longer be genuinely concurrent with execution)

## ADR-035 — ADR-027 is REVERTED: no role runs haiku, integrator included — every profile and the workflow floor are sonnet. Independently, the integrator prompt forbids unscoped destructive git in the shared tree and pins branches[] to SOURCE branches; a phase that discovers ZERO tasks is a hard FAIL; plan artifacts are committed by /astro-plan; ac init gitignores .claude/worktrees/; and /astro-discuss records agent-authored briefs.
_2026-08-25_

**Why:** Benchmark #2 inverted ADR-027's premise. The carve-out argued the integrator was mechanical git with no quality-critical decision left to get wrong. Its cherry-pick JUDGEMENT at haiku was in fact sound — per-branch stale classification correct and well-argued — but it is the ONLY role that runs git in the SHARED main working tree, where untracked files include other phases' completed plan artifacts. It ran a bare 'git stash -u' and never popped it, destroying a finished PLAN/CRITERIA/ACCEPTANCE set, and it filled branches[] with the target branch instead of the sources, aborting a phase whose work had integrated correctly. It is the role with the largest destructive surface, not the smallest. The saving never justified that: executor is already sonnet under balanced and fast, so the carve-out bought one cheap agent per wave and cost a destroyed plan and a dead phase. The zero-task hole is the reason the damage went unseen for four steps — every field of the resulting run read benign and indistinguishable from a small sequential phase, so it is now a hard failure that names the likely cause. Tier is not a substitute for a guard: the prohibitions apply at any model tier.

**Rejected:** Keeping haiku and relying only on the prompt prohibition (two independent defects in one role in one run is enough evidence, and the tier saved nothing measurable); treating the stash incident as operator error (the shared tree is the integrator's designed workplace and sonnet executors already used the correct scoped 'git stash push -- <path>' + pop form); making zero tasks a warning rather than a failure (a warning is what the benign no-op already effectively was); writing the gitignore entry inside initPlanning (lib must not write outside .astrocode/ — it dirtied the tree and made 'ac flow branch' refuse straight after a scaffold)

## ADR-036 — ac preflight warns when local HEAD has diverged from its upstream, and /astro-execute runs it before launching. Advisory only — exit 0 always, silent when in sync, never blocks.
_2026-08-25_

**Why:** The harness creates each parallel executor's worktree by forking the REMOTE branch, not local HEAD, so any unpushed commit makes an entire wave read STALE at integration: ADR-015 correctly refuses the cherry-pick, the heal ladder re-runs every task sequentially, and the phase still reports PASS. Benchmark #2 lost 17 task-executions this way across three phases, while the one phase that launched with HEAD == upstream healed 0 of 11. astro-code cannot fix the fork base — isolation:'worktree' exposes no control and the workflow script runs no git (ADR-008) — but it can stop the condition being invisible: its only other trace is 'executed' exceeding 'tasks' in a JSON payload nobody reads, and nothing in the human-facing verdict mentions that half a wave was discarded. Silent when in sync so the common case adds no noise, and advisory rather than a gate because the operator may legitimately intend to run unpushed.

**Rejected:** Blocking the run on divergence (the operator may have a good reason, and a hard gate on an advisory condition invites --force habits); fixing it in the workflow script (it runs no git, ADR-008); leaving it to prose in astro-execute alone (every 'the model should remember to check X' in this framework has eventually not happened — the ToolSearch probe and the pipeline gate both silently never fired); auto-pushing on the user's behalf (an outward-facing action astro-code has no mandate to take)

## ADR-037 — ADR-034's canon-pull rescue anchors to true end-of-input so a preserved ADR keeps its body, not just its heading; the discuss gate accepts ADR-035's agent marker as well as the human one and exposes contextAuthor(); and every remaining haiku recommendation is purged from the agent-facing docs the ADR-035 revert missed.
_2026-08-26_

**Why:** Benchmark #3. All three were shipped fixes that looked fixed. (1) The rescue regex used a bare end-of-line anchor under the /m flag with a lazy quantifier, so it stopped at the first line break: the heading survived and the date, Why and Rejected were silently dropped, while the message still claimed a full rescue — and a verifier grepping for the ADR id, which is what the check prescribed, passed either way. It failed always for an ADR at EOF, the common case for an append-only log. (2) /astro-discuss instructed agents to write '<!-- astro-discuss: captured by agent: X -->' but the gate regex required 'captured' to be followed immediately by '-->', so an agent-discussed phase read as stub, /astro-plan treated it as undiscussed, and ADR-032's pipeline gate could never be satisfied by an agent-authored discussion — the feature was inert in exactly the configuration it was added for, with a fully green suite and no test covering it. (3) /astro-config still listed haiku as the integrator default and offered it explicitly, a one-command documented path back to the defect ADR-035 exists to prevent, while lib/models.mjs comments contradicted the sonnet values directly beneath them.

**Rejected:** Widening the discuss marker to any comment (the gate must still reject an undiscussed file, and a test now pins that); treating the haiku doc references as cosmetic (they are live agent-facing instruction text, not comments — the runtime was correct and the guidance still steered users back to the defect); leaving the canon truncation as partial-loss-is-better-than-total-loss (a message claiming a full rescue while dropping the substance is worse than a visible failure)

## ADR-038 — Discover's per-task 'file' field is REQUIRED, and the strategy decision returns a strategyReason plus wildcardTasks so a sequential run says WHY; the batch executor treats its stamp grep as the authority over its own belief and amends rather than reporting unstamped; the destructive-git prohibition extends from the integrator to every executor prompt; and /astro-execute sweeps for leaked worktree/branch refs after a run.
_2026-08-26_

**Why:** Benchmark #3. (1) Discover omitted 'file' for all 24 tasks of one phase and supplied it for all 17 of another, same models and plan format. A task with no file claims the '*' wildcard, the wildcard collides with everything including another wildcard, so buildWaves admitted one task per wave: 24 singleton waves, maxWidth 1, and the strategy rule chose sequential for a phase three times the parallel threshold. It reported passed and nothing said why — the worst shape for a benchmark whose central question is whether the parallel path engaged. (2) A batched phase produced 25 commits with zero ADR-017 stamps while reporting every task committed; the test asserting the stamp requirement passed because it checks the prompt string, not the commits. Unstamped commits are invisible to the integrator's branch-to-task mapping and to resumability, which saved 29 re-executions elsewhere in the same run. (3) An executor ran 'git stash -u && git rebase main && git stash pop' inside its own worktree — not the ADR-035 regression, but refs/stash is repository-wide and the && chain means a conflict skips the pop and strands an unscoped stash on the shared stack, exactly where a destroyed plan went in run #2. (4) A worktree and its branch survived a run reporting clean teardown, invisible because .gitignore correctly hides .claude/worktrees/ so git status stays clean.

**Rejected:** Treating a missing file field as acceptable and silently degrading (the fail-safe is defensible; being silent about it is not — a capability loss must not look like a property of the phase); asserting stamps in the workflow script (it runs no git, ADR-008, so the batch agent's own grep is the only available check); auto-deleting leaked refs (a preserved branch may be the only copy of a failed heal under ADR-014, so the sweep reports and shows whether HEAD supersedes it)

## ADR-039 — ac decision add unions the shared DECISIONS.md with local-only entries instead of seeding from the shared copy alone; a local ADR whose id collides with a DIFFERENT shared decision is preserved under a fresh id; both rescues are reported on stderr. canonPull and addDecision now share one unionLocalOnly helper.
_2026-08-26_

**Why:** Reported from a live project and reproduced: addDecision seeded its base from files[DECISIONS_FILE] whenever the registry had a copy, ignoring the working-tree file entirely, then wrote the result over it. A project with 101 local ADRs and 3 in the registry lost 98 on the next add — silently, behind a success line. Numbering then restarted from the registry's count and REISSUED ids that already existed locally, so the survivors collided too. ADR-034 fixed exactly this hazard in canonPull and left it in addDecision, which is the far more common path; fixing one path and not its twin is why it survived. canonPush deliberately never publishes DECISIONS.md, so anything written outside ac decision add — by hand, by an executor task, or before the registry existed — lives only locally and was precisely what got destroyed; unioning also repairs that, because the local-only entries now reach the registry on the next add instead of needing a manual re-add.

**Rejected:** Keying the union on id alone (a local ADR-001 and a different shared ADR-001 are two real decisions; dropping either is the bug); deduping on exact text (formatting drift would duplicate every entry, so comparison is on normalised substance); making canonPush publish DECISIONS.md (bulk-pushing an append-only log loses concurrent entries — the reason addDecision uses a CAS append); leaving the rescue silent (silence is what let the original destruction go unnoticed for an entire session)

## ADR-040 — The parallel executor fast-forwards its own worktree onto the working branch before it starts, so a wave forked behind the tip repairs itself instead of being discarded and re-run.
_2026-08-26_

**Why:** Benchmark #4. ADR-036 diagnosed the stale-fork-base waste correctly and then closed the wrong door: it concluded astro-code "cannot fix the fork base" because `isolation:'worktree'` exposes no control and the script runs no git (ADR-008). Both are true of the SCRIPT and neither is true of the EXECUTOR, which has Bash and is standing in the worktree — the fix was available the whole time, one layer down. That run also falsified ADR-036's model of the cause: it attributes the stale base to the harness forking the REMOTE, which predicts a run launched with HEAD == upstream never goes stale. Run #4 honoured that precondition on all 16 launches — `ac preflight` silent every time, equality verified directly, zero commits during any phase — and still discarded 74 of 223 executions, 50% overhead, with one phase healing all 11 of its tasks. Two sibling worktrees in the SAME wave disagreed with each other, one at merge-base == HEAD and one two commits behind, which no remote-forking rule can produce. The base is racy and the operator cannot influence it, so preflight — correct, and kept — cannot prevent this. The waste also has a second, worse face: an executor forked behind the tip cannot see the dependencies its task declares, so it correctly refuses to commit, produces no branch, and becomes invisible to a heal ladder keyed on branches — five of thirteen runs silently dropped a task that way while reporting `skipped: []` and a passing verdict, and one export was lost permanently across ten green phases. Fixing the base fixes the visible waste and that silent hole at once. The repair is safe because of WHEN it runs: at task start the branch has no commits of its own, so the working branch is strictly ahead and `merge --ff-only` cannot conflict or invent a merge commit; if the branch somehow does carry work, ff-only refuses with HEAD untouched and the executor is told to stop and report, because that state is impossible at task start. Verified on a scratch repo across all three paths: stale worktree fast-forwards and then sees the earlier wave's files, an already-current worktree is a no-op at exit 0, and a worktree carrying its own commit is refused at exit 128 with HEAD unchanged.

**Rejected:** `git rebase` (equivalent when there is nothing to rebase and dangerous the moment there is — ADR-038 caught an executor stranding a repository-wide stash around exactly that command); `git pull` (reaches the network for what is a local-ref problem); teaching the integrator to cherry-pick stale branches anyway (a clean pick proves nothing — ADR-015 exists because phase-04 stacked duplicate helpers with zero conflict markers, so this trades a costly-but-correct outcome for a cheap wrong one); doing it in the script (ADR-008, and the script cannot see which worktree an agent got); relaxing ADR-015's staleness refusal (it is the safety net that made this defect visible at all, and it stays — the executor sync means it should now rarely fire, not that it is redundant); auto-pushing between waves to advance the remote (ADR-036 already rejected acting outward on the user's behalf, and the intra-wave disagreement shows the remote is not the whole cause anyway)

## ADR-041 — A phase FAILS unless every executable task landed a stamped commit: one mechanical stamp-audit agent runs after the waves and before verify, and a missing stamp sets integrationFailed rather than passing silently.
_2026-08-27_

**Why:** Benchmark #4: in 3 of the 4 phases that had one, the task whose only job was wiring modules into the public entry point produced no commit — and the run reported skipped:[], stoppedReason:'passed', verdict.passed:true. Nothing compared executed against tasks. The planner had begun defensively coding around it, writing 'phase 3's and phase 4's barrel tasks may or may not have run' into a later task's body, which is the clearest sign the framework was lying to its callers. Result in astrobench4: 70 modules in src/, 41 reachable through the barrel, with 2505 tests green because tests import modules directly. ADR-040 removes most of the cause by fast-forwarding each worktree before it starts; this is the backstop that makes a recurrence loud instead of silent, and it also catches the independent case of a commit landing without its ADR-017 stamp, which breaks branch-to-task mapping and resumability. The message names both causes rather than guessing, because a stamp grep cannot tell them apart.

**Rejected:** Comparing executed to tasks in the script (executed counts agent returns, not commits — an agent that returns success without committing is exactly the failure mode, so it would miss it); warning instead of failing (a warning is what the benign no-op already effectively was); running the audit in the workflow script (ADR-008 — no git there); auditing after an integration failure (the work never reached the tree, so it would report noise, not signal)

## ADR-042 — readTree returns null when a tree cannot be read instead of an empty map, snapshot propagates that as unreadable, and transact refuses to write when the base is unreadable OR when an existing tip's tree reads as empty.
_2026-08-27_

**Why:** Twice a live shared registry was destroyed by ac decision add: registry.json (172 claims) and DECISIONS.md (109 ADRs) deleted, every step reporting success, the second time from the correct project root with an intact local file. Cause: readTree returned an empty Map when ls-tree FAILED, which transact could not distinguish from 'this branch has no files'. It then built the next tree from that empty base, added only its own update, and committed it WITH the real tip as parent — so the push was a clean fast-forward and was ACCEPTED rather than rejected. Nothing errored. This is distinct from ADR-039, which fixed DECISIONS.md content being clobbered; that fix could not help because it operates on file contents while this destroys the whole tree. A tip that exists but whose tree reads as empty is also refused: an initialised registry always carries at least one file, so an empty read is far more likely a partial fetch than a real state.

**Rejected:** A guard asserting no sibling is dropped (unreachable as written — transact seeds  from , so with an empty base there is nothing to detect a drop against; shipping a safety net that cannot fire is the exact failure pattern this project keeps hitting); force-pushing a repaired tree automatically (the operator must see that the remote diverged); treating an unreadable base as empty and retrying (the retry loop re-reads the same failing source, so it would destroy on a later attempt instead)

## ADR-043 — Number allocation floors on the local roadmaps, and an unreachable remote is never reported as an uninitialised registry
_2026-08-28_

**Why:** Allocation read the shared registry alone, so any drift between it and the local roadmaps handed out a number the roadmap already used. Not hypothetical: an ADR-042-era write deleted registry.json from SALESCRAFT's branch while its roadmaps ran to phase 46, so the next allocation was phase 1 — and addPhase did not even reject it, because milestones 1-2 were archived on another machine and nothing local held a 1 to collide with. nextNumber now takes the max of the registry and the local high-water mark. Separately, fetchTip flattened 'cannot reach the remote' and 'the remote has no such branch' to the same null, so claim() answered both with 'run ac registry init' — the one command that rebuilds a team registry from one developer's disk. probeBranch (ls-remote --exit-code) tells them apart; init now refuses on an unreachable remote, --force included.

**Rejected:** Rolling back the claim when addPhase throws: it treats the symptom, still burns a number, and leaves the duplicate reachable by any other caller of claim().

