import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertTestTarget, redact } from '../scripts/mysql-env.mjs';
import { retryTransaction } from '../src/transaction-retry.ts';
import { Prisma } from '@prisma/client';

test('MySQL safety: reject remote hosts, wrong databases/accounts, alternate ports and URL options', () => {
  const local = 'mysql://loja1_test_app:fictional-password@localhost:3306/loja1_test';
  assert.doesNotThrow(() => assertTestTarget(local));
  for (const invalid of [
    local.replace('localhost', 'hostinger.example.test'), local.replace('localhost', 'localhost.example.test'),
    local.replace('/loja1_test', '/production'), local.replace('loja1_test_app:', 'root:'),
    local.replace('3306', '3307'), local.replace('mysql:', 'postgresql:'),
    local + '?host=remote.example.test', local + '#fragment', 'invalid',
  ]) assert.throws(() => assertTestTarget(invalid));
  const hidden = redact(`${local} fictional-password fictional-session-secret`, { DATABASE_URL: local, SESSION_SECRET: 'fictional-session-secret' });
  assert.ok(!hidden.includes('fictional-password') && !hidden.includes('fictional-session-secret') && !hidden.includes('mysql://'));
});

test('MySQL and SQLite schemas expose the same models, relationships, defaults and indexes', async () => {
  const models = (schema) => schema.slice(schema.indexOf('model User')).replace(/\s+@db\.\w+(?:\([^)]*\))?/g, '').replace(/\s+/g, ' ').trim();
  const [sqlite, mysql] = await Promise.all([
    readFile(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(new URL('../../prisma/mysql/schema.prisma', import.meta.url), 'utf8'),
  ]);
  assert.equal(models(mysql), models(sqlite));
});

test('Transactions retry only retryable Prisma conflicts and stop after five attempts', async () => {
  const conflict = () => new Prisma.PrismaClientKnownRequestError('Fictional deadlock', { code: 'P2034', clientVersion: '5.22.0' });
  let attempts = 0;
  assert.equal(await retryTransaction(async () => { if (++attempts < 3) throw conflict(); return 'committed'; }), 'committed');
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retryTransaction(async () => { attempts++; throw conflict(); }), { code: 'P2034' });
  assert.equal(attempts, 5);
  attempts = 0;
  await assert.rejects(retryTransaction(async () => { attempts++; throw new Error('Fictional permanent failure'); }), /permanent failure/);
  assert.equal(attempts, 1);
});
