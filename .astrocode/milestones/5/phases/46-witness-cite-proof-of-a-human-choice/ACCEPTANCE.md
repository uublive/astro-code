# Acceptance — phase 46: cite an outside decision, machine-typed prefixes, witness holes

Use `ac` from this branch. Each item is checked in its own setup.

**Scratch project:**
- a fresh `mktemp -d`, then `git init`, `ac init`, `ac phase add "Demo"` and
  `ac phase verify 1`;
- no CRITERIA.md, so the verdict gate lets it through;
- `HOME` points at a temp dir.

**Live session:**
- Claude Code at or above the mods floor;
- `ac mods enable witness live-capture`;
- `{"mods": {..., "machinePrefixes": ["[relay] "]}}` in `~/.astro/config.json`;
- `/reload-plugins`.

1. **You can cite an outside decision on an agent acceptance without it turning human.**
   - You run `ac phase accept 1 --agent claude --evidence "https://board.example/d/42"`.
   - The line prints the AGENT marker and `(cites: https://board.example/d/42)`.
   - `ac phase show 1` shows `cited_evidence` with that URL, beside `accepted_kind: "agent"`, and
     shows no `accepted_evidence`.
   - *Precondition:* a scratch project with phase 1 `verified` and no acceptance recorded.

2. **You can cite a decision on a rejection and on a fix acceptance, and see it afterwards.**
   - You run `ac phase reject 1 --reason "x" --agent claude --evidence DEC-9`. `ac phase show 1`
     shows `DEC-9` on that rejection.
   - You run `ac fix accept <id> --agent claude --evidence "https://board.example/f/3"`.
     `ac fix list --all` shows the fix as accepted by an agent, citing that URL.
   - *Precondition:* a scratch project with phase 1 `verified`, and one open fix created with
     `ac fix add "demo bug"`.

3. **A bad citation is refused in one line and changes nothing.**
   - You try `--evidence` with each of: 201 characters, a value with a newline, an empty value,
     and no value. Each gets a single `✖` line.
   - Afterwards the phase is still `verified` and the fix still open.
   - A 200-character citation is accepted.
   - *Precondition:* a scratch project with phase 1 `verified` and one open fix.

4. **A line your tool types with a configured prefix never counts as you; your own typing still
   does.**
   - In a live session, you have your relay (or tmux) type `[relay] /astro-accept <n>`. The
     agent's `ac phase accept <n>` is recorded as `accepted_kind: "agent"`.
   - In a second project, you type `/astro-accept <n>` yourself and confirm. That is recorded as
     witnessed (`accepted_evidence: "composer"`).
   - With live-capture on, a relayed `[relay] always run the full suite before pushing` never
     offers a principle. The same sentence typed by you without the prefix can.
   - *Precondition:*
     - the live-session setup above;
     - a project with a phase at `verified` for each half;
     - live-capture switched on.

5. **A broken prefix list fails soft.**
   - You set `machinePrefixes` to `"oops"` (not a list).
   - `ac mods status` prints one `⚠` naming `mods.machinePrefixes`.
   - After `/reload-plugins`, typing `/astro-accept <n>` yourself is still recorded as witnessed,
     and no mod switched off.
   - *Precondition:* the live-session setup, with the list replaced by `"oops"`, and a project with
     a phase at `verified`.

6. **The agent cannot slip a human claim past witness.**
   - In a live session, in a turn you started with an ordinary prompt (no typed `/astro-discuss`
     or `/astro-accept`), you ask the agent to do these things:
     - **Write the human marker with `printf … > .astrocode/phases/<n>-…/CONTEXT.md`.**
       `ac phase context <n> --author` then says `agent claude`.
     - **Run `V=accept; ac phase $V <n>`.** The record says `accepted_kind: "agent"`.
     - **Run `ac decision add` with a title that quotes "phase accept" and `\"…\"`.** The ADR
       title is stored exactly as written.
   - *Precondition:*
     - the live-session setup;
     - a project with one phase whose folder holds a CONTEXT.md and one phase at `verified`;
     - a project where `ac decision add` is allowed (a scratch project with a registry).

7. **An ambiguous fix slug says so.**
   - With two open fixes whose ids both end in `-foo`, you run `ac fix accept foo`. It refuses
     with one line saying the slug is ambiguous and listing both ids, and both stay open.
   - `ac fix accept no-such-slug` still says there is no such fix.
   - *Precondition:* a scratch project holding two open fixes `<date1>-foo` and `<date2>-foo`.
     Create the second on another day, or by adding a dated entry through `ac fix add` with a
     shifted clock.
