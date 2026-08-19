# Examples — Commit Digest

## Quick Start

```
summarize these commits: sample-commits.json
```

## Examples

### Summarize a feature-branch commit log

**Prompt:**
"Build a commit digest for sample-commits.json"

**Arguments:**
The path to a JSON array of commit objects (`{hash, author, type, date,
subject}`), passed as `$ARGUMENTS`.

**Expected workflow:**
1. `prepare` resolves the input path and writes `_report/state.json`.
2. `generate_report` runs `generate_report.py`, which calls
   `scripts/build_digest.py` to write `_report/digest.json`.

**Produces:**
- `_report/digest.json`

---

### Summarize commits spanning multiple timezones

**Prompt:**
"Summarize these commits: release-commits.json"

**Arguments:**
The path to a JSON array of commit objects whose `date` fields use different
UTC offsets (e.g. `-05:00` and `Z`) — dates are compared as real instants, not
literal strings, so ordering (first/last date) is correct regardless of offset.

**Expected workflow:**
1. `prepare` resolves the input path and writes `_report/state.json`.
2. `generate_report` runs `generate_report.py`, which calls
   `scripts/build_digest.py` to write `_report/digest.json`.

**Produces:**
- `_report/digest.json`

## Argument Reference

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| commits path | string (path) | *(required)* | Path to a JSON array of `{hash, author, type, date, subject}` commit objects |

## Common Patterns

- Every field of `digest.json` except `generated_at` is a pure function of
  the input commit list — same input, same digest (this is what the shipped
  golden fixtures parity-check against: `python3 tools/parity_check.py
  --manifest tools/parity/parity.json`).
- The kit cannot reproduce the source's `--publish` webhook capability
  (network + secret bound); pipe `_report/digest.json` into your own
  publishing step if you need that behavior.
