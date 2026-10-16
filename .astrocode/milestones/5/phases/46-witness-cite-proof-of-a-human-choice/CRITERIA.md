# Phase 46 — pre-registered success criteria (plan-blind)

Derived from the phase goal, CONTEXT.md and ADR-033 / ADR-074 / ADR-077 / ADR-081. ADR-080 is
not in force (superseded by ADR-081) and nothing here derives from it.

Conventions used by the Observe steps:
- **Scratch project:** a fresh temp dir, `git init`, `node /Users/buu/Development/astro-code/bin/ac.mjs init`,
  a phase added and driven to `verified`, and a fix opened with `ac fix add`, all with `HOME` pointed at
  a temp dir so the real `~/.astro` is never touched. `ac` below means
  `node /Users/buu/Development/astro-code/bin/ac.mjs`, run inside the scratch project.
- **Driving the plugin:** load the astro-mods plugin through the engine simulator
  (`tests/fixtures/mods_engine.mjs` `boot()`, or an equivalent harness), with the witness mod (and, for
  C7, live-capture) switched on. Fire `session.start`, then the prompt-side events (`command.run`
  `{command,args}` + `prompt.submit` `{text, origin:{kind}}`), then a `tool.call`, and read what reaches
  the engine beneath. For criteria that involve the user prefix list, back `$.process.run` and `$.fs.*`
  with the real process and filesystem under the temp `HOME`, so the list reaches the mods through
  whatever channel the implementation uses. The config key is whatever user-facing docs or `ac` help
  state it is.
- **Executing a rewritten command:** put an `ac` shim on `PATH` that runs the real CLI, run the rewritten
  Bash command in the scratch project, then inspect the record with `ac phase show <p> --json` or
  `ac fix list`.

### C1 — `ac phase accept` stores a citation beside the record, shows it, and never changes who signed
- **Observe:** In a scratch project, with the phase verified, run
  `ac phase accept <p> --agent claude --evidence "https://board.example/d/42"`. `ac phase show <p>` (human
  and `--json`) shows the citation `https://board.example/d/42`. The record still says
  `accepted_kind: agent`, the AGENT marker still prints, and the witness field (`accepted_evidence`) is
  absent or unchanged, not the citation. In a second scratch project, run
  `ac phase accept <p> --witnessed composer --evidence "DEC-7"`. That record keeps both the witnessed
  provenance (`accepted_evidence: composer`) and the citation `DEC-7`, each in its own field.
- **Fails if:** the flag is rejected or ignored, the citation is not shown by `ac phase show`, the
  citation is written into `accepted_evidence` or overwrites it, passing `--evidence` changes
  `accepted_kind` (agent becomes human, or the AGENT marker disappears), or combining it with
  `--witnessed composer` drops either value.

### C2 — `ac phase reject` and `ac fix accept` take the same citation, and it is shown where those records are printed
- **Observe:** In a scratch project, run `ac phase reject <p> --reason "x" --agent claude --evidence "DEC-9"`.
  `ac phase show <p>` shows `DEC-9` beside the rejection, and the signer stays agent. Then
  `ac fix accept <fix-id> --agent claude --evidence "https://board.example/f/3"`. The fix's printed
  record (`ac fix list`, or its view of accepted or archived fixes) shows the citation, and the fix is
  recorded as signed by an agent. Repeat both with the witness mod off and with no plugin at all. The
  outcome is identical, because the flag is declared, not detected.
- **Fails if:** either command refuses or ignores `--evidence`, the citation is not shown anywhere the
  acceptance or rejection is printed, it makes an agent-signed reject or fix accept read as human, or
  it works only with the mod on.

### C3 — A malformed citation is refused in one line and changes nothing
- **Observe:** In a scratch project with a verified phase and an open fix, run in turn
  `ac phase accept <p> --evidence "<201 characters>"`,
  `ac phase accept <p> --evidence "$(printf 'a\nb')"`, the same two on `ac phase reject <p> --reason x`
  and `ac fix accept <id>`, and `--evidence ""` with no value. Each exits non-zero with a single-line
  reason. Afterwards `ac phase show <p> --json` still shows the phase `verified`, with no
  acceptance or rejection recorded, and the fix is still open. A citation of exactly 200 characters is
  accepted.
- **Fails if:** an over-long or multi-line citation is stored (whole or silently truncated), the gate
  goes through despite the bad citation, the refusal spans several lines or is a stack trace, or a
  200-character citation is refused.

### C4 — witness signs a gate call that carries `--evidence` the same way it signs any gate call, and leaves the citation byte-intact
- **Observe:** Drive the plugin. (a) After a typed `/astro-accept 41` (composer), the Bash
  `ac phase accept 41 --evidence "https://board.example/d/42?x=1&y=2"` reaches the engine with
  `--witnessed composer` added and the evidence argument byte-identical. (b) In an sdk or
  composer-non-gate turn, the same command reaches the engine with `--agent` added, evidence
  byte-identical, and never `--witnessed`. (c) Same for `ac fix accept <id> --evidence "DEC-1"` after
  `/astro-fix-accept <id>` and in a non-gate turn. Running each rewritten command (via the `ac` shim)
  records the citation verbatim, with the signer witness chose.
