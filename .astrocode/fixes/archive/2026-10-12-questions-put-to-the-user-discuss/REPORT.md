# Questions put to the user start from a low-level detail with no context

**Fixed by:** b62d877 `feat(asking): one spec for putting a question to the user, referenced by every
asking command`. `templates/asking.md` is the single spec (frame the round in plain words first, start
each question from its visible effect, keep an "Explain more" option), and every command that uses
`AskUserQuestion` references it.

**Check (2026-10-15):** every `commands/*.md` that names `AskUserQuestion` references `asking.md`.
The fix entry was never moved past `open`.
