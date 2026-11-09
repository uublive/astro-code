# Challenge mode — the single spec

This is the ONLY place the challenge method is stated in full. Callers reference this
file — `` `$(ac path templates)/challenge.md` `` — they load it and apply it in full.
Each caller states only its own destinations, its own round-one riders and its own fact
sources (an existing report to reuse, a mapper to spawn); everything else — the round
format, the checkpoint, the nudge, the unknowns handling — lives here once. A command
that restates any of that inline instead of pointing here is a defect: the two copies
will diverge and one of them will be wrong.

## 1. Before round one

Read whatever ground the entry point already has (a vision draft, a mapper report, the
phase being discussed). If the entry point has not already made its one
`ac principles ask "<question built from the idea>"` call this session, make one now —
a decision the call already settled is stated to the user in one line, never asked
again as a round question.

List the decisions the idea actually needs, and for each one, which other decisions it
depends on. This list is the tree the rounds walk; it is not shown to the user as a
tree — it only decides what is unblocked.

## 2. Facts are looked up, never asked

Anything discoverable from code, files, config or tools is the agent's job, never a
question. A small check (does a file exist, what does a config value say) is read
inline before the round that needs it. A broad sweep (the shape of a whole codebase, a
feature survey) goes to a read-only sub-agent (astro-mapper or Explore) — reuse one the
entry point already ran rather than spawning a second. Only the questions that depend
on that sweep's result wait for the round after it returns; every other question in the
current round is asked now, unblocked. Decisions — anything that needs a judgement call
or a stated trade-off — always go to the user; a fact is never disguised as one.

## 3. A round

A round is every decision whose prerequisites are already settled — not a curated
handful. There is no fixed cap (not "2 to 4 questions"): a round might hold one question
or a dozen. A question that depends on one still open in the same round waits for a
later round; recompute the unblocked set after every round closes.

If recomputing would unblock nothing while questions remain — two open questions each
waiting on the other — merge them into one combined question rather than stall the
session.

How the round is asked is the project's setting `challenge.ask` (read it with
`ac config get challenge.ask`, inside a project only). It is `text` unless the project set
`picker` (#189):

- **`picker`, on a host that has one:** ask the round through `AskUserQuestion`, one
  question per decision, its recommended answer as the first option with "(Recommended)" in
  its label. A call holds at most 4 questions, so a bigger round is split over consecutive
  calls in round order, and the round is saved only after the last one is answered. An answer
  that fits no option comes back through "Other" and is taken as written.
- **Otherwise (unset, `text`, any other value, outside a project, or no picker on the
  host):** the plain-text round below.

Ask the plain-text round as one message, never through `AskUserQuestion` or any other
picker (a picker caps at a handful of fixed options and does not exist on every host;
this must work on a host with no picker at all). Number the questions `Q1` … `Qn`, each
with a short title, the question itself, and a recommended answer. The user replies
freely, per number; replying "ok" (for that number, or for all of them) accepts the
recommendation as given.

Example shape:

```
Q1. Auth — should sign-up require email verification?
    Recommendation: yes, a verification link before first login.
Q2. Storage — local disk or object storage for uploads?
    Recommendation: local disk for now; revisit if uploads need to scale out.
```

The round itself is an interview turn, not a report — it carries no line-count bound.

## 4. Save after every round

Before the checkpoint (§5), write this round's settled answers to the entry point's
real destination — never deferred to session end, so a `/clear` or a crash loses at
most one round. An answer that is hard to reverse, would surprise someone without
context, and reflects a real trade-off is recorded with
`ac decision add "<choice>" --why "<why>"` (inside a project only; a clean one-line
paraphrase of the choice and the reason, never the user's raw multi-line reply).
Everything else is written to whichever file the entry point names as its destination.
Open questions (not yet settled, or left open at a checkpoint) are written as open —
never filled with the recommendation.

## 5. Checkpoint every round

After saving, ask exactly one `AskUserQuestion`, in one line, verbatim —
"N questions still open — next round or capture now?" — with options "Next round"
(recommended, while questions remain) and "Capture now". Where no picker exists (a host
with no `AskUserQuestion`), ask the same question as plain text instead.

"Capture now" records every remaining open question as **open** — never filled with its
recommendation. The session also ends naturally when no question is left and the user
confirms the shared understanding matches. There is no hard round cap either way.

## 6. The rubber-stamp nudge

After the first round in which every single answer was "ok", say once, in one line,
verbatim: "You took all N recommendations; any you'd actually push on?" This fires at
most once per session — never again after the first time, even if a later round is also
all-"ok". It never blocks the checkpoint; accepting every recommendation stays a fully
valid way to finish.

## 7. Unknowns

An answer of "I don't know" or "I'd need to see it" is recorded as an open question —
never assumed, never silently filled with the recommendation just because the user
could not commit to one.

At the end of the session, inside a project, if any question is still open, ask one
`AskUserQuestion` offering to file each as a backlog item (a prototype or spike idea)
via `ac backlog add "<question>"`. Where no picker exists (a host with no
`AskUserQuestion`), ask the same offer as plain text instead. Say nothing when there are
no open questions — do not ask the question just to get a "no". Never claim a phase number
here (no `ac phase add`, no `ac backlog promote`) unless the user explicitly asks for one.

## 8. Capture summary

When the session ends, report in one line: how many rounds ran, how many questions were
settled, how many are left open, and where the settled answers and open questions were
saved.
