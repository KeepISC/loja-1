import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { encodeEmailContent, decodeEmailContent } from '../src/email-content.ts';

const temp = await mkdtemp(path.join(tmpdir(), 'marketplace-phase1-'));
const database = path.join(temp, 'test.db');
const uploads = path.join(temp, 'uploads');
const sqlite = new DatabaseSync(database);
sqlite.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
process.env.DATABASE_URL = 'file:' + database.replaceAll('\\', '/');
process.env.NODE_ENV = 'development';
process.env.ALLOW_MOCK_PAYMENT = 'true';
process.env.SESSION_SECRET = 'fictional-regression-session-secret';
const { createApp, prisma } = await import('../src/app.ts');
const { seedDatabase } = await import('../src/seed.ts');
const servers = [];
let server, admin, a, b;
const start = async () => {
  const running = createApp({ uploadDirectory: uploads }).listen(0, '127.0.0.1');
  servers.push(running);
  await once(running, 'listening');
  return running;
};
const post = (agent, url, body = {}) => agent.post(url).send(body).timeout({ deadline: 15000 });
const bodyContainsContact = (body) => /private-supplier-[ab]@example\.test/.test(JSON.stringify(body));
const newOrder = async (buyer, email = 'buyer@example.test', extra = {}) => {
  const result = await post(buyer, '/api/orders', { customerEmail: email, items: [{ categoryId: a.id }], ...extra });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.order;
};
const readOrder = (id) => prisma.order.findUniqueOrThrow({ where: { id }, include: { items: true, payment: true, emailDelivery: true } });

before(async () => {
  server = await start();
  admin = request.agent(server);
  assert.equal((await post(admin, '/api/dev/session', { role: 'ADMIN' })).status, 200);
  for (const slug of ['a', 'b']) {
    const result = await post(admin, '/api/admin/categories', { name: 'Fixture ' + slug, slug: 'fixture-' + slug, description: 'Fictional category for regression testing', priceCents: slug === 'a' ? 1600 : 2400 });
    assert.equal(result.status, 201);
    if (slug === 'a') a = result.body.item; else b = result.body.item;
    assert.equal((await post(admin, `/api/admin/categories/${result.body.item.id}/contacts`, { supplierName: 'Private Supplier ' + slug, email: `private-supplier-${slug}@example.test` })).status, 201);
  }
});

after(async () => {
  await prisma.$disconnect();
  for (const running of servers) await new Promise((resolve) => running.close(resolve));
  sqlite.close();
  // Only remove this test's verified temporary directory, never project data.
  assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep));
  assert.ok(path.basename(temp).startsWith('marketplace-phase1-'));
  await rm(temp, { recursive: true, force: true });
});

test('S01/S02: public and unauthorized APIs never expose private contacts', async () => {
  const visitor = request.agent(server);
  for (const url of ['/api/categories', `/api/categories/${a.slug}`, '/api/admin/categories', `/api/admin/categories/${a.id}/contacts`, '/api/admin/orders', '/api/dev/email-outbox']) {
    const result = await visitor.get(url);
    assert.equal(result.status, url.startsWith('/api/categories') ? 200 : 403, url);
    assert.equal(bodyContainsContact(result.body), false, url);
  }
  assert.equal((await post(visitor, '/api/admin/categories', {})).status, 403);
});

test('S01: per-session ownership blocks other guests before and after payment', async () => {
  const buyer = request.agent(server), other = request.agent(server);
  const order = await newOrder(buyer);
  const otherOrder = await newOrder(other);
  assert.notEqual((await readOrder(order.id)).userId, (await readOrder(otherOrder.id)).userId);
  for (const stranger of [other, request.agent(server)]) {
    assert.equal((await stranger.get('/api/orders/' + order.id)).status, 404);
    assert.equal((await post(stranger, '/api/dev/payments/' + order.id + '/simulate')).status, 404);
  }
  assert.equal((await post(buyer, '/api/dev/payments/' + order.id + '/simulate')).status, 200);
  const own = await buyer.get('/api/orders/' + order.id);
  assert.equal(own.status, 200);
  assert.equal(bodyContainsContact(own.body), false);
  assert.equal(own.body.order.userId, undefined);
  assert.equal(own.body.order.emailDelivery.body, undefined);
  assert.equal((await other.get('/api/orders/' + order.id)).status, 404);
  assert.equal((await admin.get('/api/orders/' + order.id)).status, 200);
});

test('S03: unpaid orders cannot deliver even through admin retry or legacy SENT records', async () => {
  const order = await newOrder(request.agent(server));
  const retry = await post(admin, '/api/dev/email-outbox/retry/' + order.id);
  assert.equal(retry.status, 409);
  assert.equal(bodyContainsContact(retry.body), false);
  let stored = await readOrder(order.id);
  assert.equal(stored.payment.status, 'PENDING');
  assert.equal(stored.emailDelivery.status, 'NOT_SENT');
  assert.equal(stored.emailDelivery.attempts, 0);
  await prisma.emailDelivery.update({ where: { orderId: order.id }, data: { status: 'SENT', body: 'private-supplier-a@example.test' } });
  assert.equal((await post(admin, '/api/dev/email-outbox/retry/' + order.id)).status, 409);
  const outbox = await admin.get('/api/dev/email-outbox');
  assert.equal(outbox.body.items.find((item) => item.orderId === order.id).body, '');
});

