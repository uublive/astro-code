alex says his execute tasks are never in parallel, and asking his agents they say

> Yes, it's an astro-code problem. Two parts of astro-code don't agree with each other:
>
> The planner (astro-code's plan-phase) sometimes writes each task's files as - **files:** (plural). That's what DASHBOARD 12 and most of VALUEIZE 72 got.
> Discover (astro-code's execute-phase) only fills in the task's file correctly when the plan says file: (singular). When it sees files:, it writes PLAN.md instead. Its prompt never says what file means, and nothing checks the answer.

Matteo, 2026-10-27. Also observed in astro-code's own phase 52 run (wf_f45d5a43-fa5): its PLAN.md uses singular `- **file:**`, yet Discover returned `"file":"PLAN.md"` for every task and buildWaves logged 28 same-file deferrals.
