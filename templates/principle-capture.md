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
- **Transcript sweep (`/astro-principles-mine`)** — material comes only from
  `ac principles mine --json`, which emits only turns the human typed: the engine
  excludes tool results, injected context, command bodies, subagent and headless
  sessions. The engine judges no meaning (ADR-064): it hands over every such turn as an
  item, and which of them are steers, how they group and whether they qualify is judged
  by you, per §9, before any propose call.

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

One exception, stated once: the transcript sweep (`/astro-principles-mine`) takes at most **10**
per sweep, strongest first (distinct-session recurrence, then explicit rule), for
this moment only. The engine does not rank or cap: you pick the strongest qualifying
groups (§9) and carry the qualifying groups beyond the cap forward with `--keep`.

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
| Transcript sweep | the item's `fromRef` (`"transcript <host>:<session>"`) | the item's `text` |

`<project>` is the `Project:` line of `ac status`.

`--from-session` is omitted in every moment except the transcript sweep, whose items
carry the transcript's session id (use the `fromSession`, `fromRef` and `text` of one
item of the group being proposed):

```sh
ac principles add "<lifted statement>" --kind <principle|pattern|preference|antipattern> --why "<why>" --propose --from-session "<fromSession>" --from-ref "<fromRef>" --excerpt "<text>"
```

Elsewhere no session id reaches a command, so do not probe for one.

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
`ac principles list --proposed`, or `/astro-principles-review`.

The transcript sweep alone folds the miner's skipped total K (the sum of its `skipped`
counts) into that same single line as `, K transcript line(s) skipped` before the ` — `,
only when K is above zero — never a separate line. With zero proposals and zero
sightings but K > 0, the line reads `K transcript line(s) skipped — ac principles mine`
(its text output breaks K down), so a sweep that could not read its material never looks
like a clean one.

The transcript sweep alone may add at most one `N more turns — run again` line, N being
the miner's `remaining`, only when it is above zero; silent on it otherwise.

## 8. Milestone sweep recurrence rule (D2.4)

Candidates are grouped by theme across the harvest's four sources (ADRs, human CONTEXT,
human rejections, surprises). A theme qualifies only when it recurs in **≥2 phases** — a
single surprise, rejection or answer proposes nothing here; the per-moment captures
already had their shot at one-offs. Rank by phase count, take at most 3 (§3 still applies).

## 9. Transcript sweep: grouping, threshold, carry-forward (D5, ADR-064)

The miner hands over `items[]` — human turns, each with its `sessions`, `context` (the
assistant turn before it) and `earlier` (true when carried over from a previous sweep) —
and judges nothing. Only turns identical after normalising are already collapsed; exact
restatements of a stored entry arrive separately as `sightings[]`. Every judgement below
is yours, in whatever language the turns are in:

1. **Group** items that state the same instruction, across phrasings AND languages —
   "Don't mock the database in tests", "Non mockare mai il database nei test" and "Nie
   die Datenbank in Tests mocken" are one group.
2. **Keep opposite instructions apart** — "use tabs, not spaces" and "prefer spaces over
   tabs" are two groups, never one.
3. **Ignore content-free replies** — "No.", "stop", "ok", a bare "why?" state no
   instruction, however often they recur.
4. **Judge explicit rules** — a turn that lays down a standing rule ("from now on…",
   "always…", "never again…", in any language) rather than correcting one moment.
5. **Count DISTINCT sessions per group** — the union of its items' `sessions`, `earlier`
   items included; repeats inside one session count once.
6. **Qualify** a group at **≥2 distinct sessions** or **one explicit rule**. A lone
   one-off correction does not qualify.
7. **Propose** at most the §3 cap, strongest first: more distinct sessions first, then
   explicit rules. Each proposal lifts (§2) and is deduped (§5) like any other moment.
8. **Carry forward** — on `ac principles mine --advance <sweep> --keep <id,id,...>`, list
   the ids of below-threshold steers that may recur in a later session, and of every item
   in a qualifying group beyond the cap. Never `--keep` an item you proposed, one you
   recorded as a sighting, or one you judged not to be a steer — kept items come back in
   every later sweep until you stop keeping them.

## 10. Dedupe

Exact repeats are handled by the engine: `ac principles add --propose` records a sighting
instead of a new entry (§5). Overlap candidates are handled by the capturing agent: `match`
surfaces them, and the agent decides same (`sight`) or different (propose). Nothing merges
on similarity alone — never "fix" a near-duplicate by editing or rejecting entries from a
command; the propose path and `sight` (§5) are the only way in.