test('S01/S02/S03/S07: normal purchase delivers only purchased category and protects outbox', async () => {
  const buyer = request.agent(server);
  const order = await newOrder(buyer);
  const pending = await readOrder(order.id);
  assert.equal(pending.status, 'PENDING');
  assert.equal(pending.payment.status, 'PENDING');
  assert.equal(pending.emailDelivery.body, '');
  const paid = await post(buyer, '/api/dev/payments/' + order.id + '/simulate');
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.order.status, 'PAID');
  assert.equal(paid.body.deliveryStatus, 'SENT');
  assert.equal(bodyContainsContact(paid.body), false);
  const stored = await readOrder(order.id);
  assert.equal(stored.payment.status, 'PAID');
  assert.equal(stored.emailDelivery.status, 'SENT');
  assert.match(stored.emailDelivery.body, /private-supplier-a@example\.test/);
  assert.doesNotMatch(stored.emailDelivery.body, /private-supplier-b@example\.test/);
  assert.equal((await buyer.get('/api/dev/email-outbox')).status, 403);
  const outbox = await admin.get('/api/dev/email-outbox');
  assert.match(outbox.body.items.find((item) => item.orderId === order.id).body, /private-supplier-a@example\.test/);
  const independent = new prisma.constructor();
  assert.equal((await independent.emailDelivery.findUnique({ where: { orderId: order.id } })).status, 'SENT');
  await independent.$disconnect();
});

test('Payment status, ownership, role and totals cannot be forged in ordinary order requests', async () => {
  const buyer = request.agent(server);
  const order = await newOrder(buyer, 'forgery@example.test', {
    status: 'PAID', totalCents: 1, userId: 'someone-else', role: 'ADMIN', payment: { status: 'PAID' },
    items: [{ categoryId: a.id, priceCents: 1, quantity: 999 }, { categoryId: a.id }],
  });
  assert.equal(order.status, 'PENDING');
  assert.equal(order.payment.status, 'PENDING');
  assert.equal(order.totalCents, 1600);
  assert.equal(order.items.length, 1);
  assert.equal((await post(buyer, '/api/admin/orders/' + order.id + '/confirm-payment')).status, 403);
  assert.equal((await buyer.put('/api/orders/' + order.id).send({ status: 'PAID' })).status, 404);
  assert.equal((await readOrder(order.id)).payment.status, 'PENDING');
});

test('S06: sequential and concurrent guest/admin confirmations deliver once', async () => {
  const buyer = request.agent(server);
  const order = await newOrder(buyer, 'idempotent@example.test');
  // A second app has its own sessions but shares the persistent database/outbox.
  const secondAdmin = request.agent(await start());
  await post(secondAdmin, '/api/dev/session', { role: 'ADMIN' });
  const results = await Promise.all([
    post(buyer, '/api/dev/payments/' + order.id + '/simulate'),
    post(admin, '/api/admin/orders/' + order.id + '/confirm-payment'),
    post(secondAdmin, '/api/admin/orders/' + order.id + '/confirm-payment'),
  ]);
  results.forEach((result) => assert.equal(result.status, 200, JSON.stringify(result.body)));
  const confirmedAt = (await readOrder(order.id)).payment.confirmedAt.toISOString();
  await post(buyer, '/api/dev/payments/' + order.id + '/simulate');
  await post(admin, '/api/admin/orders/' + order.id + '/confirm-payment');
  await post(admin, '/api/dev/email-outbox/retry/' + order.id);
  const stored = await readOrder(order.id);
  assert.equal(stored.payment.confirmedAt.toISOString(), confirmedAt);
  assert.equal(stored.emailDelivery.attempts, 1);
  assert.equal(await prisma.emailDelivery.count({ where: { orderId: order.id } }), 1);
});

test('S07/F07: nested checkout creation rolls back on item failure', async () => {
  sqlite.exec("CREATE TRIGGER fail_items BEFORE INSERT ON OrderItem BEGIN SELECT RAISE(ABORT, 'fictional item failure'); END;");
  try {
    const result = await post(request.agent(server), '/api/orders', { customerEmail: 'rollback@example.test', items: [{ categoryId: a.id }] });
    assert.ok(result.status >= 400);
    assert.equal(await prisma.order.count({ where: { customerEmail: 'rollback@example.test' } }), 0);
  } finally { sqlite.exec('DROP TRIGGER fail_items'); }
});

test('S07/F07: failed order transition rolls back payment; replay recovers', async () => {
  const buyer = request.agent(server);
  const order = await newOrder(buyer, 'transition-fault@example.test');
  sqlite.exec(`CREATE TRIGGER fail_transition BEFORE UPDATE OF status ON "Order" WHEN NEW.status = 'PAID' AND OLD.customerEmail = 'transition-fault@example.test' BEGIN SELECT RAISE(ABORT, 'fictional order failure'); END;`);
  try {
    // SQLite RAISE(ABORT) is surfaced by this Prisma runtime as a constraint error (400).
    assert.equal((await post(buyer, '/api/dev/payments/' + order.id + '/simulate')).status, 400);
    const stored = await readOrder(order.id);
    assert.equal(stored.status, 'PENDING');
    assert.equal(stored.payment.status, 'PENDING');
    assert.equal(stored.emailDelivery.status, 'NOT_SENT');
  } finally { sqlite.exec('DROP TRIGGER fail_transition'); }
  assert.equal((await post(buyer, '/api/dev/payments/' + order.id + '/simulate')).status, 200);
});

