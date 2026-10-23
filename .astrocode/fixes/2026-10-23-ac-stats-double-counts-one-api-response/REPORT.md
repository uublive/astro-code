ac stats double-counts one API response per transcript line and skips subagent transcripts (GitHub #152, #153)

Reports by @luigi-lauro, verbatim titles:
- #152 "`ac stats` counts one API response once per content block (usage added per transcript line, not per message.id)"
- #153 "`ac stats` skips every subagent transcript (<session>/subagents/), so workflow spend is not counted"
Fixed as one fix at Matteo's request ("do 1, then 2 as fixes").
