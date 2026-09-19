<!-- pre-registered before any plan exists; derived from the phase goal + CONTEXT.md + project canon -->

# Success criteria — Phase 18: Canon sync never destroys or duplicates local canon

Every criterion below is about **observable behaviour of the finished commands**, not about
how they are built. Any implementation that satisfies the goal must satisfy all of them.

## Shared harness (used by most criteria)

Flag/verb *names* are the planner's choice (CONTEXT leaves them open). Discover them first:

```bash
AC=/Users/buu/Development/astro-code/bin/ac.mjs
node "$AC" help            # find: the force flag on pull, and the duplicate-repair verb
```

Stand up a real bare remote and two independent working copies (the project's own
`registry.test.mjs` pattern — real git, no stubs):

```bash
AC=/Users/buu/Development/astro-code/bin/ac.mjs
BARE=$(mktemp -d)/origin.git; git init -q --bare "$BARE"
mkwork(){ d=$(mktemp -d); ( cd "$d" && git init -q && git config user.email "$1@e.x" \
  && git config user.name "$1" && git remote add origin "$BARE" \
  && node "$AC" init --name "proj-$1" >/dev/null ); echo "$d"; }
A=$(mkwork alice); B=$(mkwork bob)
( cd "$A" && node "$AC" registry init >/dev/null )
```

Throughout, "unchanged" means **byte-identical** (`shasum` / `cmp` before and after), and
"distinguishable" means an automated caller can tell the two cases apart (different exit
status, or output that is not byte-identical), because *both* production incidents were
silent precisely because the printed line was identical either way.

---

### C1 — A pull whose registry copy differs from the local `CONVENTIONS.md` leaves the local file byte-identical and names the way forward

- **Observe:** In `$A`, edit `.astrocode/CONVENTIONS.md` (e.g. append a rule line
  `- Max 300 lines per file.`) and publish it (`node "$AC" canon push`). In `$B`, run
  `node "$AC" canon pull` once so `$B` matches the registry, then edit `$B`'s
  `.astrocode/CONVENTIONS.md` differently (append `- Max 120 lines per file.`). Record
  `shasum $B/.astrocode/CONVENTIONS.md`, run `node "$AC" canon pull` in `$B`, capture
  stdout+stderr and exit status. Expect: the shasum is **identical** afterwards; the local
  edit `- Max 120 lines per file.` is still present verbatim; the output states that
  `CONVENTIONS.md` was **not** overwritten and mentions **both** supported ways out
  (publishing the local copy, and an explicit force that takes the registry's); and the run
  is distinguishable from a clean pull (compare against the C9 no-op/clean-pull output).
- **Fails if:** the local file's bytes change at all; or the local edit is gone; or the run
  prints a success line indistinguishable from a normal pull; or the message does not name
  both an "publish mine" and an "explicit force" route; or `CONVENTIONS.md` now contains
  git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) or any interleaved three-way merge
  of the two versions — the file every agent reads as canon must never carry merge artifacts.

### C2 — Both advertised escapes from a refusal actually resolve it — no dead end

- **Observe:** From the C1 end state (a refused pull in `$B`): (a) run the documented force
  form of `node "$AC" canon pull` in `$B` → `$B/.astrocode/CONVENTIONS.md` becomes
  byte-identical to `$A`'s published copy, and the output says the local copy was replaced;
  (b) reset `$B` to the diverged state, instead run `node "$AC" canon push` in `$B`, then
  `node "$AC" canon pull` in `$B` → the pull now completes without refusing and `$B`'s file
  still contains `- Max 120 lines per file.`; a subsequent `node "$AC" canon pull` in `$A`
  brings `$A` to `$B`'s published content.
- **Fails if:** the force route does not exist or leaves the file unchanged; or after
  pushing, pull still refuses (the user is stuck in a loop with no exit); or the force route
  is reachable without an explicit opt-in (i.e. a plain `canon pull` overwrote in C1).

### C3 — The same decision recorded independently on two machines ends up as exactly ONE entry