test('S06/S07/F07: failed delivery records failure and retries the same paid order once', async () => {
  const buyer = request.agent(server);
  const order = await newOrder(buyer, 'delivery-fault@example.test');
  sqlite.exec(`CREATE TRIGGER fail_delivery BEFORE UPDATE OF status ON EmailDelivery WHEN NEW.status = 'SENT' AND OLD.recipient = 'delivery-fault@example.test' BEGIN SELECT RAISE(ABORT, 'fictional delivery failure'); END;`);
  try {
    const result = await post(buyer, '/api/dev/payments/' + order.id + '/simulate');
    assert.equal(result.status, 400);
    assert.equal(bodyContainsContact(result.body), false);
    const stored = await readOrder(order.id);
    assert.equal(stored.status, 'PAID');
    assert.equal(stored.payment.status, 'PAID');
    assert.equal(stored.emailDelivery.status, 'FAILED');
    assert.equal(stored.emailDelivery.attempts, 1);
    assert.ok(stored.emailDelivery.lastError);
    assert.equal(stored.emailDelivery.body, '');
  } finally { sqlite.exec('DROP TRIGGER fail_delivery'); }
  const result = await post(buyer, '/api/dev/payments/' + order.id + '/simulate');
  assert.equal(result.status, 200);
  assert.equal(result.body.order.id, order.id);
  assert.equal((await readOrder(order.id)).emailDelivery.attempts, 2);
  await post(admin, '/api/dev/email-outbox/retry/' + order.id);
  assert.equal((await readOrder(order.id)).emailDelivery.attempts, 2);
});

test('S07: confirmation reconciles legacy PAID payment with PENDING order without replacing timestamp', async () => {
  const buyer = request.agent(server), order = await newOrder(buyer);
  const timestamp = new Date('2026-01-01T00:00:00Z');
  await prisma.payment.update({ where: { orderId: order.id }, data: { status: 'PAID', confirmedAt: timestamp } });
  assert.equal((await post(buyer, '/api/dev/payments/' + order.id + '/simulate')).status, 200);
  const stored = await readOrder(order.id);
  assert.equal(stored.status, 'PAID');
  assert.equal(stored.payment.confirmedAt.toISOString(), timestamp.toISOString());
  assert.equal(stored.emailDelivery.status, 'SENT');
});

test('S07: invalid order/payment states cannot be forced into PAID or delivered', async () => {
  const buyer = request.agent(server), order = await newOrder(buyer);
  await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  assert.equal((await post(buyer, '/api/dev/payments/' + order.id + '/simulate')).status, 409);
  assert.equal((await readOrder(order.id)).payment.status, 'PENDING');
  await prisma.order.update({ where: { id: order.id }, data: { status: 'PENDING' } });
  await prisma.payment.update({ where: { orderId: order.id }, data: { status: 'FAILED' } });
  assert.equal((await post(admin, '/api/admin/orders/' + order.id + '/confirm-payment')).status, 409);
  assert.equal((await post(admin, '/api/dev/email-outbox/retry/' + order.id)).status, 409);
  assert.equal((await readOrder(order.id)).emailDelivery.status, 'NOT_SENT');
});