- **Fails if:** a call carrying `--evidence` earns `--witnessed composer` without the matching typed
  gate command (the citation is treated as proof of a human), `--agent` is inserted inside or after
  the quoted evidence value, the evidence text is altered, or both `--agent` and `--witnessed` end up
  on one command.

### C5 — A composer prompt that starts with a configured machine-typed prefix never counts as the human in witness
- **Observe:** Set the user config (temp `HOME`) prefix list to `["[relay] ", "/astro-accept", ".*"]`.
  Drive the plugin: (a) a composer prompt `[relay] /astro-accept 41` and also `   [relay] ! ac phase accept 41`
  (leading spaces). The Bash `ac phase accept 41` that follows reaches the engine with `--agent`, never
  `--witnessed composer`. (b) A typed slash command `/astro-accept 41` (`command.run` from the composer
  plus its composer `prompt.submit`) matches the configured `/astro-accept` prefix. The following
  `ac phase accept 41` gets `--agent`, and a human-marker Write to that phase's CONTEXT.md after a
  prefix-matched `/astro-discuss 41` is recorded as the agent marker. (c) Controls: with the list
  `["[relay] "]` only, a typed `/astro-accept 41` still earns `--witnessed composer`. A prompt
  `[RELAY] …` (different case) is not a match. A prompt that merely contains `[relay] ` after other
  text is not a match. The `.*` entry does not match a prompt that does not literally start with `.*`,
  so a plain typed `/astro-accept 41` with the list `[".*"]` stays witnessed.
- **Fails if:** a prefixed prompt (trimmed) still unlocks a gate as human, a prefix-matched typed slash
  command still earns `--witnessed composer` or a human marker, matching is case-insensitive, matches
  anywhere other than the start, treats entries as regular expressions (`.*` marking every prompt
  machine-typed), or the prefixes are read from the project instead of the user config.

### C6 — A missing or malformed prefix list fails soft: no prefixes, at most one notice, nothing else changes
- **Observe:** Drive the plugin three times, with the temp `HOME` config (i) absent, (ii) holding
  invalid JSON, and (iii) holding the prefix key with a non-array value or with non-string entries. In
  each run, a typed `/astro-accept 41` followed by `ac phase accept 41` still reaches the engine with
  `--witnessed composer`, an sdk-turn accept still gets `--agent`, no hook rejects or throws, no mod is
  switched off, and the plugin emits at most one notice about the list across the whole session (zero
  for the absent file is fine).
- **Fails if:** a bad or missing list breaks witness (a hook throws, every mod turns off, or a typed accept
  stops being witnessed), a bad list is half-applied so that some prompt is treated as machine-typed,
  or the notice repeats per prompt or per call.

### C7 — live-capture never captures a machine-typed prompt and still captures the human's
- **Observe:** With live-capture on and the prefix list `["[relay] "]`, drive the plugin with a composer
  `prompt.submit` of `[relay] always run the full suite before pushing` (also with leading whitespace),
  with `$.model.complete` and `$.process.run` recorded. Let any detached work settle. No judge or model
  call is made and no `ac` proposal or sighting is run for that prompt. The prompt itself passes
  through unchanged. Control: the same text without the prefix, in a fresh session, does reach the judge
  call (the existing capture path).
- **Fails if:** a prefixed prompt reaches the model judge or produces any principle proposal or sighting,
  the prefixed prompt is delayed, rewritten or denied, or the unprefixed control stops being considered
  for capture.

### C8 — A Bash write of the human CONTEXT.md marker is witnessed like a Write/Edit
- **Observe:** Drive the plugin in a turn that did not start with a typed `/astro-discuss 41`: an sdk
  turn, a composer `/astro-autonomous`, or a typed `/astro-discuss 40`. Send Bash tool calls that would
  put the human marker `<!-- astro-discuss: captured -->` on line 1 of
  `.astrocode/phases/41-x/CONTEXT.md`. Use at least `printf '<!-- astro-discuss: captured -->\nbody\n' > <ctx>`,
  `sed -i '1s/.*/<!-- astro-discuss: captured -->/' <ctx>` and a heredoc `cat > <ctx> <<'EOF' … EOF`.
  Execute what reaches the engine against a scratch copy of the file. ac's own classification
  (`ac phase context 41`, or whatever ac uses to tell a human capture from an agent one) does not
  report a human capture. Control: after a typed composer `/astro-discuss 41`, the same `printf` write
  yields a human capture.
  Also, in the same turns: `sed -i '1d' <ctx>` on a file whose line 2 is the human marker, and a
  `printf` whose format holds the marker split by inner double quotes
  (`printf "<!-- astro-discuss: "captured" -->\nbody\n" > <ctx>`).
- **Fails if:** any of these Bash forms leaves a human-captured CONTEXT.md in an unwitnessed turn, the
  rewrite corrupts the rest of the file or another file, or the control (a typed discuss of that same
  phase) is downgraded to agent.
