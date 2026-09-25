# Roadmap

**Milestone 10**

- [ ] Phase 28 — Cross-host parity guard: each host declares what it provides, and a test fails when a command, agent or workflow depends on something a wired host cannot `pending`
- [ ] Phase 29 — Pi host adapter: prompt templates, agents, tool-name map, install, headless runs, verified on a real Pi install `pending` — _Prior research, not in repo: astro-code session 8b9eeb49 (2026-09-05 SDK spike; 2026-09-14 three-host design) and astro-fleet milestones/1 phase 01 notes/spike-pi.md (headless argv, models.json provider, exit codes). Consolidate into a research note here. Real install: Pi 0.86.1 on the Mac; its --thinking now has xhigh, so lib/reasoning.mjs pi map (xhigh->max) is stale._
- [ ] Phase 30 — Pi runtime extension: the Workflow surface, structured output and ask-the-user on Pi's SDK, so commands and workflows run unchanged `pending` — _Open decision from prior research: SDK extension re-implementing the Workflow surface (createAgentSession, per-session cwd, constrainedSampling for schema; model on examples/extensions/subagent) vs ac-owned orchestration via lib/hosts/runner.mjs + headless pi -p (also covers Codex). Settle in discuss._
- [ ] Phase 31 — Per-host model roles: map each role to a provider and model, with local-model limits reported `pending`
- [ ] Phase 32 — Pi session plumbing: status widget and session hooks, transcript-miner reader, Pi package `pending`

<!-- generated from roadmap.json — edits here are overwritten; use `ac phase note <phase> "<text>"` -->
