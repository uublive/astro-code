# Acceptance — Phase 21 (human UAT)

Each item names the state that must already exist for it to be checkable (ADR-050).
Items 1–2 need a live Pro/Max session; 3–6 are checkable by piping a blob, since a
non-subscriber session never carries `rate_limits` at all.

**Shared precondition for the piped items:** a terminal in
`/Users/buu/Development/astro-code` (a real astro-code project: `.astrocode/state.json`
and `roadmap.json` present, milestone M8 and phase P21 live), plus:

```sh
NOW=$(date +%s)
mk() { printf '{"session_id":"s1","model":{"id":"claude-opus-4","display_name":"Opus"},"workspace":{"current_dir":"'"$PWD"'"},"cost":{"total_cost_usd":4.2}%s}\n' "${1:+,\"rate_limits\":$1}" > /tmp/uat.json; }
sl() { COLUMNS="$1" node hooks/astro-statusline.mjs < /tmp/uat.json | sed $'s/\x1b\\[[0-9;]*m//g'; }
```

---

1. **The user can see, in a live session, how much of their 5-hour and 7-day quota is
   spent — without asking for it.**
   *Precondition:* a claude.ai Pro/Max session with the statusline installed
   (`ac statusline install`, Claude Code restarted) in which Claude has already answered at
   least once (`rate_limits` only arrives after the first API response).
   The line shows a `5h` and a `7d` entry, each with a bar and a percentage, at whatever
   usage level the account is actually at — including low, quiet numbers.

2. **The user can tell, at a glance, when a window is nearly spent and when it frees up.**
   *Precondition:* the same live session, with one window at or above 85%. That window's
   bar and number are red and it carries a relative time-to-reset (e.g. `2h12m`); the cooler
   window shows a percentage only, in green or yellow.

3. **The user can start a fresh session, or work on a non-subscriber plan, and see a normal
   statusline — no placeholder, no error, no wasted columns.**
   *Precondition:* `mk` with no argument (a blob with no `rate_limits` key — exactly what
   every session sends before its first API response).
   `sl 200` prints one clean line with the `⊡` mark, milestone, phase and model, and
   nothing quota-related anywhere on it.

4. **The user can trust the gauge when a window is missing or the data is malformed.**
   *Precondition:* `mk '{"five_hour":null,"seven_day":{"used_percentage":"abc"},"spend_limit":{}}'`
   then `mk '{"five_hour":{"used_percentage":30,"resets_at":'$((NOW+7920))'}}'`.
   The first prints a normal line with no quota numbers and no `NaN`/`undefined`/`--%`; the
   second shows exactly the one window it was given.

5. **The user can narrow the terminal and still see the window that is about to stop them.**
   *Precondition:* `mk '{"five_hour":{"used_percentage":10,"resets_at":'$((NOW+7920))'},"seven_day":{"used_percentage":95,"resets_at":'$((NOW+400000))'}}'`
   then `for c in 200 140 110 90 70 50 40; do echo "== $c"; sl $c; done`.
   As the line narrows, the bars go first, then the cool `10%` window — `95%` is the last
   quota fact standing, and nothing is ever cut mid-word. Swapping the two percentages flips
   which one survives.

6. **The user can see the line spend its columns on what matters: no `astro` word, no dollar
   estimate, and the quota still fits a normal terminal.**
   *Precondition:* item 5's payload (which carries `cost.total_cost_usd: 4.2`), plus
   `~/.astro/code/version` present from a real `ac statusline install`.
   The mark reads `⊡ v0.25.x · M8 · (P21)`; no `$4.2` appears at any width in the sweep; and
   `COLUMNS=110 node hooks/astro-statusline.mjs < /tmp/uat.json` is still a single line that
   fits the window.
