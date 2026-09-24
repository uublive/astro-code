# Principle capture — the single spec

This is the ONLY place the principle-capture rules are stated in full. Callers reference
this file — `` `$(ac path templates)/principle-capture.md` `` — they never copy its rules.
A command that restates the gate, the lift rule, the volume cap or the invocation inline
instead of pointing here is a defect (drift bait): the two copies will diverge and one of
them will be wrong. Each caller states only its own moment's gate, its own `--from-ref`,
and its own reporting bound; everything else lives here once.

## 1. Human-answered moments only (D6)

Per moment, this gate runs BEFORE any propose call — an agent recording on its own
judgement proposes nothing:

- **`/astro-decision`** — the why/rejected came from the user in this turn.
- **`/astro-discuss`** — `ac phase context <p> --author` prints exactly `human` (never a
  substring test on the marker — the ADR-037 trap: `captured` also matches the agent
  form).
- **`/astro-accept`** — the rejection was recorded WITHOUT `--agent`.
- **Milestone sweep** — the session is attended by the user, and the material comes only
  from `ac milestone harvest`, which already excludes agent-captured CONTEXT and
  agent-signed rejections.

## 2. Lift the generator

Strip every project noun, filename, number and proper name from what is being captured.
If what survives is vacuous or untrue as a general rule, propose nothing. ADR-027 ("the
wave integrator is the single documented exception to the opus→sonnet-only rule…") is the
worked non-liftable example: its content is inseparable from this project's specific model
ladder, so it is never lifted, and it stays recorded either way, in
`.astrocode/DECISIONS.md`.

## 3. Volume (D4)

At most **3** proposals per moment. Each must lift (§2) AND carry a non-empty `--why`.
Fewer is better. Nothing qualifies → propose nothing.

## 4. Kind

One of exactly `principle | pattern | preference | antipattern`:

- `principle` — a general rule worth keeping, stated as a should/must.
- `pattern` — a concrete approach worth repeating.
- `preference` — a stated leaning with no hard rule behind it (discuss answers are
  usually this kind).
- `antipattern` — something to avoid, usually with a reason (reject reasons are usually
  this kind).

## 5. The invocation

One fenced `sh` block, exactly this line (placeholders in `<…>`):

```sh
ac principles add "<lifted statement>" --kind <principle|pattern|preference|antipattern> --why "<why>" --propose --from-project "<project>" --from-ref "<ref>" --excerpt "<the user's own words>"
```

Before running the invocation above, consult the candidates:

```sh
ac principles match "<lifted statement>" --json
```

- `exact` non-empty → run the invocation above anyway. The engine records the repeat as a
  sighting mechanically; nothing is skipped.
- `overlap` candidates only → decide whether this is the same principle or a different one:
  - **same** → run this instead of proposing:

    ```sh
    ac principles sight <id> --from-project "<project>" --from-ref "<ref>" --excerpt "<the user's own words>"
    ```

  - **different** → propose (the invocation above).
- Never rephrase a statement to dodge a rejected match.

Evidence table:

| Moment | `--from-ref` | `--excerpt` |
| --- | --- | --- |
| `/astro-decision` | `"ADR-<nnn>"` (the id `ac decision add` printed) | the why the user gave |
| `/astro-discuss` | `"phase <N>"` | the user's answer with its reason |
| `/astro-accept` rejection | `"phase <N>"` | the reject reason verbatim |
| Milestone sweep | `"milestone <n>"` | the user's words from one recurring source |

`<project>` is the `Project:` line of `ac status`.

`--from-session` is **always omitted**: no session id reaches a command (checked: hooks,
hosts, stats) — do not probe for one.

Never call `accept`/`amend`/`reject`/`retire` verbs and never write under
`~/.astro/principles/` directly — the propose path above and `sight` are the only way in
(ADR-058). The engine redacts the excerpt; do not pre-mask it.

## 6. Ordering

The invocation runs strictly after the command's primary effect has already succeeded. It
never gates or changes that effect; a failed propose never fails the command.

## 7. Reporting (D5, ADR-055)

Exactly **one line**:

```
proposed N principle(s) — ac principles list --proposed
```

Zero proposals → **say nothing** (never "proposed 0"). A failed call → one line
`⚠ principle capture failed: <first error>`. No inline accept prompt, ever — review is
batched (`ac principles list --proposed`).

When repeats were recorded (an `exact` match sighted instead of proposed, or an overlap
sighted via §5's `sight` alternative), the same single line gains `, M seen again` before
the ` — `. With zero proposals but M > 0, the line reads
`M principle(s) seen again — ac principles list --proposed`. With nothing at all (zero
proposals and zero sightings), say nothing, as before. Review the queue with
`ac principles list --proposed`, or `/astro-review`.

## 8. Milestone sweep recurrence rule (D2.4)

Candidates are grouped by theme across the harvest's four sources (ADRs, human CONTEXT,
human rejections, surprises). A theme qualifies only when it recurs in **≥2 phases** — a
single surprise, rejection or answer proposes nothing here; the per-moment captures
already had their shot at one-offs. Rank by phase count, take at most 3 (§3 still applies).

## 9. Dedupe

Exact repeats are handled by the engine: `ac principles add --propose` records a sighting
instead of a new entry (§5). Overlap candidates are handled by the capturing agent: `match`
surfaces them, and the agent decides same (`sight`) or different (propose). Nothing merges
on similarity alone — never "fix" a near-duplicate by editing or rejecting entries from a
command; the propose path and `sight` (§5) are the only way in.
