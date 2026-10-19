import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundary, createRateLimit, csrfProtection, securityConfig } from '../src/security.ts';

test('Security config: remote mode fails closed for incomplete/ambiguous configuration and weak secrets', () => {
  const valid = { REMOTE_TESTING: 'true', REMOTE_ORIGIN: 'https://shop-test.example.test', SESSION_SECRET: 'a'.repeat(64) };
  assert.equal(securityConfig(valid).remote, true);
  for (const change of [
    { REMOTE_TESTING: 'yes' }, { REMOTE_ORIGIN: '' }, { REMOTE_ORIGIN: 'http://shop-test.example.test' },
    { REMOTE_ORIGIN: 'https://user:secret@example.test' }, { REMOTE_ORIGIN: 'https://localhost' },
    { REMOTE_ORIGIN: 'https://quick.trycloudflare.com' }, { REMOTE_ORIGIN: 'https://example.test/path' },
    { SESSION_SECRET: '' }, { SESSION_SECRET: 'replace-with-secure-secret' },
    { REMOTE_TESTING: 'false' },
  ]) assert.throws(() => securityConfig({ ...valid, ...change }));
  assert.equal(securityConfig({}).remote, false);
  assert.notEqual(securityConfig({ SESSION_SECRET: 'replace-with-secure-secret' }).secret, 'replace-with-secure-secret');
  assert.notEqual(securityConfig({}).secret, securityConfig({}).secret);
});

test('Security rate limiter: keys use socket addresses, spoofed forwarding headers cannot evade it, and budgets recover', () => {
  let now = 1000;
  const limit = createRateLimit(2, 60000, () => now);
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 'first' } };
  let passed = 0, status, response, headers = {};
  const res = { status(value) { status = value; return this; }, set(key, value) { headers[key] = value; return this; }, json(body) { response = body; return this; } };
  limit(req, res, () => passed++); limit(req, res, () => passed++);
  req.headers['x-forwarded-for'] = 'second';
  limit(req, res, () => passed++);
  assert.equal(passed, 2); assert.equal(status, 429); assert.equal(headers['Retry-After'], '60');
  assert.doesNotMatch(JSON.stringify(response), /first|127\.0\.0\.1/);
  now += 60001;
  limit(req, res, () => passed++); assert.equal(passed, 3);
});

test('Security boundary: non-loopback sockets are refused even with forged local Host and forwarded identity', () => {
  let status, proceeded = false;
  const req = { originalUrl: '/', socket: { remoteAddress: '203.0.113.5' }, get: () => 'localhost:3001', headers: {} };
  const res = { status(value) { status = value; return this; }, json() {} };
  boundary(securityConfig({}))(req, res, () => { proceeded = true; });
  assert.equal(status, 403); assert.equal(proceeded, false);
});

test('Security CSRF: malformed multibyte/duplicate-shaped tokens are denied without throwing', () => {
  for (const token of ['é'.repeat(43), 'a'.repeat(43) + ', second', 'short', undefined]) {
    let status, proceeded = false;
    const req = { method: 'POST', session: { csrfToken: 'a'.repeat(43) }, get: () => token };
    const res = { status(value) { status = value; return this; }, json() {} };
    assert.doesNotThrow(() => csrfProtection(req, res, () => { proceeded = true; }));
    assert.equal(status, 403); assert.equal(proceeded, false);
  }
});
