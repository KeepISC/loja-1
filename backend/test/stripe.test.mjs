import { test } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { paymentConfig, stripeProvider, stripeCheckoutUrl } from '../src/payment-provider.ts';
import { paymentSchemaInitializer } from '../src/payment-schema.ts';
import { PrismaClient } from '@prisma/client';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const env = { NODE_ENV: 'development', PAYMENT_PROVIDER: 'stripe', PAYMENT_APP_ORIGIN: 'http://localhost:5173',
  STRIPE_SECRET_KEY: 'sk_test_FictionalUnitFixture123', STRIPE_WEBHOOK_SECRET: 'whsec_FictionalUnitFixture123' };
test('Stripe config fails closed without explicit keys/trusted origin; mock cannot run outside development', () => {
  assert.equal(paymentConfig(env).provider, 'STRIPE');
  for (const change of [{ PAYMENT_PROVIDER: 'unknown' }, { STRIPE_SECRET_KEY: '' }, { STRIPE_WEBHOOK_SECRET: '' },
    { STRIPE_SECRET_KEY: 'sk_live_FictionalUnitFixture123' }, { PAYMENT_APP_ORIGIN: 'http://attacker.example.test' },
    { PAYMENT_APP_ORIGIN: 'https://user:secret@example.test' }, { PAYMENT_APP_ORIGIN: 'https://example.test/redirect' },
    { PAYMENT_APP_ORIGIN: 'https://example.test/?next=attacker' }, { PAYMENT_APP_ORIGIN: 'https://example.test/#x' },
    { NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock' }, { NODE_ENV: 'production', PAYMENT_PROVIDER: undefined }])
    assert.throws(() => paymentConfig({ ...env, ...change }), (error) => error.message === 'Payment configuration is missing or invalid.');
  assert.equal(paymentConfig({ NODE_ENV: 'development' }).provider, 'DUMMY');
});

test('Hosted Checkout redirects reject credentials, alternate hosts, protocols, ports and relative URLs', () => {
  assert.equal(stripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_fixture#safe'), 'https://checkout.stripe.com/c/pay/cs_test_fixture#safe');
  for (const url of ['//checkout.stripe.com', 'http://checkout.stripe.com/a', 'https://checkout.stripe.com.attacker.test/a',
    'https://attacker@checkout.stripe.com/a', 'javascript:alert(1)', 'https://checkout.stripe.com:444/a']) assert.throws(() => stripeCheckoutUrl(url));
});

test('Official Stripe signature verification requires the exact raw payload and rejects expired, modified and live/Connect events', () => {
  const sdk = new Stripe(env.STRIPE_SECRET_KEY), provider = stripeProvider(paymentConfig(env), sdk);
  const payload = JSON.stringify({ id: 'evt_fixture', type: 'unhandled.fixture', livemode: false, data: { object: {} } });
  const sign = (body, timestamp) => sdk.webhooks.generateTestHeaderString({ payload: body, secret: env.STRIPE_WEBHOOK_SECRET, ...(timestamp ? { timestamp } : {}) });
  assert.equal(provider.notification(Buffer.from(payload), sign(payload)).id, 'evt_fixture');
  for (const [body, signature] of [[payload + ' ', sign(payload)], [payload, 'invalid'], [payload, sign(payload, 1)]])
    assert.throws(() => provider.notification(Buffer.from(body), signature), (error) => error.status === 400 && !error.message.includes('whsec'));
  for (const fields of [{ livemode: true }, { account: 'acct_not_supported' }]) {
    const body = JSON.stringify({ ...JSON.parse(payload), ...fields });
    assert.throws(() => provider.notification(Buffer.from(body), sign(body)), (error) => error.status === 400);
  }
});

test('SQLite payment upgrade is additive, repeatable and preserves existing legacy orders and payments', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loja1-payment-migration-')), filename = path.join(temp, 'legacy.db');
  const database = new DatabaseSync(filename);
  database.exec(`CREATE TABLE "Order" (id TEXT PRIMARY KEY, totalCents INTEGER); CREATE TABLE Payment (id TEXT PRIMARY KEY, orderId TEXT, provider TEXT, status TEXT);
    INSERT INTO "Order" VALUES ('legacy-order', 1200); INSERT INTO Payment VALUES ('legacy-payment','legacy-order','DUMMY','PAID');`); database.close();
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'file:' + filename.replaceAll('\\', '/');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    await paymentSchemaInitializer(prisma)(); await paymentSchemaInitializer(prisma)();
    const [order] = await prisma.$queryRaw`SELECT * FROM "Order"`;
    const [payment] = await prisma.$queryRaw`SELECT * FROM Payment`;
    assert.equal(order.id, 'legacy-order'); assert.equal(order.currency, 'EUR'); assert.equal(order.totalCents, 1200);
    assert.equal(payment.status, 'PAID'); assert.equal(payment.provider, 'DUMMY'); assert.equal(payment.refundedCents, 0);
  } finally {
    await prisma.$disconnect(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-payment-migration-'));
    await rm(temp, { recursive: true, force: true });
  }
});
