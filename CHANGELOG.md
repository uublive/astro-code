# Changelog

Release notes in full live on the [GitHub releases page](https://github.com/uublive/astro-code/releases).

## Unreleased

- OpenCode is a supported host: `ac install` publishes every command to `~/.config/opencode/commands` and every agent to `~/.config/opencode/agents` as a registered subagent, so `/astro-plan`, `/astro-execute` and the rest run natively, dispatching `astro-executor`, `astro-verifier`, … by name. Pick each role's model with `ac opencode map <tier> <provider/model>` (what a tier means on your provider) and `ac opencode set <role> <provider/model>` (pin a role to any model, e.g. DeepSeek for the executor); `ac opencode models` shows the result. The controller passes each role's model at dispatch, as obra/superpowers does, so project tiers and `--fast` apply without a reinstall.

## v0.46.0

- The fleet hook tags each prompt it reports as `human` or `auto`, from fixed markers a machine puts there (`[scheduled]`, `[heartbeat]` and the `/clear` before it, `[from:system|comms|jobs]`, `[forge:`, `<task-notification>`, the loop sentinel, the comms triage judge and the chat summarizer), looking through a pasted-content wrapper. Only the word is sent, never the prompt text

## v0.45.1

- The agents that run Bash (executor, mapper, planner, researcher, verifier) write a variable in a path they delete or overwrite as `"${d:?}"` and prefer absolute paths over `cd … &&`, so Claude Code's own safety check no longer stops an unattended run on a permission prompt (e.g. "Dangerous rm operation on possibly-empty variable path"). `tests/agent_shell.test.mjs` keeps the section identical in every Bash agent

## v0.45.0

- `--evidence "<id or URL>"` on `ac phase accept`, `ac phase reject` and `ac fix accept` cites a decision made elsewhere. It is stored as `cited_evidence` beside the record, shown by `ac phase show` and the new `ac fix list --all`, and never makes the signer human (ADR-081, #132)
- `mods.machinePrefixes` in `~/.astro/config.json` lists strings your own tools type at the head of a prompt: witness signs a gate in such a turn as the agent and live-capture never reads it. A malformed list means no prefixes and one warning in `ac mods status` (ADR-081, #132)
- witness closes four holes: a quoted gate with escaped quotes behind an `ac` head is left alone, a gate verb in a shell variable is signed as the agent, a Bash write of the human CONTEXT.md marker is rewritten like a Write, and a `--witnessed` with no known turn is dropped (ADR-081, #132)
- `ac fix accept` on a slug that matches several fixes says it is ambiguous and names them, instead of "no such fix" (ADR-081, #132)
- witness judges a Bash write of a phase CONTEXT.md by its effect: if line 1 becomes the human marker during an unwitnessed turn, it is set to the agent marker afterwards, whatever the spelling (`sed -i '1d'`, escapes, a copy from /tmp)
- witness no longer breaks the commands it signs: `--agent` goes inside a subshell or a `bash -c` string, after the ref when `--evidence` comes first, and a printf format split by quotes stays one word. It used to corrupt a CONTEXT.md body, turn a subshell into a syntax error, and break your own typed accept with `--evidence` before the id
- `ac` reads `ASTRO_SIGNER_AGENT=<name>` as `--agent <name>` and `ASTRO_WITNESS_DROP=1` as "ignore `--witnessed`" when a gate call declares no signer. witness exports them in front of calls it cannot read fully (a variable verb, a nested shell, backticks, `eval`, `xargs`), so a nested `ac` is signed as the agent however it is quoted. Neither can make a record human

## v0.44.0

- A re-verify after a FAIL re-checks the criteria that failed first and stops with FAIL while any is still unmet, so a still-failing phase no longer pays a full verifier run each time. A pass still checks every criterion in that same run. The verdict is saved and committed as `VERDICT.json` beside CRITERIA.md (written only by `ac verdict record`, protected by canon-guard), `ac phase verify` refuses without a full recorded pass, and a full run is forced when many criteria are unmet, CRITERIA.md changed, history moved, the fix is broad, or with `/astro-verify <n> --full` (ADR-079, #129)
- `git-guard` never asks any more: a destructive git call it cannot show to be scoped is denied, so the agent gets the reason and the scoped form at once instead of an unattended workflow waiting on a prompt until you come back. A call it cannot read at all (a subcommand that is an expansion, a script fed to a shell on stdin) runs; it no longer refuses a script just because its text mentions git and a word like "restore" (ADR-082)
- `git-guard` lets a probe in a scratch copy reset and then run its test in one command (assignments, `cd`, a `lean-ctx -c` wrapper); the same command aimed back at the project is still refused

## v0.43.0

- The balanced and fast profiles run the wave integrator on Haiku 5.5 at low reasoning (ADR-078, amends ADR-035; #125, thanks @luigi-lauro). `max` keeps sonnet, an unset `models.integrator` still floors to sonnet, and no profile puts haiku on a judgement role. Opt out with `ac config set models.integrator sonnet`.
- The verifier runs on the 1-hour prompt cache, like the executor (#128).

## v0.42.2

- live-capture works on a local model: when the endpoint refuses Haiku with a 4xx, the session's own model judges for the rest of the session instead of failing with `api-error` on every session. A 429 or 5xx on Haiku is an outage and never moves capture to the session model.

## v0.42.1

- The verifier runs test suites, builds and type-checkers one at a time and, when the project routes them elsewhere (a `host` helper), runs them there, its own compiler scripts included. Its in-container `tsc` runs on top of a busy box were the spike before an out-of-memory restart.
- `git-guard` judges a `for f in <named paths>; do … git checkout -- $f; done` loop path by path, so a probe that blanks and restores a list of files no longer stops for a prompt. A loop over a glob, `$(…)`, `.` or a reassigned variable still asks.
- `/astro-execute` and `/astro-plan` no longer crash on their first launch in a project with no `reasoning` map: the workflows treat a `null` `models` or `reasoning` arg (what `ac config get` prints for an unset map) as empty.

## v0.42.0

- `witness` keeps a typed `/astro-discuss <n>` or `/astro-accept <n>` witnessed when a background workflow's notification arrives during that turn; it used to record your own discussion as written by the agent. It also stops rewriting commands that only mention an acceptance inside quotes (an `echo`, a `grep` pattern, a commit message), which used to get `--agent claude` appended (ADR-077, #132)

- `/astro-config` offers `haiku` per role under Custom, as ADR-073 already allowed; it had kept saying "never offer haiku". The Balanced, Fast and Max profiles are unchanged (sonnet floor) (#125, in part)

- The principles brief is about a quarter shorter, so more rules fit before it is cut: each `⚠ canon may override` reference is printed once at the end, naming the rules it applies to, and ids are printed as their 4-character suffix (`e618`) where that is unique. Every `ac principles` command (`show`, `cite`, …) accepts the suffix; an ambiguous one is refused (#130)

- `npm test` no longer leaves temp folders behind: it runs the suite with `TMPDIR` set to one fresh folder and removes it afterwards, also after a failure or Ctrl-C. A full run used to leave about 1,370 folders (42k entries), enough to fill a tmpfs `/tmp` (#131)

- Hook commands now use the `node` on your `PATH` when it is the same binary (e.g. Homebrew's `/home/linuxbrew/.linuxbrew/bin/node`), not the versioned path a `brew upgrade node` deletes. `ac install` and `ac update` also repair astro's existing entries that point at a node that is gone (#126)

- `ac debt note <id> ["<text>"] [--append|--replace]` adds what a debt item teaches you after it was filed (a second occurrence, a measurement), like `ac phase note` and `ac backlog note`. The id, title and age stay, so a debt no longer has to be dropped and re-filed (#127)

- `git-guard` also skips asking in a throwaway copy marked with `touch .git/astrocode-scratch`, for copies that must live outside `/tmp`. The verifier marks the probe copies it makes

- `git-guard` reads a path held in a variable set once in the same command (`F=src/a.js; …; git checkout -- $F`, how a verifier puts back a file it probed), and treats a glob below a named folder as scoped. A destructive git inside `<(…)` is now asked about; before, such commands crashed the parser and went through unchecked

- `git-guard` no longer asks when the command can lose nothing: a clean tree for `reset --hard` (bare or to `HEAD`), `stash`, a whole-tree `checkout`/`restore` or `-f`, no untracked files for `git clean`, or a scratch repo under the temp directory. It checks with read-only `git status` and still asks whenever it can't tell
- `canon-guard`'s refusal is two lines: the `ac` command to use, then the escapes

## v0.41.0

- astro-mods: an optional enforcement layer for Claude Code 2.1.292+, off by default with one switch per feature (`ac mods`, `ac mods enable <feature>…`, `ac mods disable <feature>…`, several at once). It enforces only rules the canon already states, nothing in the loop depends on it, and a failing mod lets the action through and says so once. Codex, Cursor and an older Claude Code work as before. `ac install` and `ac update` install the plugin with every mod off, so switching a mod never edits `settings.json`. See MANUAL "Enforcement mods"
- `canon-guard` refuses hand edits to the files `ac` owns or generates (`roadmap.json`, `state.json`, `ROADMAP.md`, the registry-owned files, the personal principle store) and names the `ac` verb to use instead. `git-guard` refuses unscoped destructive git (`git stash` without a pathspec, `git clean`, `git reset --hard`, a whole-tree `checkout`/`restore`). Both are plain settings hooks: enabling one writes its entry into every Claude profile, and into Cursor's own `hooks.json` when Claude Code is absent
- `blindfold` keeps the verifier and the criteria author from reading the phase plan. `witness` records whether a phase or fix acceptance was typed by you (`accepted_evidence: "composer"`) or run by an agent, which it marks `--agent`
- `phase-band` draws a panel above the prompt under an `✦ astro-code` banner with the milestone's progress: `ROADMAP` shows every phase of the milestone as a coloured chip, `RUNNING` shows each astro-code workflow in flight with its live agents (`⚙ execute 110 · 3 executors   ✎ plan 112 · 2 researchers`), and `NEXT` has up to three buttons for the next commands, never one for a phase already running. A button only fills the composer; you press Enter. It also offers ids as you type: phase numbers after the loop commands, and open debt, backlog and fix ids after their commands
- `live-capture` turns a rule you type at the composer into a *proposed* principle, judged by one Haiku call per typed prompt. It never accepts one for you, proposes at most three per session, and shows the count once as `N proposed — /astro-principles-review`, or in the phase band
- With the phase band drawing, the statusline no longer repeats it: the milestone, phase track, phase state and live verb leave the line, and everything else stays. `ac statusline dedupe off` keeps them
- `ac status` prints a `Next:` line, and `ac status --json` gives the same recommendation plus the phase list, the activity text and when that text expires (`activityUntil`)
- A command run while `/astro-execute` is working (say `/astro-discuss` for the next phase) no longer wipes the run's `⚙ executing` status when it finishes: `ac activity clear` puts the earlier status back. While a phase executes, `ac status` and the phase band stop recommending executing it again and offer the next phase's step instead
- `ac` accepts `--flag=value`, and treats everything after a bare `--` as plain arguments, so a value that itself starts with `--` is no longer read as a flag
- Haiku is allowed for any role in `ac models` (ADR-073); the integrator's git-safety rules still apply

- `ac mods enable brief-section` (Claude Code 2.1.292+) gives the model the principles brief once, as one cached system-prompt section, instead of four SessionStart hook outputs plus a PreCompact note. The section holds the whole brief and a one-line position that changes only when the phase or its state does, so the prompt cache holds between turns and across `/compact`. The mod drops the hooks' brief parts and position note only when they match what the hooks print exactly; the update banner, other tools' hooks and `settings.json` are untouched, and Cursor and Codex keep the hooks' brief. If the brief cannot be built it adds nothing, drops nothing and tells you once. New: `ac mods feed brief-section` prints what those hooks print, as JSON

## v0.40.2

- Cursor's slash menu shows each astro command's description again, instead of "Running on Cursor" for every command. The menu reads the first line of the command body, not the `description` frontmatter, so the description now leads the body, ahead of the Cursor host note. Claude Code and Codex commands are unchanged. Run `ac update` to rewrite `~/.cursor/commands`
- `astro-executor` asks Claude Code for the 1-hour prompt cache (`experimental: {cacheTtl: 1h}`). An executor often waits more than 5 minutes for a build or test run, so with the default 5-minute cache its next call wrote the whole prompt again. Measured over a week, the executor was the only astro agent where those rewrites cost more than the 1-hour premium, so the other agents keep the default. Codex and Cursor do not get the key

## v0.40.1

- Windows: `ac install` no longer stops with EPERM when `~/.claude` exists and Developer Mode is off. A file symlink Windows refuses is copied instead, so the Cursor commands get written too. Copies refresh on the next `ac install`/`ac update`, and uninstall removes them
- Cursor commands installed from a Windows clone keep their `description`: frontmatter with CRLF line endings is now read correctly. `.gitattributes` keeps `*.md` and `*.mjs` LF on new clones
- On Cursor, the host note tells the agent to run `astrocode` instead of `ac` in PowerShell, where `ac` is the built-in Add-Content alias

## v0.40.0

- The principles brief now reaches the model whole at every session start, `/clear` and compaction. Claude Code cuts a hook's context over 10,000 characters to a 2 KB preview, so a large brief is split across up to four SessionStart hooks, each under 9,500 characters. Hard rules then come without their why (`ac principles show <id>` has it), and anything that still does not fit is named in a closing `⚠ CUT` line. Set `"principles": { "sessionBrief": false }` in `~/.astro/config.json` to turn the brief off. Run `ac update` to register the new hooks
- Per-role models and reasoning can be set once for all your projects: `ac models <profile> --user` writes them to `~/.astro/config.json`. A project's own setting still wins per role; `ac models` shows where each value comes from. New projects follow your default; an existing project follows it for the roles you `ac config unset` there
- `/astro-status` no longer reports a healthy registry; it speaks up only when the registry needs action

## v0.39.0

- Cursor is a supported host, alongside Claude Code and Codex. `ac install` puts the commands and agents in `~/.cursor` (honouring `$CURSOR_CONFIG_DIR`). It detects Cursor by its config folder or by `cursor-agent` on `PATH`, and never touches a binary named `agent`. Install Cursor's CLI with `brew install --cask cursor-cli`
- On Cursor, each command opens with a short note mapping Claude Code tools to Cursor's. Agents run in Cursor's built-in subagents (`explore` for read-only roles, `generalPurpose` for the rest), with the agent file as their instructions. Agents use the session's model, and `/astro-config` never offers Claude tiers
- When Claude Code is not installed, the hooks and status line are wired into Cursor's own `hooks.json` and `cli-config.json`, kept alongside your own entries. When Claude Code is installed, Cursor runs the Claude hooks itself, so astro-code wires none and they don't fire twice
- Codex skills are tagged `metadata.surfaces: codex`, so Cursor, which also reads `~/.codex/skills`, no longer lists every astro-code command twice
- Headless Cursor runs need a logged-in session: `cursor-agent` reads its login from the macOS keychain, which is locked over SSH. Without an API key (paid plans), run it from a local terminal

## v0.38.0

- Astro Fleet now receives outcomes as well as activity. It is told when a phase is verified, rejected or accepted, when a fix is accepted, and about every `git commit`, with who signed it and whether an accept was a first try. A fleet can then rank sessions by what they deliver

## v0.37.0

- Challenge mode: a thorough, opt-in interview for `/astro-new-project`, `/astro-adopt`, `/astro-discuss --challenge`, `/astro-autonomous --challenge` and the new `/astro-challenge`
- On Codex, `/astro-config` no longer offers Claude models, and never writes a model into the shared config

## v0.36.1

- `ac fleet connect` no longer leaves an 'unknown' bay in the Forge
