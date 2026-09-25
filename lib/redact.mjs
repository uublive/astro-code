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
// blocks, bare JWTs, Stripe/Google/npm key prefixes, `key = value` secret-labelled pairs
// (quoted keys and quoted values included), env-style `*_TOKEN=` assignments and secret
// CLI flags) is the only set this module promises to catch — it grew from phase 22's
// C9 list as phase 26's transcript mining met real shapes — and it is deliberately NOT
// configurable, so a caller cannot silently narrow it.
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
const SECRET_NAME = /PASSWORD|PASSWD|PASSPHRASE|SECRET|TOKEN|API_?KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|(?:^|_)(?:PASS|PWD)(?:_|$)/i;

const PATTERNS = [
  // PEM private key blocks (multi-line) — match before anything line-oriented.
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => REDACTED },

  // Bare JWTs: three base64url segments, the first a base64 JSON header (`eyJ` = `{"`).
  // A pasted session cookie or id_token carries no `Bearer`/key label to anchor on. The
  // signature segment may be empty (an unsigned `alg: none` token ends in a bare dot).
  { re: /\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*/g, replace: () => REDACTED },

  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ classic + fine-grained, and github_pat_.
  { re: /gh[pousr]_[A-Za-z0-9]{36,}/g, replace: () => REDACTED },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, replace: () => REDACTED },

  // AWS access key ids (long-term + STS).
  { re: /(?:AKIA|ASIA)[0-9A-Z]{16}/g, replace: () => REDACTED },

  // Slack tokens.
  { re: /xox[abprs]-[A-Za-z0-9-]{10,}/g, replace: () => REDACTED },

  // OpenAI-style secret keys.
  { re: /sk-[A-Za-z0-9_-]{20,}/g, replace: () => REDACTED },

  // Stripe secret/restricted keys (`sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`), Google
  // API keys (`AIza…`) and npm access tokens (`npm_…`) — prefixes with no hyphen, which the
  // `sk-` rule above cannot see (phase 26 verify, C3).
  { re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, replace: () => REDACTED },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g, replace: () => REDACTED },
  { re: /\bnpm_[A-Za-z0-9]{20,}/g, replace: () => REDACTED },

  // Secrets passed as CLI flags: `--password X`, `--password=X` (also --pass/--token/
  // --secret/--api-key), and MySQL/MariaDB's glued `-pX`. Only the MySQL-family commands
  // get the `-p` rule — `mkdir -p` and `ssh -p 22` must stay readable.
  { re: /(--(?:password|passwd|pass|token|secret|api[_-]?key)(?:=|\s+))(?:"[^"\n]*"|'[^'\n]*'|\S+)/gi, replace: (_m, flag) => `${flag}${REDACTED}` },
  { re: /(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n]*?\s-p)(?!\s)(?:"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’|\S+)/gi, replace: (_m, pre) => `${pre}${REDACTED}` },
  // `curl -u user:pass` / `--user user:pass` (keep the user) and `sshpass -p X`.
  { re: /(\bcurl\b[^\n]*?\s(?:-u|--user)[\s=]+)([^\s:]+):(\S+)/gi, replace: (_m, pre, user) => `${pre}${user}:${REDACTED}` },
  { re: /(\bsshpass\b[^\n]*?\s-p\s*)(\S+)/gi, replace: (_m, pre) => `${pre}${REDACTED}` },

  // Bearer auth header values (keep the "Bearer " prefix, mask only the token).
  { re: /\bBearer\s+\S+/gi, replace: () => `Bearer ${REDACTED}` },

  // Authorization: <scheme> <value> header lines (keep the header name). The negative
  // lookahead skips a header value the Bearer rule above already masked (`Bearer
  // [REDACTED]`) — without it this rule re-matches its own output and swallows both the
  // word "Bearer" and whatever token/punctuation follows the mask, which is strictly
  // worse than leaving an already-redacted value alone.
  { re: /\bAuthorization:\s*(?!Bearer\s+\[REDACTED\])\S+(?:\s+\S+)?/gi, replace: () => `Authorization: ${REDACTED}` },

  // Credentialed URLs: scheme://user:pass@host — keep scheme and host, mask the creds.
  // The password may itself contain '@' (`user:p@ss@host`), so the authority runs to its
  // LAST '@' before the path (phase 26 verify, C3).
  { re: /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^\s@/:]+:[^\s/]*@/g, replace: (_m, scheme) => `${scheme}${REDACTED}@` },

  // key: value / key=value secret pairs — keep the key, mask only the value.
  // A quoted value is masked WHOLE ("correct horse battery staple" must not leave a
  // tail), and a quoted key (`"password": "…"`, JSON) still matches (phase 26 verify, C3).
  {
    re: /\b(token|secret|password|passwd|passphrase|api[_-]?key)(["']?)(\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’|\S+)/gi,
    replace: (_m, key, q, sep) => `${key}${q}${sep.replace(/\s+/g, '')}${REDACTED}`,
  },

  // Env-style assignments whose NAME merely CONTAINS a secret word — `DB_PASSWORD=`,
  // `AWS_SECRET_ACCESS_KEY=`, `GITHUB_TOKEN:`. The rule above anchors on `\b`, and `_`
  // is a word character, so `DB_PASSWORD=Pr0d…` slipped past it and leaked verbatim
  // through `ac principles mine` (phase 26 C3, remediate-r2). Keep the name, mask the
  // value; a quoted value is masked whole so a space inside it cannot leave a tail behind.
  // Deliberately over-reaching (a `PWD=/path` or `max_tokens=100` gets masked too): a
  // masked harmless value costs a word of context, a leaked credential costs a rotation.
  {
    // The NAME is tested by `SECRET_NAME` so a `_PASS` / `PASS_` segment counts
    // (`DB_PASS=`) while `BYPASS_CACHE=` does not; `PASSPHRASE` joins the list (C3).
    re: /\b([A-Za-z][A-Za-z0-9_]*)(["']?)(\s*[:=]\s*)((?:"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’|\S+))/g,
    replace: (m, name, q, sep) => (SECRET_NAME.test(name) ? `${name}${q}${sep}${REDACTED}` : m),
  },
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
