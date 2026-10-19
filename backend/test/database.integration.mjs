import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import request from 'supertest';
import { assertTestTarget } from '../scripts/mysql-env.mjs';
import { inspectDatabase } from '../scripts/mysql-local.mjs';

const mysql = process.env.MYSQL_INTEGRATION === 'true';
const temp = await mkdtemp(path.join(tmpdir(), 'loja1-db-integration-'));
if (mysql) assertTestTarget(process.env.DATABASE_URL);
else {
  const filename = path.join(temp, 'isolated.db');
  const db = new DatabaseSync(filename);
  db.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  db.close();
  process.env.DATABASE_URL = 'file:' + filename.replaceAll('\\', '/');
}
process.env.NODE_ENV = 'development';
process.env.REMOTE_TESTING = 'false';
process.env.REMOTE_ORIGIN = '';
process.env.SESSION_SECRET ??= 'fictional-database-integration-secret-32-plus';
process.env.ALLOW_MOCK_PAYMENT = 'true';
process.env.AUTH_EMAIL_TRANSPORT = 'preview'; process.env.AUTH_APP_ORIGIN = 'http://localhost:5173';
const { createApp, prisma } = await import('../dist/app.js');
const { PrismaClient } = await import('../dist/database.js');
const { DatabaseSessionStore, sessionHash } = await import('../dist/session-store.js');
const { createAppearanceRepository } = await import('../dist/appearance.js');

