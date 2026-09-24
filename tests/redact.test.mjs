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
