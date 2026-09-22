# Plan — Phase 21: rate-limit usage on the statusline, priority-aware responsive layout

Aimed at every criterion in `CRITERIA.md` (C1–C9) and bound by `CONTEXT.md` D1–D8.
Test strategy: **test-first inside each behaviour task** (the task writes the failing
assertion first, then the implementation, and commits both). No standalone RED-test task
exists, so no task can leave a wave boundary red (ADR-020). While driving a new export
red, use `const { fn } = await import('../hooks/_astro-ctx.mjs')` inside the async test
body — never a static import of a symbol that does not exist yet (ADR-018); the static
import block may be extended only in the same commit that adds the export.

## The four open questions, settled here (binding on every task)

1. **`⊡` with no version** → the glyph **fuses with the next identity token** instead of
   standing alone: `⊡ M1 · ‹2 (P3)`. With a version it is unchanged in shape:
   `⊡ v0.14.0 · M1 · ‹2 (P3)`. With neither version nor milestone/track it is a bare `⊡`.
   No `⊡ ·`, no empty token, no bare `v` (C7c).
2. **`⊡ astro` assertions** are **updated, never deleted** — all eight sites, listed in t5.
3. **`data.cost`** is read in exactly one production place (`hooks/astro-statusline.mjs:112`)
   and constructed in exactly one fixture (`bin/ac.mjs:1384`). No banner, PreCompact, lib
   or test path reads it. Safe to delete outright (t2 + t3).
4. **Width budget** is **not assumed** — t8 measures it (C8) and owns the tuning knobs
   (bar width, labels, bucket thresholds) if 110 columns do not hold.

## Pinned values (every task uses these verbatim — do not re-invent)

- Labels: `5h` (five_hour), `7d` (seven_day), `cap` (spend_limit). **Never a `$` prefix** —
  C7(b) forbids any `$<number>` anywhere on the line at any width.
- Bar: `progressBar(f, 5)` — the SAME `█`/`░` glyphs as the context bar. The `▓▓▓░` in
  CONTEXT.md's prose sketch is illustrative ASCII, not a spec; two bar styles on one line
  is the bug D6 exists to prevent.
- Entry shapes — detail 2: `5h █████ 58%`; detail 1: `5h 58%`; detail 0: the hottest entry
  in detail-1 shape only. A **hot** entry appends ` ·2h12m` at every detail level (D2).
- Hot / colour gate: `f = used_percentage / 100` **unclamped**; `rampColor(f)` =
  `f >= 0.85 ? ANSI.red : f >= 0.6 ? ANSI.yellow : ANSI.green`. The same `>= 0.85` gates
  D2's countdown. `spend_limit` at 142% is therefore red and hot — no separate rule above
  100 (D3/D6).
- Clamp split (D3): the bar receives the clamped fraction (`progressBar` already clamps),
  the percentage text prints `Math.round(used_percentage)` uncapped.
- Colour placement: the ramp code must sit **immediately before the bar glyphs**
  (`paint(progressBar(f, 5), rampColor(f))`) so C4 can read it; the percentage text carries
  the same colour so detail 1/0 stays readable.
- Display order is canonical and stable: `five_hour`, `seven_day`, `spend_limit`. Ranking by
  `used_percentage` decides **only** which entry survives at detail 0 (ties → canonical
  order). A stable order stops the line jittering as percentages cross.
- Validity: an entry is kept only when `Number.isFinite(Number(used_percentage))` and the
  value is `>= 0`; anything else (missing, `null`, `"abc"`, `{}`) is dropped silently. Zero
  valid entries ⇒ the helper returns `''` and the segment costs no columns (C2).
- `resets_at` is used only for a hot entry, only when finite; remaining seconds are
  `Math.max(0, resetsAt - now)`.
- ETA format (hand-rolled, zero deps, ADR-001): `<=0` → `0m`; `<1h` → `47m`; `<24h` →
  `2h12m`; else `4d6h`. Never an epoch integer, never an absolute clock time.
- `now` is an **injected** epoch-seconds argument (the `readContext(root, nowSeconds)`
  convention), never `Date.now()` inside the renderer — otherwise C3 cannot be pinned.
- Detail selection lives in the hook, never inside `packStatus` (which stays untouched:
  whole segments dropped, never sliced; unknown width means roomy). It reuses the existing
  `lookahead` boundaries rather than inventing a second width model:
  `detail = cols === 0 || cols >= 110 ? 2 : cols >= 70 ? 1 : 0`, then **lowered** (never
  raised) while the assembled single line still exceeds `cols`.
