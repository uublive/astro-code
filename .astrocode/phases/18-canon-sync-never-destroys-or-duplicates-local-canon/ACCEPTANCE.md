# Acceptance — Phase 18: Canon sync never destroys or duplicates local canon

Confirm by hand before the phase closes. Two working copies of a project sharing one remote
(`alice`, `bob`) is the setup for all of it.

- [ ] **The user can edit `CONVENTIONS.md` locally and run `ac canon pull` without losing the
      edit.** The edit is still there, byte-for-byte, and the command says plainly that it did
      **not** overwrite the file — no merge markers, no stray backup copy.
- [ ] **The user can act on the refusal without guessing.** The message names both ways out —
      `ac canon push` to publish their copy, `ac canon pull --force` to take the registry's — and
      both actually work: pushing makes the next pull succeed with the local edit intact, forcing
      replaces the file with the registry's copy and says so.
- [ ] **The user can record the same decision on two machines and end up with one entry.** Same
      title and body, different ADR number, different date stamp, a plain hyphen instead of an em
      dash — after a pull on both sides the decision appears exactly once on each. A decision only
      one machine has still survives and is reported.
- [ ] **The user can trust that nothing is merged on a resemblance.** Two decisions that differ by
      a single word in the title or the body both survive every sync and the repair verb untouched.
- [ ] **The user is stopped, not silently rearranged, when two decisions share a number.** The
      command refuses, names both decisions, and no ADR number anywhere on either side changes —
      so nothing that cites a number by hand starts pointing at the wrong decision.
- [ ] **The user who edits an already-published decision is told the supported path.** The tool
      refuses, their edit stays on disk, the team's copy is untouched, and the message explains
      recording a new decision that supersedes the old one.
- [ ] **The user can edit `CONVENTIONS.md`, run `ac decision add`, and have the edit reach the
      team.** Their teammate's next pull gets it, and their own next pull no longer reverts it —
      the production incident, gone.
- [ ] **The user is told about canon that is already duplicated, every time, and repairs it only
      when they ask.** A plain pull names the duplicated pair and changes nothing; `ac canon dedupe`
      collapses exactly the identical pair and says which id it removed.
- [ ] **The user can tell a pull that changed something from a pull that changed nothing.** The
      no-op pull says plainly that both files were already current; a pull that updated one file
      names that file as updated and the other as unchanged. The two outputs are not identical.
- [ ] **The maintainer sees a green suite and an emptier debt register.** `node --test tests/`
      passes, and the three open `lib/canon.mjs` debt items close out with this phase on
      `ac phase accept`.
