<!-- astro-discuss: captured -->
# Phase 46 — witness: cite proof of a choice made elsewhere, and machine-typed prompt prefixes (GitHub #132)

## Goal
An acceptance approved outside the session (a decision board, a relay) can carry a citation of that
decision in its record, and lines a tool types into a session never count as the human, in witness or
in live-capture. Witness's known holes in the same files are closed.

## Already settled (not re-asked)
- Witness records, never refuses (ADR-074): #132's "record mode" exists.
- **A citation never makes an acceptance human** (personal principle 1a0d: automation may only
  propose; treating an agent's answer as the user's is what it forbids). `--evidence` is stored beside
  the record; the signer stays what witness/ac say it is (`--agent claude` when not typed, or
  `--witnessed composer` when the human typed the gate command — both kept when both apply).
- spawn-policy (the other half of #132) is out: it sits with the backlog item on re-probing spawn
  isolation.

## Decisions
1. **`--evidence "<id or URL>"`** on `ac phase accept`, `ac phase reject` and `ac fix accept`. Stored
   with the record (a field distinct from `accepted_evidence`, which keeps meaning *what witness saw*)
   and shown by `ac phase show` / `ac fix list` (and wherever the acceptance is printed). Works with the
   mod off and on every host (it is declared, like `--agent`).
2. **Machine-typed prefixes live in the user config** (`~/.astro/config.json`, e.g.
   `witness.machinePrefixes: ["…"]` — planner picks the key, stated once). Your machine's tools type
   them, so they are per-user, not per-project.
3. **Honoured by every composer-gated mod from one shared check** (astro-mods `hooks/lib/`): witness
   treats a matching prompt as not human (its gate call gets `--agent`), live-capture skips it.
4. **Plain prefix match:** the prompt, trimmed, starts with a listed string, case-sensitive. No regex.

## Defaults for the planner (not discussed; change only with reason)
- Evidence: one line, at most 200 characters, no newline; refused otherwise with a one-line reason.
  `--evidence` with `--witnessed composer` keeps both.
- The prefix check applies to typed slash commands too (`command.run` from the composer): a tool can
  type `/astro-accept 46` through tmux.
- The mods read the user config at session start like their other switches; a missing or malformed
  list means no prefixes (fail soft, one notice at most).

## Folded-in debt (in scope)
- `2026-10-12-witness-a-bash-write-of-the-human` — a Bash write (printf >, sed -i) of the human
  CONTEXT.md marker is not witnessed (only Write/Edit are).
- `2026-10-12-witness-a-self-supplied-witnessed` — a self-supplied `--witnessed composer` passes on a
  cold (no known turn) call.
- `2026-10-12-witness-assigning-the-gate-verb-to-a` — `V=accept; ac phase $V 41` reads as a plain human
  accept (gates.js).
- `2026-10-12-ac-fix-accept-on-an-ambiguous-slug-says` — `ac fix accept` on an ambiguous slug says
  "no such fix" instead of "ambiguous" (lib/fixes.mjs).

## Found during this discussion (in scope)
- witness rewrote a gate phrase inside a double-quoted argument that contained escaped quotes
  (`ac decision add "… with --evidence \"<id or URL>\", stored beside the record; …"`): it inserted
  `--agent claude` into the ADR title (ADR-080, superseded by ADR-081). The quoted-mention check
  (ADR-077) must handle `\"` inside double quotes; add this exact command as a test row.

## Out of scope
- spawn-policy; any change to which signals count as human beyond the prefix list.

## Canon touched
ADR-074, ADR-077 (witness), ADR-033 (declared provenance). New rule recorded as ADR-081 (evidence is a
citation, never a signer; ADR-080 superseded, its title was corrupted).