- Placement: `wide: [base, claude, rate, project, branch, update]` (the two gauges sit
  together); rows: the rate segment **leads row 2** —
  `stateFitsRow1 ? [rate, branch, claude] : [state, rate, branch, claude]`. No promotion to
  row 1 for a hot window (D5).

---

## Tasks

### t1 — `rampColor`, the ETA formatter and `renderRateLimits`, with unit tests
- **file:** `hooks/_astro-ctx.mjs`, `tests/statusline.test.mjs`
- **depends_on:** —
- Extract the ramp `renderClaudeSegment` already computes inline (currently
  `f >= 0.85 ? ANSI.red : f >= 0.6 ? ANSI.yellow : ANSI.green`) into one exported
  `rampColor(f)` and call it from `renderClaudeSegment` — behaviour identical, one
  definition. Duplicating the two magic numbers into a second literal is what lets the two
  bars silently desync later, which is exactly what D6 forbids (C4).
- Add `formatEta(seconds)` per the pinned format, and
  `renderRateLimits(rateLimits, { now, detail = 2 })` per the pinned values, reusing
  `progressBar`, `paint` and `ANSI`. Pure, no clock read, no I/O.
- Comment in this file's voice (say *why*): why the hottest window is the one that
  survives, why the bar clamps while the number climbs, why `now` is a parameter.
- Tests (written first, `await import` while red): both windows render at any level incl.
  5 and 8 (C1); invalid/missing entries drop to `''` with no `NaN`/`undefined`/`-%` (C2);
  countdown at 85/86 and none at 84, `0m` for a passed `resets_at`, never an epoch (C3);
  `rampColor` agrees with `renderClaudeSegment` at 0.59/0.60/0.84/0.85 and the three codes
  are distinct (C4); at 100/142/500 the bar string is byte-identical while `142%`/`500%`
  print uncapped (C5); detail 2→1→0 sheds bars before numbers and keeps the hottest
  entry, flipping when the percentages swap (C6).

### t2 — Remove the session-cost segment from the hook
- **file:** `hooks/astro-statusline.mjs`
- **depends_on:** —
- Delete the `usd`/`cost` read (lines ~112-113) and both references (`wide`, `groups[1]`).
- Delete the stale prose with it: the header comment's "and the session cost" (line ~10)
  and the `(6) git branch + (7) session cost` comment (line ~105) — a comment describing a
  segment that no longer exists is the drift CONVENTIONS.md calls out.
- Atomic and green on its own: nothing else in the repo reads `data.cost` (open question 3),
  and no test asserts a dollar amount.

### t3 — Drop the cost fixture from `ac statusline preview`
- **file:** `bin/ac.mjs`
- **depends_on:** —
- Remove `cost: { total_cost_usd: 0.42 }` from the preview blob (line ~1384) — dead weight
  once the segment is gone. Per CONTEXT.md's assumptions the preview is **not** taught to
  fake rate limits in this phase.
- Update the neighbouring comment (line ~1377) from `⊡ astro v<version>` to `⊡ v<version>`.

### t4 — Document the new line in the statusline command
- **file:** `commands/astro-statusline.md`
- **depends_on:** —
- Segment list (step 3): rename `**⊡ astro**` to `**⊡ mark**` and describe it as glyph +
  version + milestone + phase; add a `**quota**` bullet (5h / 7d / cap: bar + percent,
  same green→yellow→red ramp as the context bar, time-to-reset only once a window is red,
  absent until the first API response and for non-subscribers — absence is normal, not an
  error); drop `**$cost** — session spend so far` from the `⎇ branch` bullet.
- Keep the existing reporting-slot bounds in the file unchanged (ADR-055 guard test).

### t5 — D7: drop the word `astro` from the identity mark, and update every assertion it breaks
- **file:** `hooks/_astro-ctx.mjs`, `tests/statusline.test.mjs`
- **depends_on:** t1
- In `renderSegmentParts`, remove `paint('astro', ANSI.magenta)` and implement the settled
  no-version fallback (open question 1): the glyph fuses with the next identity token, so
  the output is `⊡ v0.14.0 · M6 · ‹4 (P15)` with a version and `⊡ M6 · ‹4 (P15)` without —
  never `⊡ ·`, never a bare `v` (C7a, C7c).
