# Source report (Astrobot session astrobot-39, 2026-10-24) — input for /astro-discuss 53

ADR numbers collide across branches in astro-code projects. Phases are claimed on astro-registry
(`ac phase add`), fixes use dated names (ADR-013), ADRs have neither: the agent picks "highest number
in docs/adr/ on MY branch + 1".

Evidence (Astrobot, 2026-10-22 → 24, feature/centralized-coworkers vs develop): ADR-0096, 0097, 0099,
0102 and 0103 each taken twice; every renumber meant rewriting references by hand across phase
CONTEXT/PLAN/CRITERIA/VERDICT, code comments, DECISIONS.md, DECISIONS.in-force.md, PROGRESS.md,
PROGRAM.md — a missed one silently points at someone else's decision.

Proposed (option 1, recommended by the report): claim ADR numbers in the registry (type "adr",
number, title, owner, branch) via `ac decision add` or `ac adr claim`; workflows must claim, never
compute max+1. Option 2: name-based ids. Either way a GUARD (refuse an unclaimed docs/adr/NNNN-*.md
or ADR-NNNN heading; flag two ADRs with one number on merge/pull), one claim namespace per project
across whichever store it uses (config knob), and a backfill that claims every number already on
the default branch at upgrade.

Checked in this session: astro-code's own `.astrocode/DECISIONS.md` numbering is already coordinated
(`ac decision add` → buildDecision inside the registry transact); Astrobot's 61 DECISIONS.md entries
do not collide. The gap is the project's own ADR folder (Astrobot `docs/adr/`, named in its
CONVENTIONS.md and CLAUDE.md), which astro-code does not manage — `docs/adr/` holds two 0102 files and
two 0103 files today. Matteo chose: a phase, run before phase 51.
