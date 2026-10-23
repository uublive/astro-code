The statusline hook crashes with an unhandled EPIPE when its stdout reader closes early

Source: debt 2026-09-22-the-statusline-hook-crashes-with-an (phase 21 verifier), graduated to this
fix by Matteo at the milestone 13 debt triage ("Pay it as a fix").

Recorded observation, verbatim: "Piping the hook into a short consumer (node
hooks/astro-statusline.mjs < payload | head -3) makes the final process.stdout.write throw an
uncaught 'Error: write EPIPE', printing a Node stack trace to stderr and exiting non-zero."
