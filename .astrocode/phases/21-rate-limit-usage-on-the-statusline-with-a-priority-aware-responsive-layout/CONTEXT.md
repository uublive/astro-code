<!-- astro-discuss: captured -->

# Phase 21 — Rate-limit usage on the statusline, and a priority-aware responsive layout

## Goal

Show subscription quota on the statusline — how much of the rolling 5-hour and 7-day
windows is spent — so the thing that actually stops work is visible before it does.
Then re-balance the responsive layout so that when the line has to shed detail, what
survives is what matters.

## The data, confirmed against the official schema

`rate_limits` on the statusline stdin blob:

```json
"rate_limits": {
  "five_hour":   { "used_percentage": 23.5, "resets_at": 1738425600 },
  "seven_day":   { "used_percentage": 41.2, "resets_at": 1738857600 },
  "spend_limit": { "used_percentage": 62.8, "resets_at": 1740787200 }
}
```

`used_percentage` is 0–100 (`spend_limit` may exceed 100). `resets_at` is Unix epoch
seconds. **There is no monthly window** — the phase name's "5h / week / month" reduces to
two time windows plus a gateway-only spend cap.

Per the docs, `rate_limits`:
- appears **only** for claude.ai Pro/Max subscribers, or behind a Claude apps gateway;
- appears **only after the first API response in the session**;
- may have each window **independently absent**;
- has a window **dropped by Claude Code once its `resets_at` passes**.

Absence is therefore the normal first state of every session, not an edge case.

## Decisions

### D1 — Always visible, not threshold-gated

The segment renders whenever the data is present, like the context-fill bar. **Rejected:**
the `debt nn` pattern (silent until it leaves the healthy band) — that suits a derived
score that is noise when healthy, but a quota gauge you can only see once it is already
alarming cannot answer "do I have room for this?", which is the question being asked.

### D2 — Countdown only on a hot window

A window at or past the **red** threshold appends its time-to-reset: `5h ▓▓▓▓░ 88% ·2h12m`.
Below that, percentage only. At 88% the reset time is the fact that changes the decision;
at 20% it is noise that costs columns.

### D3 — `spend_limit` renders when present

Costs nothing when absent (the common case). Behind a gateway it is the binding
constraint. **The bar must clamp at 100% while the number keeps climbing** — the docs say
its `used_percentage` can exceed 100, and `progressBar` already clamps, so the percentage
text and the bar diverge above 100 by design.

### D4 — Narrow degradation sorts by usage; the hottest window survives

```
wide    5h ▓▓▓░░ 58%  ·  7d ▓░░░░ 21%
less    5h 58% · 7d 21%            (bars go, numbers stay)
least   5h 58%                     (the window nearest its limit)
none    segment absent
```

Ranked on `used_percentage`, so the window that survives is whichever is about to stop
you. **Rejected:** a fixed 5h → 7d → spend drop order, which can hide a 7-day window at
95% in order to keep showing a 5-hour window at 10%.

### D5 — No promotion to row 1

A hot window does **not** jump rows. It degrades by the normal `packStatus` rules like
every other segment. Keeps exactly one reason to reorder (`stateFitsRow1`) rather than
two interacting ones.

### D6 — Thresholds match the existing ramp: yellow ≥ 60, red ≥ 85

Reuse `renderClaudeSegment`'s exact ramp so both bars on the line mean the same thing at
the same colour. The same threshold gates the colour **and** D2's countdown.
**Rejected:** an earlier 50/80 ramp for quota — two bars disagreeing about what yellow
means is its own bug, and the canon says match the surrounding code.

### D7 — Drop the word `astro` from the identity mark

`⊡ astro v0.25.1 · M8 · (P21)` → `⊡ v0.25.1 · M8 · (P21)`. The `⊡` glyph already carries
the identity; the word is ~6 columns of redundancy on the most width-pressured line.

### D8 — Remove the session-cost segment

`$1.4` comes out entirely. It is an estimate, it is not actionable mid-session, and the
quota bars now answer the question it was gesturing at — with the number that actually
binds.

D7 and D8 are not cosmetic riders: they fund D1. Always-visible bars cost roughly 24
columns; these two return roughly 12, so the wide line's reflow point moves far less than
it otherwise would.

## Scope

**In:**
- `hooks/_astro-ctx.mjs` — a `renderRateLimits({ rateLimits, width|detail })` helper
  alongside `renderClaudeSegment`, reusing `progressBar`, the ANSI ramp and `paint`.
- `hooks/astro-statusline.mjs` — read `data.rate_limits`, place the segment, apply D4's
  sort-and-shed, drop the cost segment.
- `renderSegmentParts` — D7's label removal.
- `tests/statusline.test.mjs` — new coverage for every D above, plus the updates D7/D8
  force (see open question 2).

**Out:**
- Any monthly window. It does not exist.
- Persisting or trending usage over time — this is a gauge, not a history. `ac stats`
  already owns token accounting.
- Reading quota from anywhere other than the stdin blob. No API calls, no scraping, no
  cache: the statusline runs on every render and must stay instant.
- Changing `packStatus`'s contract (whole segments dropped, never sliced; unknown width
  means roomy). D4 shapes what the rate-limit segment *offers* at each detail level; it
  must not teach `packStatus` a new kind of reordering.

## Open questions for the planner

1. **`⊡` with no version.** Today a missing `ctx.version` renders `⊡ astro · M1`. After D7
   that becomes `⊡ · M1`, which reads as a rendering bug. Decide the fallback and cover it.
2. **`tests/statusline.test.mjs` asserts `⊡ astro` in at least 5 places** (lines ~79, 91,
   94, 341, 368). These must be **updated**, never deleted — they are the guard that the
   identity mark renders at all, and dropping them to make D7 pass would remove coverage
   rather than move it.
3. **Is `data.cost` read anywhere else?** D8 removes it from the statusline; check the
   banner and PreCompact paths before deleting the read.
4. **Width budget.** Confirm the wide single line still fits a typical 110-column terminal
   with both bars present, and that the first reflow point has not moved below ~100.

## Assumptions

- The segment is simply **absent** before the first API response and for non-subscribers;
  the line reshapes once per session and that is acceptable and truthful. No placeholder,
  no cached last-known value.
- Unknown/oversized width still means "assume roomy" (existing `termWidth` contract).
- `ac statusline preview` will not be taught to fake rate limits in this phase.