test('S04: reject HTML, SVG, MIME spoofing, oversized files and unauthorized uploads', async () => {
  for (const [filename, contentType, bytes] of [
    ['evil.html', 'image/png', Buffer.from('<script>alert(1)</script>')],
    ['evil.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>')],
    ['evil.svg', 'image/png', Buffer.from('<svg onload="alert(1)"/>')],
    ['large.png', 'image/png', Buffer.alloc(2 * 1024 * 1024 + 1)],
  ]) {
    const result = await admin.post(`/api/admin/categories/${a.id}/image`).attach('image', bytes, { filename, contentType });
    assert.equal(result.status, 400, filename);
  }
  assert.equal((await request(server).post(`/api/admin/categories/${a.id}/image`).attach('image', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' })).status, 403);
});

test('S04/F05: valid image gets server filename and safe headers; legacy active uploads are blocked', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/tGQAAAAASUVORK5CYII=', 'base64');
  const uploaded = await admin.post(`/api/admin/categories/${a.id}/image`).attach('image', png, { filename: 'untrusted.html', contentType: 'image/png' });
  assert.equal(uploaded.status, 200);
  assert.match(uploaded.body.imageUrl, /^\/uploads\/[0-9a-f-]+\.png$/);
  const served = await request(server).get(uploaded.body.imageUrl);
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-type'], 'image/png');
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
  assert.match(served.headers['content-security-policy'], /sandbox/);
  assert.deepEqual(served.body, png);
  assert.equal((await admin.post(`/api/admin/categories/${a.id}/image`).attach('image', png, { filename: 'wrong.jpg', contentType: 'image/jpeg' })).status, 400);
  await writeFile(path.join(uploads, 'legacy.html'), '<script>alert(1)</script>');
  await writeFile(path.join(uploads, 'legacy.png'), '<script>alert(1)</script>');
  for (const url of ['/uploads/legacy.html', '/uploads/legacy.png', '/upload%73/legacy.html']) assert.equal((await request(server).get(url)).status, 404);
  const before = (await readdir(uploads)).length;
  assert.equal((await admin.post('/api/admin/categories/missing/image').attach('image', png, { filename: 'ok.png', contentType: 'image/png' })).status, 404);
  assert.equal((await readdir(uploads)).length, before);
});

test('S05: startup fails closed in every non-development mode and routes disable after mode changes', async () => {
  try {
    for (const mode of ['production', 'staging', 'test', '']) {
      process.env.NODE_ENV = mode;
      assert.throws(() => createApp(), /NODE_ENV=development/);
      for (const url of ['/api/auth/me', '/api/orders/anything', '/api/dev/email-outbox']) assert.equal((await request(server).get(url)).status, 503);
      assert.equal((await post(admin, '/api/dev/email-outbox/retry/anything')).status, 503);
      assert.equal((await post(admin, '/api/admin/orders/anything/confirm-payment')).status, 503);
      assert.equal((await post(request.agent(server), '/api/orders', {})).status, 503);
    }
  } finally { process.env.NODE_ENV = 'development'; }
});

test('S05: simulation requires explicit mock-payment flag; ordinary checkout remains pending', async () => {
  const buyer = request.agent(server), order = await newOrder(buyer);
  try {
    for (const flag of ['false', '']) {
      process.env.ALLOW_MOCK_PAYMENT = flag;
      assert.equal((await post(buyer, '/api/dev/payments/' + order.id + '/simulate')).status, 403);
      assert.equal((await post(admin, '/api/admin/orders/' + order.id + '/confirm-payment')).status, 403);
      assert.equal((await readOrder(order.id)).payment.status, 'PENDING');
    }
  } finally { process.env.ALLOW_MOCK_PAYMENT = 'true'; }
});

test('F02: account switching always returns complete auth state and remains reversible', async () => {
  const visitor = request.agent(server);
  for (const role of ['ADMIN', 'GUEST', 'ADMIN']) {
    const response = await post(visitor, '/api/dev/session', { role });
    assert.equal(response.body.user.role, role);
    assert.equal(response.body.user.mode, 'development');
    assert.equal(response.body.user.mockAccountSwitchingEnabled, true);
    assert.equal((await visitor.get('/api/auth/me')).body.role, role);
  }
});

test('F05: assets and root environment path remain independent of current directory', async () => {
  const previous = process.cwd();
  try {
    process.chdir(temp);
    const alternate = await start();
    assert.equal((await request(alternate).get('/images/default-category.svg')).status, 200);
    const { projectRoot } = await import('../src/config.ts');
    const { uploadDir } = await import('../src/config.ts');
    assert.equal(uploadDir, path.join(projectRoot, 'backend', 'public', 'uploads'));
    assert.ok((await readFile(path.join(projectRoot, '.env.example'), 'utf8')).includes('ALLOW_MOCK_PAYMENT'));
  } finally { process.chdir(previous); }
});

test('F06: reseeding preserves edited/deactivated categories and deleted demo contacts', async () => {
  await seedDatabase(prisma);
  const demo = await prisma.category.findUniqueOrThrow({ where: { slug: 'electronica' } });
  await prisma.category.update({ where: { id: demo.id }, data: { name: 'Edited fixture', active: false, priceCents: 9999 } });
  await prisma.supplierContact.deleteMany({ where: { categoryId: demo.id } });
  await seedDatabase(prisma);
  const preserved = await prisma.category.findUniqueOrThrow({ where: { id: demo.id }, include: { contacts: true } });
  assert.equal(preserved.name, 'Edited fixture');
  assert.equal(preserved.active, false);
  assert.equal(preserved.priceCents, 9999);
  assert.equal(preserved.contacts.length, 0);
});

test('F07: expected conflicts/missing records/invalid JSON return controlled errors; backend stays alive', async () => {
  const duplicate = await post(admin, '/api/admin/categories', { name: a.name, slug: a.slug, description: a.description, priceCents: a.priceCents });
  assert.equal(duplicate.status, 409);
  const missing = await admin.put('/api/admin/categories/missing').send({ name: a.name, slug: 'missing-slug', description: a.description, priceCents: 100 });
  assert.equal(missing.status, 404);
  assert.equal((await admin.post('/api/orders').set('Content-Type', 'application/json').send('{bad json')).status, 400);
  assert.equal((await request(server).get('/api/health')).status, 200);
});

test('F07: unexpected async failures return sanitized 500 responses without private data', async () => {
  const original = prisma.category.findMany;
  prisma.category.findMany = async () => { throw new Error('private-supplier-a@example.test'); };
  try {
    const result = await request(server).get('/api/categories');
    assert.equal(result.status, 500);
    assert.equal(bodyContainsContact(result.body), false);
  } finally { prisma.category.findMany = original; }
  assert.equal((await request(server).get('/api/health')).status, 200);
});

test('F07: checkout replay survives a lost creation response without duplicate orders', async () => {
  const buyer = request.agent(server), key = randomUUID();
  const payload = { customerEmail: 'checkout-replay@example.test', checkoutKey: key, items: [{ categoryId: a.id }] };
  const first = await post(buyer, '/api/orders', payload);
  const replay = await post(buyer, '/api/orders', payload);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(first.body.order.id, replay.body.order.id);
  assert.equal(await prisma.order.count({ where: { customerEmail: payload.customerEmail } }), 1);
  assert.equal((await post(buyer, '/api/orders', { ...payload, customerEmail: 'changed@example.test' })).status, 409);
  const stranger = await post(request.agent(server), '/api/orders', payload);
  assert.equal(stranger.status, 201);
  assert.notEqual(stranger.body.order.id, first.body.order.id);
});

test('F07: concurrent creation replays with an established session produce one order', async () => {
  const buyer = request.agent(server);
  assert.equal((await buyer.get('/api/auth/me')).status, 200);
  const payload = { customerEmail: 'concurrent-checkout@example.test', checkoutKey: randomUUID(), items: [{ categoryId: a.id }] };
  const results = await Promise.all([post(buyer, '/api/orders', payload), post(buyer, '/api/orders', payload)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 201]);
  assert.equal(results[0].body.order.id, results[1].body.order.id);
  assert.equal(await prisma.order.count({ where: { customerEmail: payload.customerEmail } }), 1);
});

test('F03/V02: history and delivery are scoped to the current customer, with payment gating', async () => {
  const buyer = request.agent(server), stranger = request.agent(server);
  assert.equal((await stranger.get('/api/orders')).status, 401);
  const order = await newOrder(buyer), foreign = await newOrder(stranger);
  const ownHistory = await buyer.get('/api/orders');
  assert.equal(ownHistory.status, 200);
  assert.ok(ownHistory.body.items.some((item) => item.id === order.id));
  assert.ok(!ownHistory.body.items.some((item) => item.id === foreign.id));
  assert.equal(bodyContainsContact(ownHistory.body), false);
  assert.equal((await buyer.get(`/api/orders/${order.id}/delivery`)).status, 409);
  assert.equal((await stranger.get(`/api/orders/${order.id}/delivery`)).status, 404);
  assert.equal((await request(server).get(`/api/orders/${order.id}/delivery`)).status, 404);
  await post(buyer, `/api/dev/payments/${order.id}/simulate`);
  const email = await buyer.get(`/api/orders/${order.id}/delivery`);
  assert.equal(email.status, 200);
  assert.match(email.body.delivery.body, /private-supplier-a@example\.test/);
  assert.doesNotMatch(email.body.delivery.body, /private-supplier-b@example\.test/);
  assert.equal((await stranger.get(`/api/orders/${order.id}/delivery`)).status, 404);
  assert.equal(bodyContainsContact((await buyer.get('/api/orders')).body), false);
  const oldMode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal((await buyer.get(`/api/orders/${order.id}/delivery`)).status, 503);
    assert.equal((await buyer.get('/api/orders')).status, 503);
  } finally { process.env.NODE_ENV = oldMode; }
});

