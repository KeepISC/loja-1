import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import request from 'supertest';
import Stripe from 'stripe';
import { assertTestTarget } from '../scripts/mysql-env.mjs';

const mysql = process.env.MYSQL_INTEGRATION === 'true', temp = await mkdtemp(path.join(tmpdir(), 'loja1-stripe-'));
if (mysql) assertTestTarget(process.env.DATABASE_URL);
else {
  const filename = path.join(temp, 'stripe.db'), sqlite = new DatabaseSync(filename);
  sqlite.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); sqlite.close();
  process.env.DATABASE_URL = 'file:' + filename.replaceAll('\\', '/');
}
Object.assign(process.env, { NODE_ENV: 'development', REMOTE_TESTING: 'false', REMOTE_ORIGIN: '', ALLOW_MOCK_PAYMENT: 'true',
  SESSION_SECRET: mysql ? process.env.SESSION_SECRET : 'fictional-stripe-session-signing-key-over32', AUTH_EMAIL_TRANSPORT: 'preview',
  AUTH_APP_ORIGIN: 'http://localhost:5173', PAYMENT_PROVIDER: 'stripe', PAYMENT_APP_ORIGIN: 'http://localhost:5173',
  STRIPE_SECRET_KEY: 'sk_test_FictionalIntegrationKey123', STRIPE_WEBHOOK_SECRET: 'whsec_FictionalIntegrationSecret123' });
const { createApp, prisma } = await import('../dist/app.js');
const { stripeProvider, paymentConfig } = await import('../dist/payment-provider.js');
const { hashPassword } = await import('../dist/passwords.js');
const { sessionHash } = await import('../dist/session-store.js');
const { authSchemaInitializer } = await import('../dist/auth-schema.js');
await authSchemaInitializer(prisma)();

