# Phase 53 — success criteria (pre-registered, plan-blind)

Shared fixture for the criteria below (build it in a scratch dir under the OS temp dir, never in
this repo): `AC="node /Users/buu/Development/astro-code/bin/ac.mjs"`; a real bare git remote and two
working copies of it, `alice` and `bob`, each an astro-code project (`$AC init`, `$AC registry init`
from one of them) on its own feature branch off a shared default branch. "ADR project" means the
default branch also carries an ADR folder of `NNNN-<slug>.md` files (e.g. `docs/adr/0001-…` to
`docs/adr/0010-…`). "Claimed" means the registry on the remote's orphan branch records the number,
so the other working copy cannot be issued it.

### C1 — Two developers on separate branches adding a decision at the same time get different numbers, each written to both stores under that one number
- **Observe:** in an ADR project whose folder tops out at 0010 (DECISIONS.md lower), run
  `$AC decision add "Alice choice" --why "a"` in `alice` and `$AC decision add "Bob choice" --why "b"`
  in `bob` concurrently (`&` + `wait`), neither pulling the other's branch. Both exit 0. Each working
  copy now has exactly one new `docs/adr/<N>-<slug>.md` AND one new DECISIONS.md entry whose heading
  carries the same `<N>` (same width as the folder's existing files); Alice's `<N>` differs from Bob's;
  both are above 0010. Merging both branches into the default branch leaves no number used by two
  different decisions in either store.
- **Fails if:** the two copies get the same number (the max+1-on-my-branch collision); either copy
  writes only one of the two stores; the file's number and the DECISIONS.md heading's number differ;
  a new number is at or below an existing one in either store; or one concurrent add fails instead of
  retrying.

### C2 — The ADR folder and number width are detected from the project's own files, overridable by config, and reported; a project without one keeps DECISIONS.md-only behaviour
- **Observe:** (a) a project whose ADR folder is `adr/` holding 3-digit `NNN-*.md` files: `ac decision
  add` writes `adr/<NNN>-<slug>.md` with a 3-digit number and says which folder it used and why
  (detected vs configured). (b) `$AC config set decisions.adr_dir <other-dir>` then `ac decision add`
  writes the file into `<other-dir>`. (c) turning the setting off (the documented "off" value) then
  `ac decision add` writes only the DECISIONS.md entry and no ADR file. (d) a project with no ADR folder
  and no setting: `ac decision add` writes the DECISIONS.md entry in today's shape and creates no folder
  or ADR file anywhere.
- **Fails if:** width or folder is hard-coded (a 4-digit file in a 3-digit project, a file in
  `docs/adr` when the project uses `adr/`); the config override is ignored or cannot turn the feature
  off; output does not say which folder was chosen and on what basis; or a project without an ADR folder
  gains a folder, a file, or a changed DECISIONS.md entry shape.

### C3 — With canon-guard on, writing an ADR file or an ADR heading under an unclaimed number is refused at write time, while claimed numbers stay editable
- **Observe:** in an ADR project with canon-guard enabled, drive the registered canon-guard hook the way
  Claude Code does (PreToolUse JSON on stdin, cwd in the project — as the existing canon-guard tests
  do): (a) a Write creating `docs/adr/0150-x.md` (0150 never claimed) is denied, and the reason names
  the claim command to use instead; (b) an Edit adding a `## ADR-0150 — …` heading to DECISIONS.md is
  denied; (c) an obvious Bash write of the same file (`cat > docs/adr/0150-x.md`, within the guard's
  existing Bash scope) is denied; (d) an Edit to the body of an existing ADR file whose number IS
  claimed, and a Write of a file under a number just claimed by `ac decision add`, are allowed;
  (e) with canon-guard disabled, (a)–(c) are allowed.
- **Fails if:** an unclaimed-number file or heading is let through with the guard on; an edit to an
  already-claimed ADR (its body, a typo in its title) is refused; the deny gives no fix; or the guard
  refuses anything with the switch off.

### C4 — `ac canon check` and `ac doctor` each report unclaimed, duplicate, old-series and mismatched ADRs, one line each with its fix command, without writing anything
- **Observe:** seed an ADR project (bypassing the guard) with: an ADR file under a number never claimed;
  two different ADR files sharing one number; a DECISIONS.md heading in the old log series (`ADR-0xx`,
  3-digit) after the migration ran; and an ADR file whose number matches a DECISIONS.md entry with a
  different decision (title disagrees). Run `$AC canon check` and `$AC doctor` (and `$AC doctor --json`).
  Each of the four problems appears as its own row naming the offending file/heading and a concrete fix
  command (e.g. a renumber or claim invocation); `ac doctor` exits 1 and every failing JSON row has
  `fix` set. On the same project with the seeds removed, neither reports an ADR problem (doctor's ADR /
  registry row is ok). Before/after `git status --porcelain` and the remote registry tip are unchanged by
  both commands.
- **Fails if:** any of the four kinds goes unreported by either command; two different files sharing a
  number are reported as one or not at all; a row has no fix command; a clean project is flagged; or
  either command writes, claims, renumbers or relabels anything.

### C5 — The upgrade backfill claims every existing number, relabels the old decision-log series to D-NNN once with its references, and renumbers nothing else
- **Observe:** build an ADR project as it would exist before this phase: `docs/adr/0001…0010` (with two
  different files both numbered 0007), and a DECISIONS.md log series `ADR-001…ADR-006` holding different
  decisions from the folder, except one entry that is the same decision as `docs/adr/0003` (identical
  title); a doc file citing `ADR-002` (3-digit, meaning the log entry) and `ADR-0002` (meaning the
  folder file). Run the upgrade/backfill step the MANUAL documents. Then: the log entries become
  `D-001…` (the mirror of 0003 keeps the file's number instead), the `ADR-002` citation becomes `D-002`,
  the `ADR-0002` citation and every ADR file name and number are unchanged; the duplicate 0007 is
  reported with the renumber command; the next `ac decision add` from either clone gets 0011. Running the
  step a second time changes no file and claims nothing new.
- **Fails if:** a new claim reissues any number already on the default branch; any ADR file is
  renamed/renumbered; a folder reference (`ADR-0002`) is rewritten to the D-series or a log reference
  (`ADR-002`) is left as ADR; the mirrored entry is relabelled away from its file's number; the duplicate
  goes unreported; or a second run relabels again (e.g. `D-D-001`) or alters anything.

### C6 — `ac decision renumber` moves one decision to a fresh claimed number and rewrites only the references its own branch added, listing what it touched and what it could not attribute
- **Observe:** reproduce the collision: `alice`'s branch and `bob`'s branch each add a different ADR
  numbered 0042 (written before the guard, or otherwise colliding) plus lines in other files citing
  `ADR-0042` meaning their own; merge both into the default branch; also add, in a separate commit on
  the default branch after the merge, one more `ADR-0042` citation. Run `$AC decision renumber <bob's
  0042 file> <new>` (or the documented next-free form). Afterwards Bob's ADR file name, its heading and
  its DECISIONS.md entry carry one new number that is claimed (the other clone's next `ac decision add`
  does not get it) and used by nothing else; every citation line Bob's branch added now names the new
  number; every citation Alice's branch added still reads 0042; the post-merge citation is NOT rewritten
  and is listed for a human; the output lists every file it changed. Passing a `<new>` that is already
  used or claimed is refused with nothing changed.
- **Fails if:** Alice's references are rewritten, or Bob's are left behind; an unattributable reference
  is guessed (rewritten either way) instead of listed; the new number is unclaimed or collides; the file,
  heading and DECISIONS.md entry disagree after the move; a touched file is missing from the listing; or
  more than the one named decision is renumbered.

### C7 — A claim never silently degrades to a local guess when the registry cannot be reached
- **Observe:** in an ADR project, point the remote at an unreachable path (or remove the bare repo) and
  run `$AC decision add "x" --why "y"`. It exits non-zero with a message about the registry, and neither
  a DECISIONS.md entry nor an ADR file was written (`git status --porcelain` unchanged).
- **Fails if:** it falls back to computing the next number locally and writes either store, or exits 0.

### C8 — Planner and executor instructions route every new decision through the claim and never tell an agent to compute the next number or hand-write an ADR file
- **Observe:** read the agent-facing text a planner and an executor are given (the shipped
  `commands/`, `agents/` and the prompt strings in `workflows/` scripts, plus the AGENTS.md seed a
  project receives). Every place that tells an agent to record a decision or ADR directs it to the
  claiming command; no place instructs picking "highest + 1", reading the folder for the next number, or
  creating `<adr_dir>/NNNN-*.md` directly. The MANUAL documents the claim, the guard rule, the reports,
  the backfill/relabel and renumber.
- **Fails if:** any planner/executor-facing instruction still allows or describes computing the number
  or writing an ADR file by hand, or the claim instruction appears only where planners/executors never
  read it.

### C9 — Projects without an ADR folder are untouched by the migration, and the full suite stays green
- **Observe:** copy a project with no ADR folder whose DECISIONS.md uses the `ADR-NNN` series (e.g. a
  copy of this repo's `.astrocode/`) and run the upgrade/backfill step and `$AC canon check`: DECISIONS.md
  is byte-identical afterwards, no `D-NNN` relabel happens, no ADR problems are reported. Run
  `node --test` at the repo root: it exits 0, and the run includes a test using a real bare remote with
  two working copies on separate branches.
- **Fails if:** the relabel or any rewrite touches a project that has no ADR folder (astro-code's own
  `ADR-0xx` log would become `D-0xx`); `ac canon check` flags a plain DECISIONS.md-only project; or any
  test fails.
