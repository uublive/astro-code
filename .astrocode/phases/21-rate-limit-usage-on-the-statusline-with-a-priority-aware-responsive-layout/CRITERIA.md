# Criteria — Phase 21: rate-limit usage on the statusline, priority-aware responsive layout

> Pre-registered, plan-blind. Derived from the phase goal + CONTEXT.md + project canon.
> Every criterion is an observable outcome of the finished statusline; a different-but-valid
> implementation of the same goal must still satisfy all of them.

**Shared harness** (every `Observe:` below assumes it). All commands run from
`/Users/buu/Development/astro-code`. The statusline is driven end-to-end exactly as Claude
Code drives it — a JSON blob on stdin, `COLUMNS` as the only width signal:

```sh
cd /Users/buu/Development/astro-code
NOW=$(date +%s); R5=$((NOW+7920)); R7=$((NOW+400000))       # +2h12m, +4.6d
sl() {  # sl <COLUMNS> <payload-file>  -> ANSI-stripped output
  COLUMNS="$1" node hooks/astro-statusline.mjs < "$2" | sed $'s/\x1b\\[[0-9;]*m//g'
}
slraw() { COLUMNS="$1" node hooks/astro-statusline.mjs < "$2"; }   # colours kept
```
Payloads are written with a helper, e.g.:
```sh
mk() { # mk <file> <rate_limits-json-or-empty> [extra top-level json]
  printf '{"session_id":"s1","model":{"id":"claude-opus-4","display_name":"Opus"},
"workspace":{"current_dir":"/Users/buu/Development/astro-code"},
"cost":{"total_cost_usd":4.2}%s%s}\n' "${2:+,\"rate_limits\":$2}" "${3:+,$3}" > "$1"; }
```

---

### C1 — When the stdin blob carries rate-limit data, the statusline shows how much of both the 5-hour and the 7-day window is spent, at any usage level, without being asked

- **Observe:** `mk /tmp/c1.json "{\"five_hour\":{\"used_percentage\":23,\"resets_at\":$R5},\"seven_day\":{\"used_percentage\":41,\"resets_at\":$R7}}"` then `sl 200 /tmp/c1.json`. The output must contain both `23%` and `41%`, each attached to a distinct, human-readable marker for its window (the 5-hour one and the 7-day one are told apart by sight, not by order alone), and each accompanied by a filled/empty block progress bar of the same kind the context-fill segment draws. Repeat with `used_percentage` 5 and 8 (both far below any alarm threshold) — both numbers must still appear.
- **Fails if:** the segment is missing or partially missing at low usage (threshold-gated rather than always-on); only one window renders on a 200-column line; the two windows are indistinguishable from each other; a percentage shown does not correspond to the `used_percentage` fed in (off by a factor, inverted to "remaining", or a fraction like `0.23%`); or no bar accompanies the numbers on a wide line.

### C2 — Absence of rate-limit data is a normal, silent state: the statusline renders its usual line and never shows a placeholder or a broken value

- **Observe:** run `sl 200 <p>` for each payload: (a) no `rate_limits` key at all; (b) `{"five_hour":{"used_percentage":30,"resets_at":'$R5'}}` only; (c) `{"seven_day":{"used_percentage":30,"resets_at":'$R7'}}` only; (d) `{"five_hour":null,"seven_day":{"used_percentage":"abc"},"spend_limit":{}}`; (e) empty stdin. Each run exits 0, prints a non-empty line, and still contains the project identity mark and the model name. Cases (a), (d) and (e) must contain no rate-limit numbers at all; (b) and (c) must show exactly the one window supplied. No output from any case contains `NaN`, `undefined`, `null`, `Infinity`, `-`-prefixed percentages, or an empty gauge placeholder such as `--%`.
- **Fails if:** any run is non-zero exit, throws, or prints nothing; a missing/garbage window renders as `NaN%`, `undefined`, `0%` invented from nothing, or a dash placeholder; the presence of one window suppresses the other; or an absent `rate_limits` still costs columns (a stray separator, label or empty bracket).

### C3 — A window at or past the red threshold also tells you when it resets; a cooler window does not

- **Observe:** payload with `five_hour` at 88 (`resets_at` = `$R5`, i.e. 2h12m out) and `seven_day` at 60; `sl 200`. The 5-hour entry must carry a human-readable time-to-reset consistent with 2h12m (e.g. `2h12m` / `2h11m`, a relative duration — never a raw epoch number like `17384…`, never an absolute clock time), and the 7-day entry must carry none. Then sweep `five_hour.used_percentage` over 84, 85, 86: no countdown at 84, countdown at 85 and 86. Finally set `resets_at` to `$((NOW-60))` at 90%: the output must not show a negative or absurd duration.
- **Fails if:** the countdown appears on a sub-red window (noise at 20%), is missing at 85 or above, is printed for every window unconditionally, shows the epoch integer or an absolute timestamp, or goes negative/garbled for an already-passed `resets_at`.

### C4 — The quota gauge and the context-fill gauge mean the same thing at the same colour: yellow from 60, red from 85

- **Observe:** capture the three reference colours the context bar uses via
  `node -e "import('./hooks/_astro-ctx.mjs').then(m=>{for(const t of [50,70,90]) console.log(t, JSON.stringify(m.renderClaudeSegment({model:{id:'x'},tokens:t,limit:100})))})"`.
  Then run `slraw 200` (colours kept) with `five_hour.used_percentage` set to 59, 60, 84, 85 in turn and read the ANSI code immediately preceding the rate-limit bar. 59 must carry the same code as the context bar at 50%; 60 and 84 the same code as 70%; 85 the same code as 90%. The three codes must be mutually distinct.