test(`${mysql ? 'MySQL' : 'SQLite'} Stripe Checkout with signed fixtures and mocked SDK calls only`, async (t) => {
  const run = randomUUID().replaceAll('-', ''), servers = [], users = new Set(), orders = new Set(), sessionHashes = new Set(), addresses = [];
  const sessions = new Map(), checkoutKeys = new Map(), refunds = new Map(), refundKeys = new Map(), creations = [], refundRequests = [];
  const sdk = new Stripe(process.env.STRIPE_SECRET_KEY);
  let lostCreationResponse = false, refundStatus = 'succeeded', lostRefundResponse = false;
  const mock = { webhooks: sdk.webhooks, checkout: { sessions: {
    async create(params, options) {
      creations.push({ params, options });
      let value = checkoutKeys.get(options.idempotencyKey);
      if (!value) {
        const id = 'cs_test_' + randomUUID().replaceAll('-', '');
        value = { id, mode: 'payment', amount_total: params.line_items[0].price_data.unit_amount, currency: 'eur', status: 'open', payment_status: 'unpaid',
          livemode: false, client_reference_id: params.client_reference_id, metadata: params.metadata, payment_intent: null, url: 'https://checkout.stripe.com/c/pay/' + id };
        sessions.set(id, value); checkoutKeys.set(options.idempotencyKey, value);
      }
      if (lostCreationResponse) { lostCreationResponse = false; throw new Error('Private SDK diagnostic'); }
      return structuredClone(value);
    },
    async retrieve(id) { if (!sessions.has(id)) throw new Error('Private unknown provider reference'); return structuredClone(sessions.get(id)); },
    async expire(id) { const value = sessions.get(id); if (value.status !== 'open') throw new Error('Already complete'); value.status = 'expired'; value.url = null; return structuredClone(value); },
  } }, refunds: {
    async create(params, options) {
      refundRequests.push({ params, options });
      let value = refundKeys.get(options.idempotencyKey);
      if (!value) { value = { id: 're_' + randomUUID().replaceAll('-', ''), payment_intent: params.payment_intent, amount: params.amount, currency: 'eur', status: refundStatus }; refunds.set(value.id, value); refundKeys.set(options.idempotencyKey, value); }
      if (lostRefundResponse) { lostRefundResponse = false; throw new Error('Private refund diagnostic'); }
      return structuredClone(value);
    },
    async retrieve(id) { return structuredClone(refunds.get(id)); },
  } };
  const provider = stripeProvider(paymentConfig(), mock);
  const start = async () => { const server = createApp({ uploadDirectory: temp, paymentProvider: provider }).listen(0, '127.0.0.1'); servers.push(server); await once(server, 'listening'); return server; };
  const capture = async (response) => {
    for (const cookie of response.headers['set-cookie'] ?? []) {
      if (!cookie.startsWith('market_session=') || !cookie.includes('s%3A')) continue;
      const signed = decodeURIComponent(cookie.split(';')[0].slice('market_session='.length)), idHash = sessionHash(signed.slice(2, signed.lastIndexOf('.')));
      sessionHashes.add(idHash); const session = await prisma.session.findUnique({ where: { idHash } });
      if (session && JSON.parse(session.data).customerId) users.add(JSON.parse(session.data).customerId);
    }
    if (response.body.order?.id) orders.add(response.body.order.id);
    return response;
  };
  const post = async (agent, url, body = {}) => { const csrf = await capture(await agent.get('/api/csrf')); return capture(await agent.post(url).set('X-CSRF-Token', csrf.body.csrfToken).send(body)); };
  const notification = (type, object, id = 'evt_' + randomUUID().replaceAll('-', '')) => ({ id, type, livemode: false, data: { object: structuredClone(object) } });
  const webhook = async (server, event, signature) => {
    const payload = JSON.stringify(event), signed = signature ?? sdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    return request(server).post('/api/payments/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signed).send(payload);
  };
  const sessionFor = async (orderId) => sessions.get((await prisma.paymentAttempt.findFirstOrThrow({ where: { payment: { orderId } }, orderBy: { createdAt: 'desc' } })).sessionId);
  const paid = (value) => { value.status = 'complete'; value.payment_status = 'paid'; value.payment_intent = 'pi_' + value.id; value.url = null; };
  let category, adminAccount, customerAccount, supplierAccount;
  const newOrder = async (agent, account = false) => {
    const result = await post(agent, account ? '/api/account/orders' : '/api/orders', { customerEmail: 'fixture@example.test', checkoutKey: randomUUID(), items: [{ categoryId: category.id, priceCents: 1 }], totalCents: 1, status: 'PAID' });
    assert.equal(result.status, 201); return result.body.order;
  };
  try {
    category = await prisma.category.create({ data: { name: 'Stripe fixture', slug: run, description: 'Isolated fictional payment fixture', imageUrl: '/images/default-category.svg', priceCents: 1200,
      contacts: { create: { supplierName: 'Private fixture', email: 'supplier@example.test' } } } });
    const password = 'Fictional secure checkout password', passwordHash = await hashPassword(password);
    for (const role of ['ADMIN', 'CUSTOMER', 'SUPPLIER']) {
      const email = `${run}-${role.toLowerCase()}@example.test`; addresses.push(email);
      const user = await prisma.user.create({ data: { role, email, displayName: 'Payment fixture', account: { create: { passwordHash, emailVerifiedAt: new Date() } }, ...(role === 'SUPPLIER' ? { supplier: { create: { active: true } } } : {}) } });
      users.add(user.id); if (role === 'ADMIN') adminAccount = user; else if (role === 'CUSTOMER') customerAccount = user; else supplierAccount = user;
    }
    const login = async (server, account) => { const agent = request.agent(server); assert.equal((await post(agent, '/api/auth/login', { email: account.email, password })).status, 200); return agent; };

    await t.test('server totals/EUR, trusted links, card eligibility/3DS, ownership and lost-response idempotency', async () => {
      const server = await start(), buyer = request.agent(server), stranger = request.agent(server);
      const order = await newOrder(buyer); assert.equal(order.totalCents, 1200); assert.equal(order.currency, 'EUR');
      assert.equal((await post(stranger, `/api/orders/${order.id}/checkout`)).status, 404);
      assert.equal((await stranger.get(`/api/orders/${order.id}/payment-status`)).status, 404);
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`, { amount: 1, returnUrl: 'https://attacker.example.test' })).status, 400);
      lostCreationResponse = true;
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 502);
      const result = await post(buyer, `/api/orders/${order.id}/checkout`); assert.equal(result.status, 200); assert.ok(result.body.url.startsWith('https://checkout.stripe.com/'));
      const [first, second] = creations.slice(-2); assert.equal(first.options.idempotencyKey, second.options.idempotencyKey);
      assert.equal(first.params.line_items[0].price_data.unit_amount, 1200); assert.equal(first.params.line_items[0].price_data.currency, 'eur');
      assert.deepEqual(first.params.allowed_payment_method_types, ['card']); assert.equal(first.params.payment_method_options.card.request_three_d_secure, 'automatic');
      assert.ok(first.params.success_url.startsWith('http://localhost:5173/success?orderId=')); assert.ok(!first.params.payment_intent_data.transfer_data);
      assert.equal(await prisma.paymentAttempt.count({ where: { payment: { orderId: order.id } } }), 1);
      const value = await sessionFor(order.id); paid(value);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.paymentStatus, 'PENDING');
      assert.equal((await buyer.get(`/api/orders/${order.id}/delivery`)).status, 409);
      assert.equal((await post(buyer, `/api/dev/payments/${order.id}/simulate`)).status, 403);
      const evt = notification('checkout.session.completed', value);
      assert.equal((await webhook(server, evt, 'invalid')).status, 400);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status, 'PENDING');
    });

    await t.test('concurrent Checkout requests reserve one attempt; signed duplicate/concurrent events fulfill once', async () => {
      const server = await start(), buyer = request.agent(server), order = await newOrder(buyer);
      // Establish CSRF before competing requests, avoiding an unrelated first-cookie race.
      const token = (await buyer.get('/api/csrf')).body.csrfToken;
      const results = await Promise.all([1, 2].map(() => buyer.post(`/api/orders/${order.id}/checkout`).set('X-CSRF-Token', token).send({})));
      assert.ok(results.every((result) => result.status === 200)); assert.equal(results[0].body.url, results[1].body.url);
      const value = await sessionFor(order.id); paid(value); const event = notification('checkout.session.completed', value);
      const received = await Promise.all([webhook(server, event), webhook(server, event), webhook(server, notification('checkout.session.async_payment_succeeded', value))]);
      assert.ok(received.every((result) => result.status === 200));
      assert.equal(await prisma.paymentEvent.count({ where: { eventId: event.id } }), 1);
      const record = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { payment: true, emailDelivery: true } });
      assert.equal(record.status, 'PAID'); assert.equal(record.payment.paymentIntentId, value.payment_intent); assert.equal(record.emailDelivery.attempts, 1);
      assert.equal((await webhook(server, event)).status, 200); assert.equal((await buyer.get(`/api/orders/${order.id}/delivery`)).status, 200);
      await assert.rejects(prisma.paymentEvent.create({ data: { eventId: event.id, paymentId: record.payment.id, kind: 'duplicate', status: 'PAID', amountCents: 1200, currency: 'EUR' } }), (error) => error.code === 'P2002');
    });

    await t.test('a committed paid event retries failed fulfillment without recording or delivering twice', async () => {
      const server = await start(), buyer = request.agent(server), order = await newOrder(buyer);
      await post(buyer, `/api/orders/${order.id}/checkout`); const value = await sessionFor(order.id); paid(value);
      const event = notification('checkout.session.completed', value), original = prisma.$transaction;
      prisma.$transaction = (work, options) => original.call(prisma, (tx) => work(new Proxy(tx, { get(target, key) {
        if (key === 'category') return new Proxy(target.category, { get(model, method) { return method === 'findMany' ? async () => { throw new Error('Fictional temporary delivery outage'); } : model[method]; } });
        return target[key];
      } })), options);
      try { assert.equal((await webhook(server, event)).status, 500); } finally { prisma.$transaction = original; }
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status, 'PAID');
      assert.equal((await webhook(server, event)).status, 200);
      assert.equal(await prisma.paymentEvent.count({ where: { eventId: event.id } }), 1);
      const delivery = await prisma.emailDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
      assert.equal(delivery.status, 'SENT'); assert.equal(delivery.attempts, 2);
      assert.equal((await webhook(server, event)).status, 200);
      assert.equal((await prisma.emailDelivery.findUniqueOrThrow({ where: { orderId: order.id } })).attempts, 2);
    });

    await t.test('wrong amount/currency/association/mode are rejected without fulfillment; stale failure never downgrades paid', async () => {
      const server = await start(), buyer = request.agent(server), order = await newOrder(buyer);
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 200);
      const value = await sessionFor(order.id); paid(value);
      for (const changes of [{ amount_total: 1 }, { currency: 'usd' }, { client_reference_id: 'other-order' }, { livemode: true }, { mode: 'subscription' }, { metadata: { paymentId: 'other', attemptId: value.metadata.attemptId } }]) {
        assert.equal((await webhook(server, notification('checkout.session.completed', { ...value, ...changes }))).status, 400);
      }
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).status, 'PENDING');
      await prisma.payment.update({ where: { orderId: order.id }, data: { status: 'INVALID_STATE' } });
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 409);
      await prisma.payment.update({ where: { orderId: order.id }, data: { status: 'PENDING' } });
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      const stale = { ...value, payment_status: 'unpaid', status: 'expired' };
      assert.equal((await webhook(server, notification('checkout.session.expired', stale))).status, 200);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAID');
    });

    await t.test('async confirmation, failure and expiry are safe; cancellation expires Checkout and never refunds', async () => {
      const server = await start(), buyer = request.agent(server), order = await newOrder(buyer);
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 200);
      let value = await sessionFor(order.id); value.status = 'complete'; value.payment_intent = 'pi_' + value.id;
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.paymentStatus, 'PROCESSING');
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 409);
      assert.equal((await webhook(server, notification('checkout.session.async_payment_failed', value))).status, 200);
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.paymentStatus, 'FAILED');
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 200);
      value = await sessionFor(order.id); value.status = 'expired'; value.url = null;
      assert.equal((await webhook(server, notification('checkout.session.expired', value))).status, 200);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.paymentStatus, 'FAILED');
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 200);
      value = await sessionFor(order.id); const refundCount = refundRequests.length;
      assert.equal((await post(buyer, `/api/orders/${order.id}/cancel-payment`)).status, 200);
      assert.equal(value.status, 'expired'); assert.equal(refundRequests.length, refundCount);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.paymentStatus, 'CANCELLED');
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`)).status, 200);
      value = await sessionFor(order.id); value.status = 'complete';
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      paid(value); assert.equal((await webhook(server, notification('checkout.session.async_payment_succeeded', value))).status, 200);
      assert.equal((await post(buyer, `/api/orders/${order.id}/cancel-payment`)).status, 409);
    });

    await t.test('account/guest ownership, Customer/Supplier/mock Admin refund denial and full-refund idempotency', async () => {
      const server = await start(), customer = await login(server, customerAccount), supplier = await login(server, supplierAccount), admin = await login(server, adminAccount), guest = request.agent(server), mockAdmin = request.agent(server);
      const order = await newOrder(customer, true);
      assert.equal((await post(guest, `/api/orders/${order.id}/checkout`)).status, 404); assert.equal((await post(supplier, `/api/orders/${order.id}/checkout`)).status, 404);
      assert.equal((await post(customer, `/api/orders/${order.id}/checkout`)).status, 200);
      const value = await sessionFor(order.id); paid(value); assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      await post(mockAdmin, '/api/dev/session', { role: 'ADMIN' });
      for (const [agent, status] of [[customer, 403], [supplier, 403], [guest, 401], [mockAdmin, 401]]) assert.equal((await post(agent, `/api/admin/orders/${order.id}/refund`)).status, status);
      assert.equal((await post(admin, `/api/admin/orders/${order.id}/refund`, { amount: 1 })).status, 400);
      lostRefundResponse = true;
      assert.equal((await post(admin, `/api/admin/orders/${order.id}/refund`)).status, 502);
      const csrf = (await admin.get('/api/csrf')).body.csrfToken;
      const results = await Promise.all([1, 2].map(() => admin.post(`/api/admin/orders/${order.id}/refund`).set('X-CSRF-Token', csrf).send({})));
      assert.ok(results.every((result) => result.status === 200));
      const records = await prisma.paymentRefund.findMany({ where: { payment: { orderId: order.id } } }); assert.equal(records.length, 1); assert.equal(records[0].amountCents, 1200);
      assert.equal(refundRequests.at(-1).params.amount, 1200); assert.equal(refundRequests.at(-1).options.idempotencyKey, refundRequests.at(-2).options.idempotencyKey);
      assert.equal((await customer.get(`/api/orders/${order.id}/payment-status`)).body.refundedCents, 1200);
      const count = refundRequests.length; assert.equal((await post(admin, `/api/admin/orders/${order.id}/refund`)).status, 200); assert.equal(refundRequests.length, count);
      assert.equal((await customer.get(`/api/orders/${order.id}/delivery`)).status, 409);
      const history = await admin.get(`/api/admin/orders/${order.id}/payment-history`); assert.equal(history.status, 200); assert.ok(history.body.events.some((event) => event.kind === 'REFUND_REQUESTED' && event.actorId === adminAccount.id));
      assert.equal((await customer.get(`/api/admin/orders/${order.id}/payment-history`)).status, 403);
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'REFUNDED');
    });

    await t.test('checkout rate limiting rejects repeated invalid payment requests before provider calls', async () => {
      const server = await start(), buyer = request.agent(server), order = await newOrder(buyer), before = creations.length;
      for (let count = 0; count < 20; count++) assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`, { price: 1 })).status, 400);
      assert.equal((await post(buyer, `/api/orders/${order.id}/checkout`, { price: 1 })).status, 429); assert.equal(creations.length, before);
    });

    await t.test('pending/failed refund updates retry safely; duplicate/out-of-order success cannot exceed total', async () => {
      const server = await start(), buyer = request.agent(server), admin = await login(server, adminAccount), order = await newOrder(buyer);
      await post(buyer, `/api/orders/${order.id}/checkout`); const value = await sessionFor(order.id); paid(value);
      assert.equal((await webhook(server, notification('checkout.session.completed', value))).status, 200);
      refundStatus = 'pending'; assert.equal((await post(admin, `/api/admin/orders/${order.id}/refund`)).body.status, 'PENDING');
      let refund = [...refunds.values()].at(-1); refund.status = 'failed';
      assert.equal((await webhook(server, notification('refund.failed', refund))).status, 200);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.refundedCents, 0);
      assert.equal((await post(admin, `/api/admin/orders/${order.id}/refund`)).body.status, 'PENDING');
      refund = [...refunds.values()].at(-1); refund.status = 'succeeded'; const event = notification('refund.updated', refund);
      assert.ok((await Promise.all([webhook(server, event), webhook(server, event)])).every((result) => result.status === 200));
      assert.equal((await webhook(server, notification('refund.failed', { ...refund, status: 'failed' }))).status, 200);
      assert.equal((await buyer.get(`/api/orders/${order.id}/payment-status`)).body.refundedCents, 1200);
      const excessive = { ...refund, id: 're_excessive' + run, amount: 1201 }; refunds.set(excessive.id, excessive);
      assert.equal((await webhook(server, notification('refund.updated', excessive))).status, 400);
      refundStatus = 'succeeded';
    });
  } finally {
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    await prisma.order.deleteMany({ where: { id: { in: [...orders] } } });
    if (category) await prisma.category.delete({ where: { id: category.id } });
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
    await prisma.session.deleteMany({ where: { idHash: { in: [...sessionHashes] } } });
    const { createHmac } = await import('node:crypto');
    const keys = addresses.map((email) => createHmac('sha256', process.env.SESSION_SECRET).update('auth-rate/').update(email).digest('hex'));
    await prisma.authRateLimit.deleteMany({ where: { keyHash: { in: keys } } });
    await prisma.$disconnect();
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-stripe-'));
    await rm(temp, { recursive: true, force: true });
  }
});
