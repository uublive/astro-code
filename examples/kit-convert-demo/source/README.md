# commit-digest

A tiny, deterministic **non-kit** tool: reads a JSON list of git-style commits and
writes a summary digest. It exists as the sample source input for
`astro-kit-convert`'s worked demo (`examples/kit-convert-demo/`) — a real,
runnable-offline tool with one genuine third-party dependency and one
network/secret-bound capability, so the conversion command has something real to
auto-derive from and something real to flag.

## Install

```
pip install -r requirements.txt
```

`python-dateutil==2.8.2` is the one real pinned dependency — used to parse the
`date` field on each commit.

## Capabilities

### 1. Core: build a digest (self-contained, offline)

```
python3 commit_digest.py --in sample-commits.json --out digest.json
```

Reads the input commits array (`{hash, author, type, date, subject}` per entry)
and writes `digest.json`:

```json
{
  "generated_at": "<ISO 8601 UTC timestamp — the one nondeterministic field>",
  "commit_count": 6,
  "by_type": { "chore": 1, "docs": 1, "feat": 2, "fix": 2 },
  "authors": { "Ada Lovelace": 3, "Grace Hopper": 2, "Katherine Johnson": 1 },
  "unique_authors": 3,
  "first_date": "2026-01-05",
  "last_date": "2026-01-12"
}
```

Every field except `generated_at` is a pure function of the input — same input,
same digest — which is what makes it a valid golden-fixture parity target: run it
twice on `sample-commits.json` and only `generated_at` changes.

This path needs no network access and no secret; it runs fully offline once the
one pinned dependency is installed.

### 2. `--publish`: push the digest to a webhook (network + secret bound)

```
DIGEST_WEBHOOK_URL=https://example.invalid/hooks/digest \
DIGEST_TOKEN=... \
python3 commit_digest.py --in sample-commits.json --out digest.json --publish
```

POSTs the computed digest as JSON to `$DIGEST_WEBHOOK_URL`, authenticated with a
bearer token read from `$DIGEST_TOKEN`, using the stdlib `urllib.request` (no
extra dependency). Neither variable is read unless `--publish` is passed, and
neither is ever committed to this repo — both must be supplied by the caller's
environment.

This capability is deliberately **not** self-containable: it requires an
external endpoint and a live credential. When this source is converted into an
Astro kit, `--publish` cannot be reproduced inside the kit — it must instead be
surfaced as an explicit, flagged manual follow-up rather than silently dropped
or wired in as a hidden external dependency.

## Input format (`sample-commits.json`)

A JSON array of commit objects:

```json
[
  {
    "hash": "a1b2c3d",
    "author": "Ada Lovelace",
    "type": "feat",
    "date": "2026-01-05T09:12:00Z",
    "subject": "add digest generator"
  }
]
```

`type` is a free-form conventional-commit-style label (`feat`, `fix`, `docs`,
`chore`, ...); `date` is an ISO 8601 timestamp.