- **Observe:** In `$A`: `node "$AC" decision add "Never hand-edit state.json" --why "locks"`.
  In `$B` (which has never seen it), craft the *same* decision locally in
  `$B/.astrocode/DECISIONS.md` under a **different ADR number**, a **different `_date_`
  stamp**, and a heading written with a plain hyphen instead of an em dash — same title, same
  body text. Run `node "$AC" canon pull` in `$B`, then `node "$AC" decision add "Something
  else"` in `$B`. Expect: `grep -c "Never hand-edit state.json" $B/.astrocode/DECISIONS.md`
  is `1`, and the same count is `1` in `$A` after `node "$AC" canon pull`. Repeat the whole
  thing with only the `_date_` line differing, and again with only the dash style differing —
  each must still yield exactly one entry. Also confirm a genuinely local-only decision in
  `$B` (a title neither side shares) still survives the pull and is reported.
- **Fails if:** any of the three variants leaves two entries with the same title (the ADR-142
  false positive); or convergence is achieved by deleting a local-only decision the registry
  has never seen; or the duplicate is produced on the `decision add` path even though `pull`
  is clean (both writers must use the same identity rule).

### C4 — Decisions that merely *resemble* each other are never merged — strict equality only

- **Observe:** In `$B/.astrocode/DECISIONS.md` place two entries whose titles are identical
  and whose bodies differ by a single meaningful word (e.g. `**Why:** locks prevent races` vs
  `**Why:** locks prevent retries`), under different ADR numbers. Run `node "$AC" canon pull`
  and then the explicit duplicate-repair verb. Expect: **both** entries are still present,
  with both bodies intact, after each command. Repeat with two entries sharing a body but
  differing by one word in the title — both survive.
- **Fails if:** either command collapses, merges, or rewrites the pair; or the repair verb
  offers/applies a "close enough" match; or any similarity score, edit distance, or model
  judgement decides two entries are the same (only exact match after normalization may).

### C5 — A genuine same-id/different-content collision stops and reports both; no ADR number anywhere is ever changed

- **Observe:** Make `$A` publish `ADR-007 — Use worktrees` via `decision add`, and give `$B`
  a locally-written `ADR-007 — Ban worktrees` with different body text. Record every ADR
  heading on both sides (`grep -o '^## ADR-[0-9]*' … | sort`) and the registry's copy. Run
  `node "$AC" canon pull` in `$B`, then `node "$AC" decision add "Unrelated"` in `$B`.
  Expect: after both commands the heading sets on both sides are **identical to before**; no
  new renumbered copy of either colliding entry appeared; the output names **both** colliding
  decisions (the local one and the registry one) and explains the collision; the run is
  distinguishable from a clean pull.
- **Fails if:** a new `ADR-0NN` heading appears carrying a renumbered copy of the local entry;
  or the local `ADR-007` body is replaced by the registry's (or vice versa); or either command
  reports plain success; or the message mentions only one of the two decisions.

### C6 — Editing an already-published decision is refused and the refusal teaches supersession

- **Observe:** In `$A`: `node "$AC" decision add "Registry is CAS-based"`. In `$B`:
  `node "$AC" canon pull`, then edit the body of that ADR in `$B/.astrocode/DECISIONS.md`
  (change a sentence; keep the id and title). Run `node "$AC" canon pull` and
  `node "$AC" decision add "Unrelated two"` in `$B`, then `node "$AC" canon pull` in `$A`.
  Expect: `$B`'s edited text is still on disk (not silently reverted); `$A`'s copy and the
  registry copy still hold the original text (the edit was not silently published over
  anyone); the output refuses and states the supported path — record a **new decision that
  supersedes** the old one — in words a user can act on.
- **Fails if:** the edit is accepted as a last-writer-wins update to the published entry; or
  the edit is silently discarded on pull; or it is absorbed as a second entry/renumbered copy;
  or the message refuses without naming supersession as the supported path.