- **Fails if:** the quota bar is colourless; it switches at a different boundary (50/80, or >60 instead of >=60); it uses a different palette than the context bar so the two bars on one line disagree about what yellow means; or the colour and C3's countdown disagree about where "hot" begins.

### C5 — `spend_limit` renders when present, absent otherwise, and past 100% the bar stops while the number keeps climbing

- **Observe:** (a) payload with `spend_limit` `used_percentage` 62 → `62%` plus a bar appears alongside the windows. (b) `used_percentage` 142 → the output shows `142%` (the real number, not clamped to 100) while the bar's visible glyph count is byte-for-byte the same length as the bar rendered at exactly 100, all cells filled, with no extra/overflowing glyphs:
  `for v in 100 142 500; do mk /tmp/s$v.json "{\"spend_limit\":{\"used_percentage\":$v,\"resets_at\":$R7}}"; sl 200 /tmp/s$v.json; done` — the three bars are identical, the three percentages are not. (c) With no `spend_limit` key the output contains nothing attributable to a spend cap and is no wider than the same payload minus the key.
- **Fails if:** `spend_limit` is ignored when present; the bar grows past its width, wraps, or emits a negative/overflow run of glyphs above 100; the percentage is clamped to `100%` so a blown cap is invisible; or an absent `spend_limit` still costs columns.

### C6 — As the line narrows, what survives is the window nearest its limit — bars go before numbers, and the hottest window goes last

- **Observe:** payload with `five_hour` at 10 and `seven_day` at 95. Sweep width: `for c in 200 160 140 120 100 90 80 70 60 50 40; do echo "== $c"; sl $c /tmp/c6.json; done`. Assert across the whole sweep: (1) there is NO width at which `10%` (the cool 5-hour window) is present while `95%` is absent; (2) at every width where a bar is present, both windows' numbers are present — i.e. no width sheds a number while keeping a bar; (3) rate-limit detail only ever decreases as width decreases (once `95%` is gone at width W it is gone at every width below W); (4) no rendered rate-limit fragment is cut mid-token (no lone `9`, `%`, dangling label or truncated bar inside the quota segment). Re-run with the percentages swapped (5h at 95, 7d at 10) — the surviving window must flip accordingly.
- **Fails if:** a fixed 5h→7d drop order keeps a 10% window while hiding a 95% one at any width; a bar survives a width at which a number was dropped; detail reappears as the screen shrinks; the quota segment is sliced rather than dropped whole; or the surviving window is the same one regardless of which is hotter.

### C7 — The line stops spending columns on non-actionable text: no `astro` word in the identity mark, no session dollar estimate, and the mark still reads correctly with no version

- **Observe:** (a) `sl 200` on any payload → the identity mark reads as glyph + version + milestone + phase track (e.g. `⊡ v0.25.1 · M8 · (P21)`) with no standalone word `astro` between the glyph and the version. (b) The payload carries `cost.total_cost_usd: 4.2`; no output at ANY width in the C6 sweep contains a dollar-amount segment (`$4.2`, `$4.20`, or any `$<number>`). (c) Force a missing version with `HOME=$(mktemp -d) COLUMNS=200 node hooks/astro-statusline.mjs < /tmp/c1.json | sed $'s/\x1b\\[[0-9;]*m//g'` → the identity mark must still read as a coherent mark: no leading empty token, no `⊡ ·` / `⊡  ·` dangling separator, no doubled separator, no empty `v`.
- **Fails if:** the redundant word is still rendered; a dollar cost appears at any width; or the no-version render produces a dangling/empty identity token that reads as a rendering bug.

### C8 — The wide line with both quota bars present still fits a typical terminal, and no row ever overruns the width it was given

- **Observe:** with the C1 payload (both windows present, model, branch and project state all rendering), `COLUMNS=110 node hooks/astro-statusline.mjs < /tmp/c1.json` must emit exactly ONE line whose ANSI-stripped visible width is <= 110. Then for `c` in 200 160 140 120 110 100 90 80 70 60 50 40 30: every emitted row's ANSI-stripped visible width must be <= `c`, and every row must be non-empty. Also confirm the single line still fits at `COLUMNS=100`.
- **Fails if:** the 110-column render splits into rows, any row exceeds its COLUMNS budget (the new bars overflow and wrap in a real terminal), the quota segment forces the first reflow above ~100 columns, or a row comes back empty at a narrow width.

### C9 — The behaviour above is actually guarded by the suite: the tests pass, and they fail when the identity mark or the quota segment is broken

- **Observe:** `node --test tests/` exits 0 with no failing tests. Then, in a throwaway copy (`cp -a . /tmp/mut && cd /tmp/mut`, never in the repo): (a) break the identity mark — make the project identity render as an empty string — and confirm `node --test tests/statusline.test.mjs` now FAILS; (b) restore, then break the quota segment — make rate-limit data render nothing even when present — and confirm `node --test tests/statusline.test.mjs` now FAILS. Both mutations must be detected.
- **Fails if:** the suite is red on HEAD; suppressing the identity mark leaves the suite green (the pre-existing identity coverage was deleted rather than updated to the new mark); or suppressing the rate-limit segment leaves the suite green (the new behaviour ships untested).
