# Forge export — schema v1

The file `ac principles import --from-forge <file>` reads. One JSON document per import
(not JSONL — a one-shot dump wants a versioned envelope, not an append-only log). Every
field below is validated by `lib/principleimport.mjs`'s `parseForgeExport`; anything not
named here — an unknown key, a wrong type, a bad enum value — is refused, never dropped
silently and never guessed at. The whole file is validated before anything is imported
(all-or-nothing): a document that is 99% valid and 1% wrong is refused in full.

**Version: 1.** Change policy: adding an optional key that consumers may ignore stays v1;
renaming, removing or reordering anything here is v2 — a new ADR and an update to this
document (and its guard test) land together, never silently.

## Envelope

| key | required | type | meaning |
| --- | --- | --- | --- |
| `format` | yes | string | must be exactly `"astro-forge-export"` |
| `version` | yes | number | must be exactly `1` |
| `exported_at` | yes | string (ISO-8601) | when this file was generated |
| `nodes` | yes | array | zero or more nodes (below); an empty array is valid |

## Node

One JSON object per forge generator node (Principle / Pattern / AntiPattern /
Preference).

| key | required | type | meaning |
| --- | --- | --- | --- |
| `slug` | yes | string, `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, unique in the file | the stable identity a re-import keys on |
| `type` | yes | string, one of `Principle`, `Pattern`, `AntiPattern`, `Preference` | maps 1:1 to astro-code's kind (below) |
| `name` | no | string | forge's display name; carried into the imported entry's history, never its statement |
| `statement` | yes | string, non-empty after whitespace collapses | the principle text itself |
| `why` | no | string | the rationale, if forge has one |
| `status` | yes | string, one of `approved`, `pending`, `rejected`, `superseded` | forge's human decision — see the mapping table below |
| `confidence` | no | string, one of `low`, `normal` | a low-confidence node never lands `accepted`, however `status` reads |
| `created` | no | string (ISO-8601) | when forge first captured it; defaults to `exported_at` |
| `reason` | only with `status: rejected` | string, non-empty | forge's own rejection reason; a rejected node with none still imports (a fixed reason is used) |
| `superseded_by` | only with `status: superseded` | string (a slug, never itself) | the node that replaced it; may point to a slug elsewhere in this same file |
| `signals` | no | array of signal objects (below) | the evidence behind the node |

## Signal

Linked evidence for one node — the words that led forge to capture it.

| key | required | type | meaning |
| --- | --- | --- | --- |
| `text` | yes | string, non-empty | the raw text. **Send it unredacted** — astro-code redacts and caps every signal at import time exactly like its own native capture path, so pre-redacting on the forge side would double-mask nothing usefully and could hide a shape astro-code's redactor would otherwise catch |
| `source` | no | string | a free-text origin pointer (e.g. a session id) |
| `at` | no | string (ISO-8601) | when the signal was observed |

## Status/kind mapping

| forge `status` | imported `status` | notes |
| --- | --- | --- |
| `approved` | `accepted` | unless `confidence: low` is also unapproved in forge's own queue — forge's `approved` always means a human said yes |
| `pending` | `proposed` | reviewable via `ac principles list --proposed` / `/astro-review`, exactly like any other proposal |
| `rejected` | `rejected` | `reason` carried verbatim when forge gave one, else a fixed non-empty reason |
| `superseded`, target resolves (in this file or already known) | `superseded` | `superseded-by` points at the resolved entry |
| `superseded`, target unresolved | `retired` | reason names the unresolved forge slug |

`type` → kind: `Principle` → `principle`, `Pattern` → `pattern`, `AntiPattern` →
`antipattern`, `Preference` → `preference`. No fuzzy mapping, no default kind.

## Keying, idempotency, and re-import

A node is recognised on a later import by its `slug`, recorded as `forge:<slug>` on the
entry's `source.ref` (a fresh creation) or on an appended sighting's `ref` (a match against
an existing entry). A re-import of the identical file is a byte-identical no-op; a slug
carrying new `signals` appends only the signals not seen before (keyed by a hash of the
raw signal, so re-sending the same evidence never duplicates it).

**Re-import never overrides a human decision.** Once astro-code knows a slug, importing it
again NEVER changes that entry's status, statement, why, reason or scopes — no matter what
forge now reports for it — it only ever appends evidence. If a human accepted, edited or
rejected the entry inside astro-code, forge's own later change to the same node is
silently ignored on that field. This is deliberate (ADR-058): the human's decision inside
astro-code always outranks a later automated report.

## Example

Covers every type, every status (including a rejected node with a reason and one
without, and a superseded node resolving to a target later in this same file), a
low-confidence node, and 1–3 signals per node.

```json
{
  "format": "astro-forge-export",
  "version": 1,
  "exported_at": "2026-09-20T00:00:00.000Z",
  "nodes": [
    {
      "slug": "commit-lockfiles",
      "type": "Principle",
      "name": "Commit lockfiles",
      "statement": "Commit the lockfile with every dependency change",
      "why": "Reproducible installs across every machine and CI run.",
      "status": "approved",
      "confidence": "normal",
      "created": "2026-09-01T00:00:00.000Z",
      "signals": [
        { "text": "always commit the lockfile, no exceptions", "source": "session 8f2c", "at": "2026-09-01T00:00:00.000Z" },
        { "text": "CI failed again because the lockfile was stale", "source": "session 91ab", "at": "2026-09-03T00:00:00.000Z" }
      ]
    },
    {
      "slug": "wip-branches",
      "type": "Pattern",
      "statement": "Keep work-in-progress on its own branch",
      "status": "pending",
      "signals": [
        { "text": "started a WIP branch again today", "source": "session 4d10", "at": "2026-09-05T00:00:00.000Z" }
      ]
    },
    {
      "slug": "no-force-push",
      "type": "AntiPattern",
      "statement": "Never force-push a shared branch",
      "status": "rejected",
      "reason": "too strict for a solo repo"
    },
    {
      "slug": "always-squash",
      "type": "Preference",
      "statement": "Always squash-merge",
      "status": "rejected"
    },
    {
      "slug": "old-style-guide",
      "type": "Principle",
      "statement": "The old style guide rule",
      "status": "superseded",
      "superseded_by": "new-style-guide"
    },
    {
      "slug": "new-style-guide",
      "type": "Principle",
      "statement": "The current style guide rule",
      "status": "approved"
    },
    {
      "slug": "low-confidence-hint",
      "type": "Pattern",
      "statement": "A pattern forge is not yet sure about",
      "status": "pending",
      "confidence": "low",
      "signals": [
        { "text": "one weak signal", "source": "session ffee", "at": "2026-09-10T00:00:00.000Z" }
      ]
    }
  ]
}
```
