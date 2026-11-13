# Phase 58 — Acceptance (human UAT)

Shared precondition, unless an item says otherwise:
- A project with `gitflow.enabled` on.
- A shared registry initialised on its remote, with the local registry ref fetched.
- The current milestone holds phases claimed by me (the repo's `user.email`), at least one of them open and one complete.
- It also holds phases claimed by a teammate (another email).
- At least one of my open phases is in a second milestone.
- The phase-band mod is on (`ac mods enable phase-band`).

1. **The user can tie a phase to the feature branch they are on and see it from another checkout.**
   - Precondition: the shared state above. I am on `feature/<x>` with an open phase of mine that is not tied.
   - Steps: run `ac flow link <N>` and get a one-line `✓`.
   - Check: in a second clone, after a fetch, `ac status --json` shows that phase with `feature_branch: "feature/<x>"`.
   - Check: `ac flow link <N>` from `feature/<y>` moves the tie, and `ac flow unlink <N>` clears it.
   - Check: `ac flow link m<M>` ties a whole milestone.

2. **The user can discuss, plan or execute a phase on a feature branch and find it tied without running any link command.**
   - Precondition: the shared state above. I am on `feature/<x>`, and the phase is mine and untied.
   - Steps: run `/astro-discuss <N>`, `/astro-plan <N>` or `/astro-execute <N>`.
   - Check: the phase reads as tied to `feature/<x>`.
   - Check: the same steps on `develop` tie nothing.
   - Check: on `develop`, a phase already tied to `feature/<x>` stays tied there.
   - Check: no branch is created or switched.

3. **The user can open the band on a feature branch and see only the work tied to it.**
   - Precondition: the shared state above. Two of my phases, and one whole milestone of mine, are tied to `feature/<x>`. I am on `feature/<x>`.
   - Check: the band's roadmap chips, meter, title and next buttons show only those tied phases.
   - Check: no teammate phase and no untied phase appears.
   - Check: one dim `+N elsewhere` line counts the rest.

4. **The user can open the band on `develop` or `main`, or on a branch with nothing tied, and see only their own open work across milestones.**
   - Precondition: the shared state above, including a teammate phase that was claimed while on `develop`.
   - Check: the band lists my open phases from both milestones, and none of my complete ones.
   - Check: it lists none of the teammate's phases. One dim `+N by others` line counts them.
   - Check: the result is the same with `gitflow.enabled` off.
   - Check: plain `ac status` (text) still lists every phase, the teammate's included.

5. **The user can make claims under an old or second email count as theirs.**
   - Precondition: the shared state above, plus one phase claimed from another checkout under a second email of mine.
   - Check: that phase first appears only in the `+N by others` count.
   - Steps: run `ac identity alias add <that email>`, as the MANUAL describes.
   - Check: after the next turn, the phase shows among my rows.
   - Check: `git status` in the project shows no change.
   - Check: `ac identity alias remove <that email>` reverts it.

6. **The user still sees the full band when ownership cannot be known.**
   - Precondition: a project whose registry ref was never fetched, or whose origin remote was removed, holding several phases.
   - Check: the band shows the same phases it showed before this phase, with no `+N` line hiding anything.
   - Check: switching to a branch that was deleted on the remote still draws the band, not `status unavailable`.