### C7 — Recording a decision also publishes `CONVENTIONS.md`, so a local convention edit is never reverted by the next pull

- **Observe:** In `$A`, edit `.astrocode/CONVENTIONS.md` (append `- Max 300 lines per file.`)
  **without** running `canon push`, then run `node "$AC" decision add "Cap file length"`.
  Then in `$B` run `node "$AC" canon pull` → `$B/.astrocode/CONVENTIONS.md` contains
  `- Max 300 lines per file.`. Then in `$A` run `node "$AC" canon pull` twice → the line is
  still present both times and `$A`'s file is byte-identical across both runs. (If the
  implementation publishes only when the file differs, the second `decision add` with no
  convention change must still leave the registry holding the edit.)
- **Fails if:** after `decision add` the registry copy is still the old text, so the next
  pull in `$A` reverts `- Max 300 lines per file.` (the exact production incident); or `$B`
  never receives the edit; or publishing happens but destroys an unrelated concurrent
  convention change made by `$B` without any warning.

### C8 — Existing duplicated canon is reported on every sync, and collapsed only when explicitly asked

- **Observe:** In `$B/.astrocode/DECISIONS.md` plant two **content-identical** entries (same
  title and body, different numbers and `_date_` lines). Run `node "$AC" canon pull`. Expect:
  the output names the duplicated pair (both ids) **and** the file still contains both entries
  — nothing collapsed. Run pull a second time: it reports the pair again (detection is not
  one-shot). Then run the explicit repair verb: exactly one of the pair remains, the survivor's
  body is intact, and the output says which id was removed. Finally run the repair verb against
  the near-duplicate pair from C4: both survive.
- **Fails if:** a duplicate pair present on disk is not mentioned by a plain sync; or a plain
  sync collapses them without being asked; or the repair verb removes an entry whose
  normalized content is not an exact match of its twin; or repair leaves the file with zero
  copies of the decision.

### C9 — Pull says, per file, what it changed versus left alone — and a no-op pull says so plainly

- **Observe:** With `$B` fully in sync, hash both canon files, run `node "$AC" canon pull`,
  hash again, capture output. Expect: no bytes changed and the output states plainly that
  nothing changed (naming the files as already current). Now publish a change to
  `CONVENTIONS.md` only from `$A`, and run `node "$AC" canon pull` in `$B` again: the output
  must report `CONVENTIONS.md` as **updated** and `DECISIONS.md` as **unchanged**, matching
  the actual hashes. The two runs' outputs must not be byte-identical. Cross-check every
  scenario in C1/C3/C5/C8: for each file, "reported as changed" must agree exactly with
  "its hash changed".
- **Fails if:** the two runs print the same line (`✓ pulled DECISIONS.md, CONVENTIONS.md
  from <branch>` in both cases — the observed incident signature); or a file whose bytes did
  not change is reported as pulled/updated; or a file whose bytes did change is reported as
  unchanged; or the no-op case prints nothing at all.

### C10 — The repository's own suite passes and these behaviours are covered by it

- **Observe:** Run `node --test tests/` from `/Users/buu/Development/astro-code` → all tests
  pass, zero failures. Confirm the suite exercises the refuse-first behaviours against a real
  bare remote by checking that removing the phase's tests changes the pass/fail story: run the
  canon-related test file alone (`node --test tests/<the canon suite>.mjs`) and confirm it
  contains failing-before/passing-after coverage of at least: the diverged-`CONVENTIONS.md`
  refusal, same-decision convergence across date/dash variants, the same-id collision refusal,
  and the duplicate report. Separately, `node bin/ac.mjs debt list` in this repo no longer
  lists the three open `lib/canon.mjs` items named in CONTEXT.md as unresolved.
- **Fails if:** any test fails; or the new behaviours are asserted only through stubs/mocks
  rather than a real git remote (the project's contract-suite standard); or the three debt
  items are still open; or they were closed while the behaviour they describe is still
  reproducible by the observations in C1/C5/C6/C7.