test('V01: actual compiled app refuses production and staging startup', async () => {
  const compiled = await import('../dist/app.js');
  try {
    for (const mode of ['production', 'staging']) {
      process.env.NODE_ENV = mode;
      assert.throws(() => compiled.createApp(), /NODE_ENV=development/);
    }
  } finally { process.env.NODE_ENV = 'development'; await compiled.prisma.$disconnect(); }
});

test('V01/F03/F04: compiled API plus frontend checkout completes the private, idempotent purchase workflow', async () => {
  const compiled = await import('../dist/app.js');
  const { createCheckout } = await import('../../frontend/src/checkout.ts');
  const running = compiled.createApp({ uploadDirectory: uploads }).listen(0, '127.0.0.1');
  servers.push(running); await once(running, 'listening');
  const manager = request.agent(running), buyer = request.agent(running), stranger = request.agent(running);
  const privateEmail = 'phase2-supplier@example.test';
  try {
    await post(manager, '/api/dev/session', { role: 'ADMIN' });
    const categoryData = { name: 'Phase 2 Category', slug: 'phase2-workflow', description: 'Fictional end-to-end workflow category', priceCents: 1900, active: true };
    const created = await post(manager, '/api/admin/categories', categoryData);
    assert.equal(created.status, 201);
    const category = created.body.item;
    const edited = await manager.put(`/api/admin/categories/${category.id}`).send({ ...categoryData, name: 'Phase 2 Edited', priceCents: 1950 });
    assert.equal(edited.status, 200);
    const added = await post(manager, `/api/admin/categories/${category.id}/contacts`, { supplierName: 'Phase 2 Supplier', email: 'before-edit@example.test' });
    assert.equal(added.status, 201);
    assert.equal((await manager.put(`/api/admin/categories/${category.id}/contacts/${added.body.item.id}`).send({ supplierName: 'Phase 2 Supplier', email: privateEmail, telephone: 'fictional-phone' })).status, 200);
    const removed = await post(manager, `/api/admin/categories/${category.id}/contacts`, { supplierName: 'Remove fixture', email: 'remove@example.test' });
    assert.equal((await manager.delete(`/api/admin/categories/${category.id}/contacts/${removed.body.item.id}`)).status, 200);
    assert.equal((await manager.get(`/api/admin/categories/${category.id}/contacts`)).body.contacts.length, 1);
    for (const path of ['/api/categories', '/api/categories/' + category.slug]) {
      const response = await buyer.get(path);
      assert.equal(response.status, 200);
      assert.ok(!JSON.stringify(response.body).includes(privateEmail));
    }
    let orderId;
    const api = async (url, options = {}) => {
      const response = options.method === 'POST' ? await post(buyer, url, options.body ? JSON.parse(options.body) : {}) : await buyer.get(url);
      assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.body));
      if (url === '/api/orders') {
        orderId = response.body.order.id;
        assert.equal(response.body.order.status, 'PENDING');
        assert.equal(response.body.order.payment.status, 'PENDING');
        assert.equal(response.body.order.emailDelivery.status, 'NOT_SENT');
        assert.equal(response.body.order.totalCents, 1950);
        assert.equal((await post(manager, `/api/dev/email-outbox/retry/${orderId}`)).status, 409);
        assert.equal((await stranger.get(`/api/orders/${orderId}`)).status, 404);
        assert.equal((await stranger.get('/api/dev/email-outbox')).status, 403);
      }
      assert.ok(!JSON.stringify(response.body).includes(privateEmail));
      return response.body;
    };
    const result = await createCheckout(api).complete([{ categoryId: category.id, name: category.name, priceCents: 1 }], 'phase2-buyer@example.test');
    assert.equal(result.status, 'PAID');
    assert.equal(result.emailDelivery.status, 'SENT');
    assert.equal(result.id, orderId);
    const preview = await buyer.get(`/api/orders/${orderId}/delivery`);
    assert.equal(preview.status, 200);
    assert.equal(preview.body.delivery.recipient, 'phase2-buyer@example.test');
    assert.ok(preview.body.delivery.body.includes(privateEmail));
    assert.ok(!preview.body.delivery.body.includes('private-supplier-b@example.test'));
    assert.ok(!preview.body.delivery.body.includes('remove@example.test'));
    assert.equal((await stranger.get(`/api/orders/${orderId}/delivery`)).status, 404);
    const outbox = await manager.get('/api/dev/email-outbox');
    assert.ok(outbox.body.items.find((item) => item.orderId === orderId).body.includes(privateEmail));
    assert.ok((await buyer.get('/api/orders')).body.items.some((item) => item.id === orderId));
    const repeats = await Promise.all([post(buyer, `/api/dev/payments/${orderId}/simulate`), post(manager, `/api/admin/orders/${orderId}/confirm-payment`), post(manager, `/api/dev/email-outbox/retry/${orderId}`)]);
    repeats.forEach((response) => assert.equal(response.status, 200));
    const stored = await readOrder(orderId);
    assert.equal(stored.emailDelivery.attempts, 1);
    assert.equal(await prisma.emailDelivery.count({ where: { orderId } }), 1);
    assert.equal((await manager.delete(`/api/admin/categories/${category.id}`)).status, 200);
    assert.ok(!(await buyer.get('/api/categories')).body.items.some((item) => item.id === category.id));
  } finally { await compiled.prisma.$disconnect(); }
});

