# Forge — read path retired (phase 25)

`/astro-discuss`, `/astro-plan`, `/astro-new-project`, `astro-researcher` and
`astro-planner` used to make one opportunistic read against an external knowledge
service here. Phase 25 replaced every one of those calls with `ac principles ask` /
`ac principles brief` — a personal store, local and always available, with no
connect/degrade dance to document. None of those five callers references this file
any more; this stub only still ships (the install path expects it) and exists to say
where the read went, not to define a protocol.

The external import stays dark until the phase-27 import — a later phase's job, not
this one's. Nothing here degrades, connects or probes: there is nothing left to detect.
