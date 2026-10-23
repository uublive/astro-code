canon pull silently deletes hand-written non-ADR prose from DECISIONS.md and reports plain success

Source: debt 2026-09-20-canon-pull-silently-deletes-hand (phase 18 verifier, observed directly),
graduated to this fix by Matteo at the milestone 13 debt triage ("Pay it as a fix").

Recorded observation, verbatim: "appending a hand-written non-ADR paragraph to DECISIONS.md and
running `ac canon pull` left grep -c = 0, with the pull printing only '✓ DECISIONS.md: updated from
astro-registry'. mergeDecisions rebuilds the file as remoteText plus entries recognised by the
^##\s+(ADR-\d+) heading scan, so anything outside a heading block is dropped. [...] partly inherent,
since the local preamble is replaced by the registry's on every pull, which is the mirror semantics
convergence requires. [...] A warning naming the discarded text would be enough."