- Update the file's own docblock example (line ~299) in the same commit.
- **Atomic with all its consumers** — this task updates every assertion the removal breaks,
  by grepping `/astro\b/` across the test file rather than trusting a line list:
  `tests/statusline.test.mjs:79, 91, 94, 95, 341, 368, 437, 471, 525`. They are **updated to
  the new mark, never deleted** — they are the guard C9(a) mutates against, and deleting
  them to go green would remove coverage rather than move it.
- Leave `hooks/astro-statusline.mjs` alone (t6 owns that file's comment) so the two tasks
  never collide.

### t6 — Wire `rate_limits` into the statusline hook
- **file:** `hooks/astro-statusline.mjs`
- **depends_on:** t1, t2
- Read `data.rate_limits` where the cost read used to sit, in the same defensive style;
  import `renderRateLimits` from `./_astro-ctx.mjs`; pass
  `now = Math.floor(Date.now() / 1000)`.
- Implement the pinned detail selection (bucket on `cols`, lowered-never-raised to fit the
  single line) and the pinned placement in `wide` and `groups`. `packStatus`/`fitRow` are
  not modified — D4 changes only what the segment *offers* at each detail level.
- Update the brand comment at line ~33 (`⊡ astro v0.5.2` → `⊡ v0.5.2`) and add a comment
  explaining why detail is bucketed on the same 110/70 boundaries as `lookahead` (one width
  model, not two) and why bars are shed before windows.
- Inert for every existing fixture (no `rate_limits` key ⇒ empty segment ⇒ no separator),
  so the wave boundary stays green.

### t7 — End-to-end: presence, absence, garbage, no dollar, no version
- **file:** `tests/statusline.test.mjs` (may also touch `hooks/_astro-ctx.mjs`,
  `hooks/astro-statusline.mjs` if a defect is found — this task runs alone in its wave)
- **depends_on:** t5, t6
- Extend the existing spawn harness (real hook, `COLUMNS` env, `NO_COLOR=1`, `mkdtempSync`
  project) with a `rate_limits` payload builder, matching the file's existing style.
- Assertions: both windows with bars and correct percentages at 200 cols, also at 5 and 8
  (C1); the five absence/garbage payloads each exit 0, print a non-empty line keeping the
  identity mark and model, and contain no rate-limit numbers, no `NaN`/`undefined`/`null`/
  `--%` (C2); `spend_limit` present/absent/142% end-to-end (C5); `cost.total_cost_usd: 4.2`
  in the payload yields no `$<number>` anywhere (C7b); a run with no seeded version file
  renders a coherent mark with no `⊡ ·` and no empty token (C7c).
- One assertion must fail if the quota segment renders nothing while data is present — that
  is the mutation C9(b) checks for.

### t8 — Width sweep: priority-aware degradation and the 110-column budget
- **file:** `tests/statusline.test.mjs` (may also touch `hooks/astro-statusline.mjs` and
  `hooks/_astro-ctx.mjs` for tuning — this task runs alone in its wave)
- **depends_on:** t7
- Sweep `200 160 140 120 110 100 90 80 70 60 50 40 30` with `five_hour` at 10 and
  `seven_day` at 95 (then swapped) and assert, across the whole sweep: no width shows `10%`
  while `95%` is absent; no width keeps a bar while a number was shed; quota detail never
  increases as width decreases; no quota fragment is cut mid-token (C6).
- Assert `COLUMNS=110` on the both-windows payload emits exactly ONE line of visible width
  `<= 110`, that the same holds at `COLUMNS=100`, and that every row at every swept width is
  non-empty and within budget (C8) — extending the existing
  `for (const columns of [45, 60, 80, 110])` sweep rather than duplicating it.
- **This task owns question 4's answer.** CONTEXT.md's own arithmetic is net **+12** columns,
  not a wash, so if 110 does not hold, tune in this order and record the choice in the task's
  commit message: bar width 5 → 4; then the detail bucket boundary 110 → higher. Never by
  slicing a segment and never by teaching `packStatus` a new rule.
- Finish by confirming `node --test tests/` is green (C9), and that the two C9 mutations
  (identity renders empty; quota renders nothing) each turn the file red — verified in a
  throwaway copy under `/tmp`, never in the repo.

## Wave shape

- **W1 (parallel, disjoint files):** t1 `_astro-ctx.mjs`+tests, t2 `astro-statusline.mjs`,
  t3 `bin/ac.mjs`, t4 `commands/astro-statusline.md`
- **W2 (parallel, disjoint files):** t5 `_astro-ctx.mjs`+tests, t6 `astro-statusline.mjs`
- **W3:** t7 (solo — owns the test file)
- **W4:** t8 (solo — owns the test file and any tuning it forces)
