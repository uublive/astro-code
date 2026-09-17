# CRITERIA — Phase 12: Kit conversion command (source → standard kit)

Pre-registered, plan-blind. Each criterion is an observable outcome a different-but-valid
implementation of the goal must still satisfy. The verifier checks these with only
Read / Bash / Grep / Glob against independently gathered evidence.

For every criterion below that inspects "the converted kit", the target is the worked
conversion the phase must ship for parity to be provable at all: a real sample source, its
golden fixtures (the source's captured real outputs on representative inputs), and the
Astro kit produced from it. Locate it under the repo (a sibling kit project directory
containing `kit.json`, `tools/`, and golden parity fixtures). If no such runnable worked
conversion exists, criteria that depend on it FAIL — an un-demonstrated converter cannot
prove parity.

---

### C1 — The converted kit self-checks parity by actually running itself and comparing to the source's captured outputs
- **Observe:** In the converted kit, run its parity-check step (the stdlib parity harness
  shipped under the kit's `tools/`, invoked as documented) with the shipped golden fixtures
  unmodified. It must exit 0 AND its report must show it executed the kit on each fixture
  input and compared the produced output against the recorded source output (fixture count
  > 0, each marked matched). Confirm real execution by deleting/renaming the kit's produced
  output artifact for one run: the harness must then NOT report that fixture as matched.
- **Fails if:** it exits 0 without producing per-fixture comparison evidence, passes with
  zero fixtures, or reports a match when the kit produced no output (an always-pass stub).

### C2 — Parity fails, non-zero, on any real semantic divergence from the source's outputs
- **Observe:** Take a passing fixture and alter a semantically meaningful value in the
  recorded source output (a payload number/string that is not a declared-benign field). Run
  the parity-check step. It must exit non-zero and name the diverging fixture/field.
- **Fails if:** it still exits 0, or its exit code does not distinguish match from mismatch
  (parity is asserted but never actually measured — the Terminal-Bench false-PASS mode).

### C3 — Normalization tolerates only declared benign nondeterminism and cannot silently mask a real difference
- **Observe:** Produce two runs of the kit that differ ONLY in declared-benign fields
  (timestamps, run ids, temp paths, unordered collection order): parity must pass. Then make
  outputs differ in a field NOT on the declared normalization list: parity must fail. The
  set of fields the harness normalized must be surfaced in its output/report or a declared
  fixture manifest — not hidden inside the diff logic.
- **Fails if:** a benign-only difference causes a false FAIL; OR broadening normalization
  (e.g. numeric rounding, whitespace collapse, wholesale field-stripping) lets a changed
  real payload value still PASS; OR the normalized field set is not discoverable/declared.

### C4 — The converted kit is a valid, buildable, self-contained kit
- **Observe:** In the converted kit run `python3 tools/validate_manifest.py kit.json`
  (exit 0) and `./tools/build_kit.sh` (exit 0, producing `dist/kit.zip`). Every tool
  dependency declared in `kit.json` must resolve to a single exact version (a pinned
  `==x.y.z`/fixed ref, never a range or unpinned name), the runtime must be `python3`, and
  at most one deliverable may carry the `email_attachment` tag.
- **Fails if:** validate or build exits non-zero, no zip is produced, any dependency is
  unpinned or version-ranged, or more than one `email_attachment` is declared.

### C5 — The kit runs to parity self-contained — no hidden network or secret dependency at runtime
- **Observe:** Run the kit's parity-check end-to-end with outbound network unavailable and
  no source-specific secret env vars set (e.g. run under a no-network shell / unset the
  relevant credentials). It must still complete and pass on the self-contained fixtures.
- **Fails if:** the kit reaches out to the network, requires a secret/credential, or fails
  when those are absent — i.e. a non-self-contained part was silently wired in rather than
  reproduced or flagged.

### C6 — Capabilities that could not be made self-contained are surfaced as explicit flagged follow-ups, not dropped
- **Observe:** Identify a capability of the sample source that is infra/network/secret-bound
  (i.e. excluded from the self-contained kit under C5). It must appear in the converted
  kit's project record as an explicit manual follow-up (a flagged requirement/note stating
  it is deferred and why). Cross-check the source's capabilities against the kit: nothing
  the source did is both absent from the kit AND absent from the flagged follow-up list.
- **Fails if:** a source capability is missing from the kit with no corresponding flagged
  follow-up (silently dropped), or a non-self-contained part is presented as delivered.

### C7 — Auto-derived manifest matches the source; the interview covers only genuine gaps
- **Observe:** Compare the converted kit's `kit.json` against the sample source's own
  declarations: the kit's tool dependencies must be exactly the source's pinned dependency
  set (from its `requirements.txt`/`package.json`/imports, pinned per C4), and the kit's
  declared output artifacts must correspond to the files the source actually produces on the
  fixture inputs. Fields that the source does not express (e.g. category, triggers, which
  single deliverable is the `email_attachment`) are the only ones without a source-derivable
  origin.
- **Fails if:** a dependency or produced-output artifact the source clearly declares/produces
  is wrong or missing in `kit.json`, or a field that IS derivable from the source was left as
  an unfilled placeholder / invented rather than derived.
