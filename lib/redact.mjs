// Secret redactor: masks high-signal credential shapes out of free text before it is
// ever written to disk.
//
// ## Why a fixed allowlist of shapes, not entropy guessing
//
// An entropy/heuristic detector trades one failure mode for another: it either
// over-masks ordinary high-entropy prose (hashes, ids, base64 fixture data) until the
// excerpt is unreadable, or under-masks the moment a real secret happens to look
// "normal" to the heuristic. A fixed list of known credential SHAPES (GitHub/AWS/Slack/
// OpenAI token prefixes, `Bearer`/`Authorization` headers, credentialed URLs, PEM
// blocks, and `key = value` secret-labelled pairs) is exactly the set phase 22's
// CRITERIA (C9) enumerates and the only set this module promises to catch — it is
// deliberately NOT configurable, so a caller cannot silently narrow it.
//
// ## Why this lives on its own, ahead of anything that calls it
//
// Nothing in phase 22 feeds real transcript text through this yet (`add --excerpt` is a
// human-typed string); phases 23 and 26 (capture-at-intent, transcript mining) are the
// callers this was built for. Landing the pure masking function first, with its own
// test file, means those later phases import an already-proven primitive instead of
// inventing redaction under deadline.
//
// ## Why redact-then-truncate (the caller's contract, enforced by ordering here)
//
// `lib/principles.mjs` redacts an excerpt BEFORE capping its length. Truncating first
// could cut a matched secret in half, leaving an unmatched fragment (e.g. half a GitHub
// token) sitting in the stored excerpt in plain text. This module does not truncate at
// all — it only masks — so the only correct call order is redact, then truncate, and a
// caller that gets the order backwards cannot lean on this file to save it.
//
// ## Why idempotent
//
// Re-running `redactSecrets` over already-redacted text (a legitimate path once callers
// start layering excerpts) must not touch `REDACTED` itself or anything around it —
// `[REDACTED]` contains no digits or credential shape, so every pattern below already
// leaves it alone; the idempotence is a property of the pattern set, not a special case.

export const REDACTED = '[REDACTED]';

// Order matters only where patterns could otherwise double-mask the same substring
// (e.g. a Bearer header whose token would also match a generic key=value rule) — placing
// the more specific shapes first keeps the surrounding words ("Bearer ", "deploy with")
// intact rather than swallowed into a wider match.
const PATTERNS = [
  // PEM private key blocks (multi-line) — match before anything line-oriented.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => REDACTED },

  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ classic + fine-grained, and github_pat_.
  { re: /gh[pousr]_[A-Za-z0-9]{36,}/g, replace: () => REDACTED },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, replace: () => REDACTED },

  // AWS access key ids (long-term + STS).
  { re: /(?:AKIA|ASIA)[0-9A-Z]{16}/g, replace: () => REDACTED },

  // Slack tokens.
  { re: /xox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => REDACTED },

  // OpenAI-style secret keys.
  { re: /sk-[A-Za-z0-9_-]{20,}/g, replace: () => REDACTED },

  // Bearer auth header values (keep the "Bearer " prefix, mask only the token).
  { re: /\bBearer\s+\S+/gi, replace: () => `Bearer ${REDACTED}` },

  // Authorization: <scheme> <value> header lines (keep the header name). The negative
  // lookahead skips a header value the Bearer rule above already masked (`Bearer
  // [REDACTED]`) — without it this rule re-matches its own output and swallows both the
  // word "Bearer" and whatever token/punctuation follows the mask, which is strictly
  // worse than leaving an already-redacted value alone.
  { re: /\bAuthorization:\s*(?!Bearer\s+\[REDACTED\])\S+(?:\s+\S+)?/gi, replace: () => `Authorization: ${REDACTED}` },

  // Credentialed URLs: scheme://user:pass@host — keep scheme and host, mask the creds.
  { re: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s@/]+:[^\s@/]+@/g, replace: (_m, scheme) => `${scheme}${REDACTED}@` },

  // key: value / key=value secret pairs — keep the key, mask only the value.
  { re: /\b(token|secret|password|passwd|api[_-]?key)\s*([:=])\s*\S+/gi, replace: (_m, key, sep) => `${key}${sep}${REDACTED}` },
];

/**
 * Mask known credential shapes in `text` with `[REDACTED]`. Pure, synchronous, no I/O.
 * Fixed pattern list (P7) — not configurable by callers.
 */
export function redactSecrets(text) {
  let out = String(text ?? '');
  for (const { re, replace } of PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}
