// Secret redaction — a fixed allowlist of high-signal shapes, applied before any excerpt
// (principles, phase 23/26 transcript feeds) is ever written to disk.
//
// ADR-018: lib/redact.mjs does not exist on this branch yet (this is the RED half of a
// paired wave with t2). Every test dynamically imports it inside its own async body so a
// missing export fails only these tests at call time, not the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a GitHub personal-access token is masked, surrounding words survive', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const token = 'ghp_' + 'a'.repeat(36);
  const out = redactSecrets(`deploy with ${token} please`);
  assert.ok(!out.includes(token), 'the token itself must not survive');
  assert.match(out, /deploy with/);
  assert.match(out, /please/);
  assert.match(out, /\[REDACTED\]/);
});

test('an AWS access key id is masked', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const key = 'AKIA' + 'B'.repeat(16);
  const out = redactSecrets(`key: ${key} rotate soon`);
  assert.ok(!out.includes(key));
  assert.match(out, /rotate soon/);
  assert.match(out, /\[REDACTED\]/);
});

test('a Bearer token is masked, the "Bearer " prefix survives', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const token = 'a'.repeat(40);
  const out = redactSecrets(`curl -H "Authorization: Bearer ${token}" https://api.example.com`);
  assert.ok(!out.includes(token));
  assert.match(out, /Bearer \[REDACTED\]/);
});

test('a credentialed URL keeps scheme and host, masks the user:pass', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const out = redactSecrets('clone https://alice:s3cr3tpass@git.example.com/r.git now');
  assert.ok(!out.includes('alice:s3cr3tpass'));
  assert.match(out, /https:\/\/\[REDACTED\]@git\.example\.com\/r\.git/);
  assert.match(out, /clone/);
  assert.match(out, /now/);
});

test('a password=value assignment keeps the key, masks the value', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const out = redactSecrets('set password=hunter2 in the .env file');
  assert.ok(!out.includes('hunter2'));
  assert.match(out, /password[:=]\s*\[REDACTED\]/);
  assert.match(out, /in the \.env file/);
});

test('a PEM private key block is masked wholesale', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD91\nlITh4jXOHKgcXN4Ci48+Xc\n-----END RSA PRIVATE KEY-----';
  const out = redactSecrets(`here is the key:\n${pem}\nkeep it safe`);
  assert.ok(!out.includes('MIIBOgIBAAJBAKj34GkxFhD91'));
  assert.match(out, /\[REDACTED\]/);
  assert.match(out, /here is the key/);
  assert.match(out, /keep it safe/);
});

test('an OpenAI-shaped sk- token is masked', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const token = 'sk-' + 'x'.repeat(24);
  const out = redactSecrets(`export OPENAI_API_KEY=${token} # local only`);
  assert.ok(!out.includes(token));
  assert.match(out, /\[REDACTED\]/);
  assert.match(out, /local only/);
});

test('a Slack bot token is masked', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const token = 'xoxb-' + '1'.repeat(12);
  const out = redactSecrets(`slack webhook uses ${token} for auth`);
  assert.ok(!out.includes(token));
  assert.match(out, /\[REDACTED\]/);
  assert.match(out, /slack webhook uses/);
  assert.match(out, /for auth/);
});

test('plain prose without any secret shape returns byte-identical', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const prose = 'always use pnpm, never npm, in this repo — the lockfile is the source of truth.';
  assert.equal(redactSecrets(prose), prose);
});

test('redaction is idempotent — masking already-masked text changes nothing further', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const token = 'ghp_' + 'c'.repeat(36);
  const once = redactSecrets(`token ${token} here`);
  const twice = redactSecrets(once);
  assert.equal(twice, once);
});

// Phase 26 remediate-r2 (C3): `\b(password|token|…)` never matched an env-style name like
// `DB_PASSWORD=` because `_` is a word character, so the value leaked verbatim.
const ENV_SECRETS = {
  DB_PASSWORD: 'Pr0dPassw0rd9xq',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  GITHUB_TOKEN: 'ghs0ldTokenValue123456',
  stripe_api_key: 'rk_live_abc123def456',
  MY_PRIVATE_KEY: 'base64blobvalue==',
  GCP_CREDENTIALS: '/secure/creds.json',
  MYSQL_PWD: 'rootpw77',
};

test('env-style assignments whose NAME carries a secret word keep the name and mask the value', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const line = Object.entries(ENV_SECRETS).map(([k, v]) => `${k}=${v}`).join(' ') + ' then restart';
  const out = redactSecrets(line);
  for (const [k, v] of Object.entries(ENV_SECRETS)) {
    assert.ok(!out.includes(v), `${k}'s value must not survive: ${out}`);
    assert.ok(out.includes(`${k}=${'[REDACTED]'}`), `${k} keeps its name: ${out}`);
  }
  assert.match(out, /then restart$/);
});

test('an env-style colon assignment and a quoted value are masked whole', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const out = redactSecrets('set SERVICE_TOKEN: "two words" and APP_SECRET=\'x y z\' now');
  assert.ok(!/two words|x y z/.test(out), out);
  assert.match(out, /SERVICE_TOKEN: \[REDACTED\] and APP_SECRET=\[REDACTED\] now/);
});

test('a bare JWT (three base64url segments, first starting eyJ) is masked', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const out = redactSecrets(`the session cookie was ${jwt} yesterday`);
  assert.ok(!out.includes(jwt));
  assert.ok(!out.includes('dozjgNryP4J3jVmNHl0w5N'), 'no segment survives');
  assert.equal(out, 'the session cookie was [REDACTED] yesterday');
});

test('the env-style and JWT rules are idempotent', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const once = redactSecrets('DB_PASSWORD=abc eyJabcdef.eyJghijkl.mnopqr');
  assert.equal(redactSecrets(once), once);
});

// Phase 26 verify (C3, third round): close variants of the listed shapes that leaked
// through `ac principles mine`. Each secret value must be gone entirely — no tail left.
test('quoted values, quoted JSON keys, extra key prefixes and secret CLI flags are masked whole', async () => {
  const { redactSecrets } = await import('../lib/redact.mjs');
  const cases = [
    ['always keep config like {"password": "JsonPassw0rdQ9"} out of git', ['JsonPassw0rdQ9']],
    ['always quote: password = "correct horse battery staple"', ['correct', 'horse', 'battery', 'staple']],
    ['PASSWORD="correct horse battery staple"', ['correct', 'staple']],
    ["secret: 'two words'", ['two', 'words']],
    ['rotate rk_test_abcdefghijklmnop1234 too', ['rk_test_abcdef']],
    ['the maps key AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUvW leaked', ['AIzaSyA1b2']],
    ['publish with npm_abcdefghijklmnopqrstuvwxyz0123456789', ['npm_abcdef']],
    ['always pass --password CliFlagPassZ77 to the tool', ['CliFlagPassZ77']],
    ['or --token=TokFlagValue99 instead', ['TokFlagValue99']],
    ['connect with mysql -u root -pMySqlPw123 prod', ['MySqlPw123']],
  ];
  for (const [input, secrets] of cases) {
    const out = redactSecrets(input);
    for (const s of secrets) assert.ok(!out.includes(s), `leaked "${s}" in: ${out}`);
    assert.ok(out.includes('[REDACTED]'), `nothing masked in: ${out}`);
  }
  // Readable commands stay readable: `-p` is only a secret for the MySQL family.
  assert.equal(redactSecrets('mkdir -p build && ssh -p 22 host'), 'mkdir -p build && ssh -p 22 host');
});
