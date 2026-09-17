# ACCEPTANCE — Phase 12: Kit conversion command (source → standard kit)

User-facing UAT checklist. A human confirms each before the phase closes (acceptance, not unit tests).

- [ ] The user can run `/astro-kit-convert <source path>` and get a standalone Astro kit project
      scaffolded from the source, with kit id / description / dependencies / output artifacts
      auto-derived and only genuine gaps (plus which single deliverable is the email attachment) asked.

- [ ] The user is shown a proposed capability map derived from the source's real entrypoints and
      confirms/selects it before the kit is built (one kit = one coherent capability).

- [ ] The user can run the shipped parity harness in the converted kit
      (`python3 tools/parity_check.py --manifest tools/parity/parity.json`) and watch it execute the kit
      on each golden fixture and report, per fixture, that the kit's output matches the source's captured
      output — with the count of fixtures shown.

- [ ] The user sees that changing a real output value makes parity FAIL (non-zero, naming the field),
      while only the explicitly declared benign fields (timestamps, run ids, ordering — surfaced in the
      report) are normalized away.

- [ ] The user can validate and build the converted kit
      (`python3 tools/validate_manifest.py kit.json` and `./tools/build_kit.sh` both succeed, producing
      `dist/kit.zip`), with every dependency an exact pin and runtime `python3`.

- [ ] The user can run the converted kit to parity with the network off and no source secrets set, and
      it still passes on the self-contained fixtures.

- [ ] The user can find each source capability that could not be made self-contained
      (e.g. the webhook/secret publish path) listed as an explicit flagged manual follow-up in the kit's
      project record — nothing the source did is silently dropped.

- [ ] The user can see `/astro-kit-convert` listed in `/astro-help` and in the README next to the other
      kit commands.