- **Out of scope (narrowed by the user, 2026-10-15, after run 2):** witness records and never refuses
  (ADR-074); it is a provenance record, not a sandbox. A spelling built to hide the marker from it is not
  a failure of this criterion: escape sequences (`\x75`, `\165`, `$'…'`, `echo -e`), a marker
  assembled across quotes, or one written elsewhere in one call and copied in by a later call.

### C9 — A self-supplied `--witnessed composer` with no known turn is not recorded as witnessed
- **Observe:** Drive the plugin with witness on: `session.start` and no prompt event (also: a typed
  `/astro-accept 41`, then a second `session.start` as a reload). The Bash calls
  `ac phase accept 41 --witnessed composer`, `ac phase reject 41 --witnessed composer --reason x` and
  `ac fix accept <id> --witnessed composer` each reach the engine in a form that, executed via the `ac`
  shim in a scratch project, does not record `accepted_evidence: composer` (or the fix's equivalent)
  and does not record the signer as a witnessed human.
- **Fails if:** on a cold or reloaded turn a model-supplied `--witnessed composer` passes through and
  yields a witnessed record, or the call is denied outright (witness records, never refuses: ADR-074).
  Also in scope (added during runs 7–10): the claim quoted (`"--witnessed"`, `'--witnessed'`,
  `"--witnessed=composer"`), inside a nested shell string or backticks, or held in a variable
  (`W=--witnessed; … $W composer`).
- **Out of scope (narrowed by the user, 2026-10-15, after run 10):** witness is a provenance record,
  not a sandbox (ADR-074). A claim assembled by shell expansion built to hide it from witness is not a
  failure of this criterion: brace expansion (`--wit{n,n}essed`), a filename glob, escape sequences,
  a claim split across words or variables (`A="1 --witn"; … ${A}essed`), or one fed through `xargs`
  stdin, a script file or a function.

### C10 — A gate verb hidden in a shell variable never reads as a plain human accept
- **Observe:** Drive the plugin in a turn that does not unlock the gate (an sdk turn, a composer `hi`, or
  a typed `/astro-accept 40`). Send Bash `V=accept; ac phase $V 41`, `V=accept && ac phase "$V" 41`,
  `export V=reject; ac phase $V 41 --reason x` and `G=accept; ac fix $G <id>`. Execute what reaches the
  engine via the `ac` shim in a scratch project (phase verified, fix open). Each resulting record is
  signed as agent (`accepted_kind: agent` or the fix's equivalent), never as the human default.
  Also: `V=ept; ac phase acc$V 41` (an expansion inside the verb word), `V=accept; eval "ac phase $V 41"`
  and `V=accept; (ac phase $V 41)` (a subshell).
- **Fails if:** any variable-verb form reaches ac unchanged and records a human signer, or the rewrite
  produces a command that no longer runs or targets a different phase or fix.
- **Out of scope (narrowed by the user, 2026-10-15, after run 2):** witness is a provenance record,
  not a sandbox (ADR-074). A verb fed through a runner witness cannot read (`xargs` reading it from
  stdin or a here-string, a script file, a function defined earlier) is not a failure of this criterion.
  Neither is a command that clears or overrides the signer variable witness exports
  (`unset ASTRO_SIGNER_AGENT`, `ASTRO_SIGNER_AGENT= …`, `env -i`/`env -u`): it targets witness itself, the
  same "built to hide" class (added after run 6, under the rule the user approved after run 2).

### C11 — A quoted mention containing escaped quotes is left byte-identical, and escaped quotes are not a hiding place
- **Observe:** Drive the plugin (sdk turn, and composer non-gate turn) with the exact Bash
  `ac decision add "A human gate (phase accept/reject, fix accept) may cite a decision made elsewhere with --evidence \"<id or URL>\", stored beside the record; a citation never makes the signer human"`
  and also `git commit -m "docs: say \"ac phase accept 41\" in the manual"`. Each reaches the engine
  byte-identical, with no `--agent` or `--witnessed` inserted anywhere. Counter-check in an sdk turn:
  `echo "say \"hi\"" && ac phase accept 41` reaches the engine with `--agent` attached to the real
  `ac phase accept 41`, and the echo string is unchanged. Running the first command (via the shim) in a
  scratch project produces an ADR whose title matches the quoted text exactly.
- **Fails if:** witness inserts anything into a double-quoted argument that contains `\"` (the
  ADR-080 corruption recurs), or a real gate placed after a string containing escaped quotes escapes
  signing (reaches ac as a human accept).

### C12 — `ac fix accept` on an ambiguous slug says it is ambiguous and accepts nothing
- **Observe:** In a scratch project, create two open fixes whose ids end in the same slug (e.g. two
  `ac fix add "foo"` on different days, or dated ids `…-foo` that both match the bare slug `foo`). Run
  `ac fix accept foo`. It exits non-zero with a one-line message that says the slug is ambiguous and
  names the candidate ids (or how to pick one), and `ac fix list` still shows both open. Control:
  `ac fix accept no-such-slug` still says there is no such fix, and `ac fix accept <full id>` of one
  candidate accepts exactly that one.
- **Fails if:** the ambiguous case still reports "no such fix", silently accepts one of the candidates,
  or the unknown-slug or full-id paths regress.