test('Persistent guest credential restores an owned order in a fresh backend without the old role session', async () => {
  const buyer = request.agent(server);
  const identity = await buyer.get('/api/auth/me');
  const cookieHeader = identity.headers['set-cookie'].find((cookie) => cookie.startsWith('market_guest='));
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /SameSite=Lax/i);
  assert.match(cookieHeader, /Max-Age=604800/);
  const credential = cookieHeader.split(';')[0];
  const order = await newOrder(buyer, 'persistent-guest@example.test');
  assert.ok(!JSON.stringify(identity.body).includes(credential.split('=')[1]));
  assert.ok(!JSON.stringify(order).includes(credential.split('=')[1]));
  const stored = await readOrder(order.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: stored.userId } });
  assert.ok(!credential.includes(user.id));
  assert.ok(!user.email.includes(credential.split('=')[1]));

  const compiled = await import('../dist/app.js');
  const priorSecret = process.env.SESSION_SECRET;
  let restarted;
  try {
    process.env.SESSION_SECRET = 'different-role-session-secret-after-restart';
    restarted = compiled.createApp({ uploadDirectory: uploads }).listen(0, '127.0.0.1');
    servers.push(restarted); await once(restarted, 'listening');
  } finally { process.env.SESSION_SECRET = priorSecret; }
  try {
    const restored = await request(restarted).get('/api/orders/' + order.id).set('Cookie', credential);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.order.id, order.id);
    const history = await request(restarted).get('/api/orders').set('Cookie', credential);
    assert.equal(history.status, 200);
    assert.ok(history.body.items.some((item) => item.id === order.id));
    assert.equal((await request(restarted).get('/api/admin/orders').set('Cookie', credential)).status, 403);
    assert.equal((await request(restarted).get('/api/orders/' + order.id)).status, 404);
    const other = request.agent(restarted); await other.get('/api/auth/me');
    assert.equal((await other.get('/api/orders/' + order.id)).status, 404);
    assert.equal((await post(other, '/api/dev/payments/' + order.id + '/simulate')).status, 404);
    const confirmed = await request(restarted).post('/api/dev/payments/' + order.id + '/simulate').set('Cookie', credential).send({});
    assert.equal(confirmed.status, 200);
    assert.equal((await request(restarted).get(`/api/orders/${order.id}/delivery`).set('Cookie', credential)).status, 200);
    assert.equal((await other.get(`/api/orders/${order.id}/delivery`)).status, 404);
  } finally { await compiled.prisma.$disconnect(); }
});