test(`${mysql ? 'MySQL' : 'SQLite'} database integration`, async (t) => {
  const run = randomUUID();
  const categories = new Set(), orders = new Set(), users = new Set(), sessions = new Set(), servers = [];
  const originalSetting = await (async () => {
    // SQLite compatibility initialization is additive, as it is in normal development.
    await createAppearanceRepository(prisma).read();
    return prisma.siteSetting.findUnique({ where: { key: 'theme' } });
  })();
  const start = async () => {
    const server = createApp({ uploadDirectory: temp }).listen(0, '127.0.0.1');
    servers.push(server); await once(server, 'listening'); return server;
  };
  const capture = async (response) => {
    for (const cookie of response.headers['set-cookie'] ?? []) {
      if (!cookie.startsWith('market_session=')) continue;
      const signed = decodeURIComponent(cookie.split(';')[0].slice('market_session='.length));
      if (!signed.startsWith('s:')) continue;
      const idHash = sessionHash(signed.slice(2, signed.lastIndexOf('.')));
      sessions.add(idHash);
      const row = await prisma.session.findUnique({ where: { idHash } });
      const customerId = row && JSON.parse(row.data).customerId;
      if (customerId) users.add(customerId);
    }
    if (response.body.order?.id) {
      orders.add(response.body.order.id);
      const row = await prisma.order.findUnique({ where: { id: response.body.order.id } });
      if (row?.userId) users.add(row.userId);
    }
    return response;
  };
  const csrf = async (agent) => {
    const response = await capture(await agent.get('/api/csrf'));
    assert.equal(response.status, 200);
    return response.body.csrfToken;
  };
  const write = async (agent, method, url, body = {}) => {
    const token = await csrf(agent);
    return capture(await agent[method](url).set('X-CSRF-Token', token).send(body).timeout({ deadline: 20000 }));
  };
  const storeCall = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (error, data) => error ? reject(error) : resolve(data)));
  const orderData = (number) => ({ orderNumber: `${run}-${number}`, customerEmail: 'fixture@example.test', totalCents: 1200 });
  const categoryData = (slug) => ({ name: 'MySQL fixture 🛒', slug, description: 'Fictional supplier category for local integration.', priceCents: 1200, imageUrl: '/images/default-category.svg' });
  let server, admin, buyer, stranger, category, order;
  try {
    await t.test('local target, migration history, InnoDB, foreign keys, column types and indexes', async () => {
      if (!mysql) {
        const indexes = await prisma.$queryRaw`PRAGMA index_list('Session')`;
        assert.ok(indexes.some((index) => index.name === 'Session_expiresAt_idx'));
        return;
      }
      const tables = await inspectDatabase(prisma);
      assert.equal(tables.length, 15);
      assert.ok(tables.every((table) => table.engine === 'InnoDB'));
      const migrations = await prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at, checksum FROM _prisma_migrations ORDER BY started_at`;
      assert.deepEqual(migrations.map((entry) => entry.migration_name), ['202610190001_init', '202610190002_authentication']);
      assert.ok(migrations.every((entry) => entry.finished_at && !entry.rolled_back_at));
      const { createHash } = await import('node:crypto');
      for (const entry of migrations) {
        const migration = await readFile(new URL(`../../prisma/mysql/migrations/${entry.migration_name}/migration.sql`, import.meta.url));
        assert.equal(entry.checksum, createHash('sha256').update(migration).digest('hex'));
      }
      const fks = await prisma.$queryRaw`SELECT DELETE_RULE AS rule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()`;
      assert.equal(fks.length, 11);
      assert.equal(fks.filter((fk) => fk.rule === 'CASCADE').length, 8);
      assert.ok(fks.some((fk) => fk.rule === 'SET NULL'));
      assert.ok(fks.some((fk) => fk.rule === 'RESTRICT' || fk.rule === 'NO ACTION'));
      const indexes = await prisma.$queryRaw`SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`;
      for (const name of ['User_email_key', 'Category_slug_key', 'Order_orderNumber_key', 'Payment_orderId_key', 'EmailDelivery_orderId_key']) {
        assert.ok(indexes.some((index) => index.name === name && Number(index.nonUnique) === 0), name);
      }
      for (const name of ['Session_expiresAt_idx', 'Order_userId_createdAt_idx', 'SupplierContact_categoryId_idx', 'OrderItem_orderId_idx', 'OrderItem_categoryId_idx']) assert.ok(indexes.some((index) => index.name === name), name);
      const columns = await prisma.$queryRaw`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS name, DATA_TYPE AS type, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`;
      assert.equal(columns.find((col) => col.tableName.toLowerCase() === 'emaildelivery' && col.name === 'body').type, 'longtext');
      assert.ok(columns.filter((col) => col.collation && col.tableName !== '_prisma_migrations').every((col) => col.collation === 'utf8mb4_0900_bin'));
    });

    await t.test('unique identifiers, case-sensitive keys, invalid FK and atomic nested rollback', async () => {
      category = await prisma.category.create({ data: categoryData(`${run}-category`) }); categories.add(category.id);
      await assert.rejects(prisma.category.create({ data: categoryData(category.slug) }), { code: 'P2002' });
      const differentCase = await prisma.category.create({ data: categoryData(category.slug.toUpperCase()) }); categories.add(differentCase.id);
      await assert.rejects(prisma.supplierContact.create({ data: { categoryId: randomUUID(), supplierName: 'Invalid', email: 'fixture@example.test' } }), { code: 'P2003' });
      const number = `${run}-rollback`;
      await assert.rejects(prisma.order.create({ data: { ...orderData('rollback'), items: { create: { categoryId: randomUUID(), categoryName: 'Missing fixture', priceCents: 1200 } }, payment: { create: {} } } }), { code: 'P2003' });
      assert.equal(await prisma.order.findUnique({ where: { orderNumber: number } }), null);
    });

    await t.test('session IDs are hashed, survive independent clients, expire and never revive on touch', async () => {
      const store = new DatabaseSessionStore(prisma);
      const id = randomUUID(), idHash = sessionHash(id); sessions.add(idHash);
      const data = { cookie: { expires: new Date(Date.now() + 60000), originalMaxAge: 60000, httpOnly: true, path: '/' }, userRole: 'ADMIN' };
      await storeCall(store, 'set', id, data);
      const row = await prisma.session.findUniqueOrThrow({ where: { idHash } });
      assert.match(row.idHash, /^[a-f0-9]{64}$/); assert.ok(!JSON.stringify(row).includes(id));
      const independent = new PrismaClient();
      try { assert.equal((await storeCall(new DatabaseSessionStore(independent), 'get', id)).userRole, 'ADMIN'); }
      finally { await independent.$disconnect(); }
      await prisma.session.update({ where: { idHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await storeCall(store, 'touch', id, data);
      assert.equal(await storeCall(store, 'get', id), null);
      assert.equal(await prisma.session.findUnique({ where: { idHash } }), null);
      await storeCall(store, 'touch', id, data);
      assert.equal(await prisma.session.findUnique({ where: { idHash } }), null);
      await storeCall(store, 'set', id, data);
      await storeCall(store, 'destroy', id);
      assert.equal(await storeCall(store, 'get', id), null);
    });

    server = await start(); admin = request.agent(server); buyer = request.agent(server); stranger = request.agent(server);
    await capture(await buyer.get('/api/auth/me')); await capture(await stranger.get('/api/auth/me'));
    const adminLogin = await write(admin, 'post', '/api/dev/session', { role: 'ADMIN' });
    assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.body));

    await t.test('themes persist across app instances and remain restricted to ADMIN', async () => {
      assert.equal((await write(buyer, 'put', '/api/admin/appearance', { theme: 'dark' })).status, 403);
      for (const theme of ['classic', 'minimal', 'marketplace', 'dark']) {
        assert.equal((await write(admin, 'put', '/api/admin/appearance', { theme })).status, 200);
        assert.deepEqual((await request(await start()).get('/api/appearance')).body, { theme });
      }
      assert.equal((await write(admin, 'put', '/api/admin/appearance', { theme: 'invalid' })).status, 400);
      const contact = await write(admin, 'post', `/api/admin/categories/${category.id}/contacts`, { supplierName: 'Fictional supplier 🛒', email: 'private-fixture@example.test', notes: 'é'.repeat(1500) });
      assert.equal(contact.status, 201);
      assert.equal((await prisma.supplierContact.findUnique({ where: { id: contact.body.item.id } })).notes.length, 1500);
    });

    await t.test('session rotation deletes the old hash; ADMIN survives a fresh app; logout deletes session', async () => {
      const identity = request.agent(server);
      const first = await capture(await identity.get('/api/csrf'));
      const oldCookie = first.headers['set-cookie'].find((cookie) => cookie.startsWith('market_session=')).split(';')[0];
      const signed = decodeURIComponent(oldCookie.slice('market_session='.length));
      const oldHash = sessionHash(signed.slice(2, signed.lastIndexOf('.')));
      const switched = await write(identity, 'post', '/api/dev/session', { role: 'ADMIN' });
      assert.equal(switched.status, 200);
      assert.equal(await prisma.session.findUnique({ where: { idHash: oldHash } }), null);
      const cookie = switched.headers['set-cookie'].find((entry) => entry.startsWith('market_session=')).split(';')[0];
      const value = decodeURIComponent(cookie.slice('market_session='.length));
      const hash = sessionHash(value.slice(2, value.lastIndexOf('.')));
      assert.equal((await request(await start()).get('/api/admin/orders').set('Cookie', cookie)).status, 200);
      assert.equal((await write(identity, 'post', '/api/dev/session/clear')).status, 200);
      assert.equal(await prisma.session.findUnique({ where: { idHash: hash } }), null);
      assert.equal((await request(server).get('/api/admin/orders').set('Cookie', cookie)).status, 403);
    });

    await t.test('checkout enforces ownership, server prices, idempotency and unpaid delivery gating', async () => {
      const key = randomUUID();
      const payload = { customerEmail: 'buyer@example.test', checkoutKey: key, totalCents: 1, status: 'PAID', items: [{ categoryId: category.id }, { categoryId: category.id }] };
      const created = await write(buyer, 'post', '/api/orders', payload);
      assert.equal(created.status, 201); order = created.body.order;
      assert.equal(order.totalCents, 1200); assert.equal(order.items.length, 1); assert.equal(order.status, 'PENDING');
      assert.equal((await buyer.get(`/api/orders/${order.id}/delivery`)).status, 409);
      assert.equal((await stranger.get(`/api/orders/${order.id}`)).status, 404);
      assert.equal((await write(stranger, 'post', `/api/dev/payments/${order.id}/simulate`)).status, 404);
      const replay = await Promise.all([write(buyer, 'post', '/api/orders', payload), write(buyer, 'post', '/api/orders', payload)]);
      replay.forEach((result) => { assert.equal(result.status, 200); assert.equal(result.body.order.id, order.id); });
      assert.equal((await write(buyer, 'post', '/api/orders', { ...payload, customerEmail: 'changed@example.test' })).status, 409);
      await assert.rejects(prisma.payment.create({ data: { orderId: order.id } }), { code: 'P2002' });
      await assert.rejects(prisma.emailDelivery.create({ data: { orderId: order.id, recipient: 'fixture@example.test', subject: 'Fixture', body: '' } }), { code: 'P2002' });
      await assert.rejects(prisma.category.delete({ where: { id: category.id } }), { code: 'P2003' });
    });

    await t.test('concurrent payment confirmations deliver contacts once; large email bodies round-trip', async () => {
      const confirmations = await Promise.all([
        write(buyer, 'post', `/api/dev/payments/${order.id}/simulate`),
        write(admin, 'post', `/api/admin/orders/${order.id}/confirm-payment`),
        write(admin, 'post', `/api/admin/orders/${order.id}/confirm-payment`),
      ]);
      confirmations.forEach((response) => assert.equal(response.status, 200, JSON.stringify(response.body)));
      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
      assert.ok(payment.confirmedAt);
      assert.equal((await write(buyer, 'post', `/api/dev/payments/${order.id}/simulate`)).status, 200);
      assert.equal((await prisma.payment.findUnique({ where: { orderId: order.id } })).confirmedAt.toISOString(), payment.confirmedAt.toISOString());
      const delivery = await prisma.emailDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
      assert.equal(delivery.status, 'SENT'); assert.equal(delivery.attempts, 1);
      assert.match((await buyer.get(`/api/orders/${order.id}/delivery`)).body.delivery.body, /private-fixture@example.test/);
      assert.equal((await stranger.get(`/api/orders/${order.id}/delivery`)).status, 404);
      const large = 'Fictional 🛒 é'.repeat(10000);
      await prisma.emailDelivery.update({ where: { orderId: order.id }, data: { body: large } });
      assert.equal((await prisma.emailDelivery.findUnique({ where: { orderId: order.id } })).body, large);
    });

    await t.test('user deletion sets nullable ownership; order cascades children; category cascades contacts', async () => {
      const owner = await prisma.user.create({ data: { role: 'GUEST', displayName: 'Fixture', email: `${run}@example.test` } }); users.add(owner.id);
      const row = await prisma.order.create({ data: { ...orderData('cascade'), userId: owner.id, items: { create: { categoryId: category.id, categoryName: category.name, priceCents: 1200 } }, payment: { create: {} }, emailDelivery: { create: { recipient: 'fixture@example.test', subject: 'Fixture', body: '' } } } }); orders.add(row.id);
      await prisma.user.delete({ where: { id: owner.id } });
      assert.equal((await prisma.order.findUnique({ where: { id: row.id } })).userId, null);
      await prisma.order.delete({ where: { id: row.id } });
      for (const model of ['payment', 'emailDelivery', 'orderItem']) assert.equal(await prisma[model].count({ where: { orderId: row.id } }), 0);
      const unused = await prisma.category.create({ data: { ...categoryData(`${run}-unused`), contacts: { create: { supplierName: 'Fixture', email: 'fixture@example.test' } } } }); categories.add(unused.id);
      await prisma.category.delete({ where: { id: unused.id } });
      assert.equal(await prisma.supplierContact.count({ where: { categoryId: unused.id } }), 0);
    });

    await t.test('production/staging remain blocked and mock payments require explicit development flag', async () => {
      for (const mode of ['production', 'staging']) {
        process.env.NODE_ENV = mode;
        assert.throws(() => createApp(), /NODE_ENV=development/);
        assert.equal((await buyer.get('/api/categories')).status, 503);
      }
      process.env.NODE_ENV = 'development';
      process.env.ALLOW_MOCK_PAYMENT = 'false';
      assert.equal((await write(buyer, 'post', `/api/dev/payments/${order.id}/simulate`)).status, 403);
      process.env.ALLOW_MOCK_PAYMENT = 'true';
    });
  } finally {
    process.env.NODE_ENV = 'development';
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    // Clean only this run's recorded fixture IDs. Existing test data stays intact.
    await prisma.order.deleteMany({ where: { id: { in: [...orders] } } });
    await prisma.category.deleteMany({ where: { id: { in: [...categories] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
    await prisma.session.deleteMany({ where: { idHash: { in: [...sessions] } } });
    if (originalSetting) await prisma.siteSetting.upsert({ where: { key: 'theme' }, create: originalSetting, update: { value: originalSetting.value } });
    else await prisma.siteSetting.deleteMany({ where: { key: 'theme' } });
    await prisma.$disconnect();
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-db-integration-'));
    await rm(temp, { recursive: true, force: true });
  }
});
