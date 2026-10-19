import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/api.ts';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('API security: concurrent writes share CSRF initialization and preserve multipart boundaries and credentials', async () => {
  let initializations = 0;
  const calls = [];
  const client = createApiClient(async (url, init) => {
    if (url === '/api/csrf') { initializations++; return response({ csrfToken: 'fictional-token' }); }
    calls.push({ url, init }); return response({ ok: true });
  });
  const file = new FormData(); file.append('image', new Blob(['fixture']), 'fixture.png');
  await Promise.all([client('/api/admin/categories/a/image', { method: 'POST', body: file }), client('/api/orders', { method: 'POST', body: '{}' })]);
  assert.equal(initializations, 1);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.get('X-CSRF-Token'), 'fictional-token');
  }
  assert.equal(calls.find(({ init }) => init.body === file).init.headers.has('Content-Type'), false);
});

test('API security: session rotation refreshes CSRF once; order/payment failures are never retried', async () => {
  let tokens = 0, writes = 0;
  const client = createApiClient(async (url) => {
    if (url === '/api/csrf') return response({ csrfToken: 'token-' + ++tokens });
    writes++;
    return writes === 1 ? response({ code: 'CSRF_INVALID', error: 'Invalid token' }, 403) : response({ ok: true });
  });
  assert.deepEqual(await client('/api/dev/session', { method: 'POST', body: '{}' }), { ok: true });
  assert.equal(tokens, 2); assert.equal(writes, 2);
  let failures = 0;
  const failing = createApiClient(async (url) => url === '/api/csrf' ? response({ csrfToken: 'token' }) : (failures++, response({ error: 'Payment failed' }, 500)));
  await assert.rejects(failing('/api/dev/payments/a/simulate', { method: 'POST', body: '{}' }), /Payment failed/);
  assert.equal(failures, 1);
  await assert.rejects(client('https://external.example/api/orders', { method: 'POST' }), /same-origin/);
});

test('API security: reads need no token; failed CSRF initialization can recover without sending a write', async () => {
  let initializations = 0, writes = 0;
  const client = createApiClient(async (url) => {
    if (url === '/api/csrf') return ++initializations === 1 ? response({}, 503) : response({ csrfToken: 'token' });
    if (url === '/api/categories') return response({ items: [] });
    writes++; return response({ ok: true });
  });
  await client('/api/categories'); assert.equal(initializations, 0);
  await assert.rejects(client('/api/orders', { method: 'POST', body: '{}' }), /sessão segura/);
  assert.equal(writes, 0);
  await client('/api/orders', { method: 'POST', body: '{}' }); assert.equal(writes, 1);
});