test('Missing, malformed, tampered, expired or guessed credentials cannot authorize guest order access', async () => {
  const buyer = request.agent(server), identity = await buyer.get('/api/auth/me');
  const guestCookie = identity.headers['set-cookie'].find((cookie) => cookie.startsWith('market_guest=')).split(';')[0];
  const sessionCookie = identity.headers['set-cookie'].find((cookie) => cookie.startsWith('market_session=')).split(';')[0];
  const order = await newOrder(buyer);
  const stored = await readOrder(order.id);
  const token = guestCookie.split('=')[1];
  const { randomBytes } = await import('node:crypto');
  const invalid = [
    '', sessionCookie, 'market_guest=invalid', `market_guest=${stored.userId}`,
    `market_guest=${randomBytes(32).toString('base64url')}.${Date.now() + 60000}`,
    `market_guest=${token.split('.')[0]}.${Date.now() - 1000}`,
    guestCookie + '0', `${guestCookie}; ${guestCookie}`,
  ];
  for (const cookie of invalid) {
    const read = request(server).get('/api/orders/' + order.id);
    const history = request(server).get('/api/orders');
    if (cookie) { read.set('Cookie', cookie); history.set('Cookie', cookie); }
    assert.equal((await read).status, 404);
    assert.equal((await history).status, 401);
  }
  // Knowledge of an order ID, owner ID, email, or the old role session does not restore access.
  assert.equal((await request(server).get('/api/orders/' + order.id).query({ customerId: stored.userId, email: order.customerEmail }).set('X-Customer-Id', stored.userId)).status, 404);
});

test('Explicit session clear revokes the durable guest credential without deleting orders', async () => {
  const buyer = request.agent(server), identity = await buyer.get('/api/auth/me');
  const credential = identity.headers['set-cookie'].find((cookie) => cookie.startsWith('market_guest=')).split(';')[0];
  const order = await newOrder(buyer);
  assert.equal((await post(buyer, '/api/dev/session/clear')).status, 200);
  assert.equal((await request(server).get('/api/orders/' + order.id).set('Cookie', credential)).status, 404);
  assert.equal((await readOrder(order.id)).id, order.id);
  await buyer.get('/api/auth/me');
  assert.equal((await buyer.get('/api/orders/' + order.id)).status, 404);
});

test('A proven live private legacy guest session upgrades without changing the order owner', async () => {
  const buyer = request.agent(server), identity = await buyer.get('/api/auth/me');
  const roleCookie = identity.headers['set-cookie'].find((cookie) => cookie.startsWith('market_session=')).split(';')[0];
  const order = await newOrder(buyer);
  const stored = await readOrder(order.id);
  await prisma.user.update({ where: { id: stored.userId }, data: { email: `guest-${stored.userId}@local.test` } });
  const upgraded = await request(server).get('/api/auth/me').set('Cookie', roleCookie);
  const credential = upgraded.headers['set-cookie'].find((cookie) => cookie.startsWith('market_guest=')).split(';')[0];
  assert.equal((await request(server).get('/api/orders/' + order.id).set('Cookie', credential)).status, 200);
  assert.equal((await readOrder(order.id)).userId, stored.userId);
});

test('Appearance: only ADMIN can apply allowlisted themes; all visitors and fresh apps share SQLite selection', async () => {
  const visitor = request.agent(server);
  const beforeOrders = await prisma.order.count();
  const beforeContacts = await prisma.supplierContact.count();
  const initial = await visitor.get('/api/appearance');
  assert.deepEqual(initial.body, { theme: 'classic' });
  assert.equal(initial.headers['cache-control'], 'no-store');
  for (const unauthorized of [request(server), visitor]) {
    assert.equal((await unauthorized.put('/api/admin/appearance').send({ theme: 'dark', role: 'ADMIN' })).status, 403);
  }
  for (const body of [{}, { theme: 'unknown' }, { theme: "dark'; DROP TABLE User;--" }, { theme: 'dark', css: 'url(private)' }]) {
    assert.equal((await admin.put('/api/admin/appearance').send(body)).status, 400);
  }
  for (const theme of ['classic', 'minimal', 'marketplace', 'dark']) {
    const applied = await admin.put('/api/admin/appearance').send({ theme });
    assert.equal(applied.status, 200);
    assert.deepEqual((await visitor.get('/api/appearance')).body, { theme });
  }
  await admin.put('/api/admin/appearance').send({ theme: 'dark' });
  const compiled = await import('../dist/app.js');
  const fresh = compiled.createApp({ uploadDirectory: uploads }).listen(0, '127.0.0.1');
  servers.push(fresh); await once(fresh, 'listening');
  try {
    assert.deepEqual((await request(fresh).get('/api/appearance')).body, { theme: 'dark' });
    assert.equal((await request(fresh).put('/api/admin/appearance').send({ theme: 'classic' })).status, 403);
  } finally { await compiled.prisma.$disconnect(); }
  assert.equal(await prisma.order.count(), beforeOrders);
  assert.equal(await prisma.supplierContact.count(), beforeContacts);
});

test('Appearance: additive SQLite initialization preserves existing data without Prisma generation', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const { createAppearanceRepository } = await import('../src/appearance.ts');
  const legacy = path.join(temp, 'legacy-appearance.db');
  const db = new DatabaseSync(legacy);
  db.exec("CREATE TABLE Marker (value TEXT); INSERT INTO Marker VALUES ('fictional preserved record')");
  db.close();
  const first = new PrismaClient({ datasources: { db: { url: 'file:' + legacy.replaceAll('\\', '/') } } });
  try {
    const repository = createAppearanceRepository(first);
    assert.equal(await repository.read(), 'classic');
    for (const [stored, expected] of [['modern-minimal', 'classic'], ['dark-premium', 'dark'], ['vibrant-commerce', 'marketplace'], ['__proto__', 'classic'], ['unknown', 'classic']]) {
      await first.$executeRaw`INSERT INTO "SiteSetting" ("key", "value") VALUES ('theme', ${stored}) ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`;
      assert.equal(await repository.read(), expected);
      assert.deepEqual(await first.$queryRaw`SELECT value FROM SiteSetting WHERE key = 'theme'`, [{ value: stored }]);
    }
    await repository.write('marketplace');
  } finally { await first.$disconnect(); }
  const second = new PrismaClient({ datasources: { db: { url: 'file:' + legacy.replaceAll('\\', '/') } } });
  try {
    assert.equal(await createAppearanceRepository(second).read(), 'marketplace');
    assert.deepEqual(await second.$queryRaw`SELECT value FROM Marker`, [{ value: 'fictional preserved record' }]);
  } finally { await second.$disconnect(); }
});

test('Email HTML: paid owner gets both alternatives, other sessions get neither, repeated confirmations preserve one delivery', async () => {
  const buyer = request.agent(server), stranger = request.agent(server);
  const order = await newOrder(buyer);
  assert.equal((await buyer.get(`/api/orders/${order.id}/delivery`)).status, 409);
  const pending = await readOrder(order.id);
  assert.equal(pending.emailDelivery.body, '');
  assert.equal(pending.emailDelivery.attempts, 0);
  const paid = await post(buyer, `/api/dev/payments/${order.id}/simulate`);
  assert.equal(paid.status, 200);
  assert.equal(bodyContainsContact(paid.body), false);
  assert.equal(paid.body.order.emailDelivery.html, undefined);
  const email = await buyer.get(`/api/orders/${order.id}/delivery`);
  assert.equal(email.status, 200);
  assert.match(email.body.delivery.html, /<!doctype html>/);
  assert.match(email.body.delivery.body, /Compra confirmada/);
  for (const body of [email.body.delivery.html, email.body.delivery.body]) {
    assert.match(body, /private-supplier-a@example\.test/);
    assert.doesNotMatch(body, /private-supplier-b@example\.test/);
  }
  const stored = await readOrder(order.id);
  assert.deepEqual(decodeEmailContent(stored.emailDelivery.body), { body: email.body.delivery.body, html: email.body.delivery.html });
  const outbox = (await admin.get('/api/dev/email-outbox')).body.items.find((item) => item.orderId === order.id);
  assert.equal(outbox.html, email.body.delivery.html);
  assert.equal((await stranger.get(`/api/orders/${order.id}/delivery`)).status, 404);
  assert.equal((await buyer.get('/api/dev/email-outbox')).status, 403);
  for (const url of ['/api/categories', `/api/categories/${a.slug}`, '/api/orders', `/api/orders/${order.id}`]) {
    assert.equal(bodyContainsContact((await buyer.get(url)).body), false, url);
  }
  assert.equal((await post(buyer, `/api/dev/payments/${order.id}/simulate`)).status, 200);
  assert.equal((await post(admin, `/api/admin/orders/${order.id}/confirm-payment`)).status, 200);
  assert.equal((await post(admin, `/api/dev/email-outbox/retry/${order.id}`)).status, 200);
  const repeated = await readOrder(order.id);
  assert.equal(repeated.emailDelivery.body, stored.emailDelivery.body);
  assert.equal(repeated.emailDelivery.attempts, 1);
  assert.equal(await prisma.emailDelivery.count({ where: { orderId: order.id } }), 1);
});

test('Email HTML: pending, failed and mismatched payments cannot expose or retry stored contact bodies', async () => {
  const buyer = request.agent(server), order = await newOrder(buyer);
  const body = encodeEmailContent({ subject: 'Legacy fixture', text: 'private-supplier-a@example.test', html: '<p>private-supplier-a@example.test</p>' });
  await prisma.emailDelivery.update({ where: { orderId: order.id }, data: { status: 'SENT', body } });
  for (const [status, paymentStatus] of [['PENDING', 'PENDING'], ['FAILED', 'FAILED'], ['PAID', 'PENDING'], ['PENDING', 'PAID']]) {
    await prisma.order.update({ where: { id: order.id }, data: { status, payment: { update: { status: paymentStatus } } } });
    const preview = await buyer.get(`/api/orders/${order.id}/delivery`);
    assert.equal(preview.status, 409);
    assert.equal(bodyContainsContact(preview.body), false);
    const item = (await admin.get('/api/dev/email-outbox')).body.items.find((entry) => entry.orderId === order.id);
    assert.equal(item.body, '');
    assert.equal(item.html, undefined);
    assert.equal((await post(admin, `/api/dev/email-outbox/retry/${order.id}`)).status, 409);
    const stored = await readOrder(order.id);
    assert.equal(stored.emailDelivery.body, body);
    assert.equal(stored.emailDelivery.attempts, 0);
  }
});

test('Email HTML: historical paid text-only deliveries remain readable without generating a second email', async () => {
  const buyer = request.agent(server), order = await newOrder(buyer);
  await post(buyer, `/api/dev/payments/${order.id}/simulate`);
  const legacy = 'Historical <text> private-supplier-a@example.test';
  await prisma.emailDelivery.update({ where: { orderId: order.id }, data: { body: legacy } });
  const preview = await buyer.get(`/api/orders/${order.id}/delivery`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.delivery.body, legacy);
  assert.equal(preview.body.delivery.html, undefined);
  assert.equal((await post(admin, `/api/dev/email-outbox/retry/${order.id}`)).status, 200);
  assert.equal((await readOrder(order.id)).emailDelivery.body, legacy);
  assert.equal((await readOrder(order.id)).emailDelivery.attempts, 1);
});
