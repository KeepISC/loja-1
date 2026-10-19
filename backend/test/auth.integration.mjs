import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import request from 'supertest';
import { assertTestTarget } from '../scripts/mysql-env.mjs';

const mysql = process.env.MYSQL_INTEGRATION === 'true';
const temp = await mkdtemp(path.join(tmpdir(), 'loja1-auth-'));
if (mysql) assertTestTarget(process.env.DATABASE_URL);
else {
  const filename = path.join(temp, 'test.db');
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); sqlite.close();
  process.env.DATABASE_URL = 'file:' + filename.replaceAll('\\', '/');
}
process.env.NODE_ENV = 'development'; process.env.REMOTE_TESTING = 'false'; process.env.REMOTE_ORIGIN = '';
process.env.SESSION_SECRET = mysql ? process.env.SESSION_SECRET : 'fictional-auth-integration-stable-session-key';
process.env.ALLOW_MOCK_PAYMENT = 'true';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.AUTH_EMAIL_TRANSPORT = 'preview'; process.env.AUTH_APP_ORIGIN = 'http://localhost:5173';
const { createApp, prisma } = await import('../dist/app.js');
const { PrismaClient } = await import('../dist/database.js');
const { sessionHash } = await import('../dist/session-store.js');
const { cookieOptions } = await import('../dist/security.js');
const { verifyPassword } = await import('../dist/passwords.js');
const { authSchemaInitializer } = await import('../dist/auth-schema.js');
const { authenticationEmail, authEmailPreview } = await import('../dist/auth-email.js');
const { readAuthEmailConfig } = await import('../dist/auth-email-transport.js');
await authSchemaInitializer(prisma)();

test(`${mysql ? 'MySQL' : 'SQLite'} authentication and RBAC`, async (t) => {
  const run = randomUUID(), servers = [], trackedSessions = new Set(), trackedUsers = new Set(), trackedOrders = new Set(), categories = new Set();
  const addresses = ['customer', 'other', 'admin', 'tokens', 'rate'].map((name) => `${run}-${name}@example.test`);
  const [address, otherAddress, adminAddress, tokenAddress, rateAddress] = addresses;
  const password = 'Fictional secure test password 42!', changedPassword = 'Fictional replacement password 84!';
  let user, otherUser, adminUser, category, contact, otherContact;
  const start = async () => { const server = createApp({ uploadDirectory: temp }).listen(0, '127.0.0.1'); servers.push(server); await once(server, 'listening'); return server; };
  const cookieHash = (cookie) => { const value = decodeURIComponent(cookie.split(';')[0].slice('market_session='.length)); return sessionHash(value.slice(2, value.lastIndexOf('.'))); };
  const capture = async (response) => {
    for (const cookie of response.headers['set-cookie'] ?? []) {
      if (cookie.startsWith('market_session=') && cookie.includes('s%3A')) {
        const hash = cookieHash(cookie); trackedSessions.add(hash);
        const row = await prisma.session.findUnique({ where: { idHash: hash } });
        const data = row ? JSON.parse(row.data) : {};
        if (data.customerId) trackedUsers.add(data.customerId);
      }
    }
    if (response.body.order?.id) trackedOrders.add(response.body.order.id);
    return response;
  };
  const post = async (agent, url, body = {}) => {
    const csrf = await capture(await agent.get('/api/csrf')); assert.equal(csrf.status, 200);
    return capture(await agent.post(url).set('X-CSRF-Token', csrf.body.csrfToken).send(body));
  };
  const put = async (agent, url, body) => {
    const csrf = await capture(await agent.get('/api/csrf'));
    return capture(await agent.put(url).set('X-CSRF-Token', csrf.body.csrfToken).send(body));
  };
  const login = async (agent, email, secret = password) => post(agent, '/api/auth/login', { email, password: secret });
  const tokenFor = async (email, subject) => {
    const row = await prisma.authEmail.findFirstOrThrow({ where: { recipient: email, subject }, orderBy: { createdAt: 'desc' } });
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(row.body)?.[1]; assert.ok(token, 'Private local message contains an action link.'); return token;
  };
  const register = async (agent, email) => {
    const result = await post(agent, '/api/auth/register', { email, password, displayName: 'Fictional account' }); assert.equal(result.status, 202);
    assert.ok(!JSON.stringify(result.body).includes('token'));
    const user = await prisma.user.findUniqueOrThrow({ where: { email } }); trackedUsers.add(user.id); return user;
  };
  const verify = async (agent, email) => {
    const token = await tokenFor(email, 'Verify your email');
    assert.equal((await post(agent, '/api/auth/verify-email', { token })).status, 200); return token;
  };
  try {
    await t.test('registration is Customer-only; passwords are native Argon2id and responses exclude credentials', async () => {
      const agent = request.agent(await start());
      assert.equal((await post(agent, '/api/auth/register', { email: address, password, displayName: 'Fixture', role: 'ADMIN' })).status, 400);
      assert.equal((await post(agent, '/api/auth/register', { email: address, password, displayName: 'Fixture', role: 'SUPPLIER' })).status, 400);
      user = await register(agent, address); otherUser = await register(agent, otherAddress);
      assert.equal(user.role, 'CUSTOMER'); assert.equal(otherUser.role, 'CUSTOMER');
      const account = await prisma.account.findUniqueOrThrow({ where: { userId: user.id } });
      assert.ok(account.passwordHash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'));
      assert.ok(await verifyPassword(account.passwordHash, password));
      assert.ok(!await verifyPassword(account.passwordHash, 'incorrect test password'));
      assert.equal((await register(agent, address)).id, user.id);
      assert.equal((await post(agent, '/api/auth/register', { email: 'guest@local.test', password, displayName: 'Fixture' })).status, 400);
    });

    await t.test('verification is single-use and required for login; invalid credentials return generic errors', async () => {
      const agent = request.agent(await start());
      assert.equal((await login(agent, address)).status, 403);
      const token = await tokenFor(address, 'Verify your email');
      const tokenRow = await prisma.authToken.findUniqueOrThrow({ where: { userId_purpose: { userId: user.id, purpose: 'VERIFY_EMAIL' } } });
      assert.ok(tokenRow.idHash === createHash('sha256').update(token).digest('hex'));
      assert.ok(!JSON.stringify(tokenRow).includes(token));
      const invalid = await login(agent, address, 'incorrect test password');
      const missing = await login(agent, `${run}-missing@example.test`, 'incorrect test password');
      assert.equal(invalid.status, 401); assert.equal(missing.status, 401); assert.deepEqual(invalid.body, missing.body);
      await verify(agent, address); await verify(agent, otherAddress);
      assert.equal((await post(agent, '/api/auth/verify-email', { token })).status, 400);
      const result = await login(agent, address); assert.equal(result.status, 200); assert.equal(result.body.user.role, 'CUSTOMER');
      assert.ok(!/password|token|sessionVersion|accountVersion/.test(JSON.stringify(result.body)));
    });

    await t.test('authenticated sessions rotate, survive fresh servers/clients, and logout deletes the old session', async () => {
      const server = await start(), agent = request.agent(server);
      const before = await capture(await agent.get('/api/csrf'));
      const old = before.headers['set-cookie'].find((cookie) => cookie.startsWith('market_session='));
      const signedIn = await login(agent, address); assert.equal(signedIn.status, 200);
      const cookie = signedIn.headers['set-cookie'].find((cookie) => cookie.startsWith('market_session='));
      assert.ok(cookieHash(old) !== cookieHash(cookie));
      assert.equal(await prisma.session.findUnique({ where: { idHash: cookieHash(old) } }), null);
      assert.ok(/HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie));
      const independent = new PrismaClient();
      try { const row = await independent.session.findUniqueOrThrow({ where: { idHash: cookieHash(cookie) } }); assert.equal(JSON.parse(row.data).accountId, user.id); }
      finally { await independent.$disconnect(); }
      const restored = await request(await start()).get('/api/auth/me').set('Cookie', cookie.split(';')[0]);
      assert.equal(restored.body.authenticated, true); assert.equal(restored.body.email, address);
      assert.equal((await post(agent, '/api/auth/logout')).status, 200);
      assert.equal(await prisma.session.findUnique({ where: { idHash: cookieHash(cookie) } }), null);
      assert.equal((await capture(await request(server).get('/api/auth/me').set('Cookie', cookie.split(';')[0]))).body.authenticated, false);
    });

    await t.test('expired database and absolute sessions fail closed; production cookies stay secure', async () => {
      const server = await start(), agent = request.agent(server);
      const signedIn = await login(agent, address), cookie = signedIn.headers['set-cookie'].find((entry) => entry.startsWith('market_session='));
      const idHash = cookieHash(cookie);
      await prisma.session.update({ where: { idHash }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await agent.get('/api/account/orders')).status, 401);
      assert.equal((await post(agent, '/api/account/orders', { customerEmail: address, items: [{ categoryId: 'unavailable' }] })).status, 401);
      assert.equal((await capture(await agent.get('/api/auth/me'))).body.authenticated, false);
      assert.equal(await prisma.session.findUnique({ where: { idHash } }), null);
      const again = await login(agent, address), nextCookie = again.headers['set-cookie'].find((entry) => entry.startsWith('market_session='));
      const row = await prisma.session.findUniqueOrThrow({ where: { idHash: cookieHash(nextCookie) } });
      const data = JSON.parse(row.data); data.authenticatedAt = Date.now() - 13 * 3600000;
      await prisma.session.update({ where: { idHash: row.idHash }, data: { data: JSON.stringify(data) } });
      assert.equal((await capture(await agent.get('/api/auth/me'))).body.authenticated, false);
      const previousMode = process.env.NODE_ENV;
      try { process.env.NODE_ENV = 'production'; assert.equal(cookieOptions(false).secure, true); assert.equal(cookieOptions(false).httpOnly, true); assert.equal(cookieOptions(false).sameSite, 'lax'); assert.throws(() => createApp(), /development/); }
      finally { process.env.NODE_ENV = previousMode; }
    });

    await t.test('password reset expires, is single-use under concurrency, and invalidates all old sessions', async () => {
      const server = await start(), agent = request.agent(server), second = request.agent(server);
      await login(agent, address); await login(second, address);
      const known = await post(agent, '/api/auth/forgot-password', { email: address });
      const unknown = await post(agent, '/api/auth/forgot-password', { email: `${run}-unknown@example.test` });
      assert.deepEqual(known.body, unknown.body); assert.equal(known.status, 202);
      const expired = await tokenFor(address, 'Reset your password');
      await prisma.authToken.update({ where: { userId_purpose: { userId: user.id, purpose: 'RESET_PASSWORD' } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await post(agent, '/api/auth/reset-password', { token: expired, password: changedPassword })).status, 400);
      await post(agent, '/api/auth/forgot-password', { email: address });
      const token = await tokenFor(address, 'Reset your password');
      const results = await Promise.all([post(agent, '/api/auth/reset-password', { token, password: changedPassword }), post(second, '/api/auth/reset-password', { token, password: changedPassword })]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
      assert.equal((await capture(await second.get('/api/auth/me'))).body.authenticated, false);
      assert.equal((await login(agent, address)).status, 401); assert.equal((await login(agent, address, changedPassword)).status, 200);
      assert.equal((await post(agent, '/api/auth/reset-password', { token, password })).status, 400);
    });

    await t.test('resending verification replaces the earlier token; expired verification is refused', async () => {
      const agent = request.agent(await start());
      const account = await register(agent, tokenAddress), first = await tokenFor(tokenAddress, 'Verify your email');
      assert.equal((await post(agent, '/api/auth/resend-verification', { email: tokenAddress })).status, 202);
      assert.equal((await post(agent, '/api/auth/verify-email', { token: first })).status, 400);
      const current = await tokenFor(tokenAddress, 'Verify your email');
      await prisma.authToken.update({ where: { userId_purpose: { userId: account.id, purpose: 'VERIFY_EMAIL' } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await post(agent, '/api/auth/verify-email', { token: current })).status, 400);
    });

    await t.test('only a real Admin grants roles/assignments; Supplier ownership and immediate revocation hold', async () => {
      const server = await start(), admin = request.agent(server), customer = request.agent(server), other = request.agent(server), mock = request.agent(server);
      adminUser = await register(admin, adminAddress); await verify(admin, adminAddress);
      // Isolated test fixture provisioning; never promote a user from the local development database.
      await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' } });
      await login(admin, adminAddress); await login(customer, address, changedPassword); await login(other, otherAddress);
      assert.equal((await post(customer, '/api/dev/session', { role: 'ADMIN' })).status, 403);
      const grant = `/api/admin/accounts/${user.id}/supplier`;
      assert.equal((await put(customer, grant, { active: true })).status, 403);
      await post(mock, '/api/dev/session', { role: 'ADMIN' });
      assert.equal((await put(mock, grant, { active: true })).status, 401);
      category = await prisma.category.create({ data: { name: 'Fixture', slug: run, description: 'Fictional RBAC fixture category', imageUrl: '/images/default-category.svg', priceCents: 1200 } }); categories.add(category.id);
      contact = await prisma.supplierContact.create({ data: { categoryId: category.id, supplierName: 'Assigned fixture', email: 'fixture@example.test' } });
      otherContact = await prisma.supplierContact.create({ data: { categoryId: category.id, supplierName: 'Unassigned fixture', email: 'other@example.test' } });
      assert.equal((await put(admin, grant, { active: true })).status, 200);
      assert.equal((await customer.get('/api/supplier/contacts')).status, 401);
      await login(customer, address, changedPassword);
      assert.equal((await put(admin, `/api/admin/contacts/${contact.id}/assignment`, { supplierId: user.id })).status, 200);
      const owned = await customer.get('/api/supplier/contacts'); assert.equal(owned.status, 200); assert.deepEqual(owned.body.contacts.map((row) => row.id), [contact.id]);
      const draft = { supplierName: 'Edited fixture', email: 'fixture@example.test' };
      assert.equal((await put(customer, `/api/supplier/contacts/${otherContact.id}`, draft)).status, 404);
      assert.equal((await put(customer, `/api/supplier/contacts/${contact.id}`, { ...draft, supplierId: otherUser.id })).status, 400);
      assert.equal((await put(customer, `/api/supplier/contacts/${contact.id}`, draft)).status, 200);
      assert.equal((await put(other, `/api/supplier/contacts/${contact.id}`, draft)).status, 403);
      assert.equal((await admin.get(`/api/admin/categories/${category.id}/contacts`)).body.contacts.length, 2);
      assert.equal((await put(admin, `/api/admin/contacts/${contact.id}/assignment`, { supplierId: null })).status, 200);
      assert.equal((await put(customer, `/api/supplier/contacts/${contact.id}`, draft)).status, 404);
      assert.equal((await put(admin, grant, { active: false })).status, 200);
      assert.equal((await customer.get('/api/supplier/contacts')).status, 401);
      await login(customer, address, changedPassword);
      assert.equal((await customer.get('/api/supplier/contacts')).status, 403);
      assert.equal((await put(admin, `/api/admin/contacts/${contact.id}/assignment`, { supplierId: user.id })).status, 400);
      assert.equal((await put(customer, grant, { active: true, role: 'ADMIN' })).status, 403);
    });

    await t.test('Customer and guest purchases remain separate; matching email grants no ownership', async () => {
      const server = await start(), guest = request.agent(server), customer = request.agent(server), other = request.agent(server);
      await capture(await guest.get('/api/auth/me'));
      const guestOrder = await post(guest, '/api/orders', { customerEmail: address, items: [{ categoryId: category.id }] }); assert.equal(guestOrder.status, 201);
      const owner = (await prisma.order.findUniqueOrThrow({ where: { id: guestOrder.body.order.id } })).userId;
      await login(customer, address, changedPassword); await login(other, otherAddress);
      assert.equal((await customer.get(`/api/orders/${guestOrder.body.order.id}`)).status, 404);
      assert.equal((await other.get(`/api/orders/${guestOrder.body.order.id}`)).status, 404);
      const purchase = await post(customer, '/api/account/orders', { customerEmail: address, items: [{ categoryId: category.id }] }); assert.equal(purchase.status, 201);
      assert.equal((await prisma.order.findUnique({ where: { id: purchase.body.order.id } })).userId, user.id);
      assert.equal((await other.get(`/api/orders/${purchase.body.order.id}`)).status, 404);
      assert.equal((await post(other, `/api/dev/payments/${purchase.body.order.id}/simulate`)).status, 404);
      await login(guest, address, changedPassword);
      assert.equal((await prisma.order.findUnique({ where: { id: guestOrder.body.order.id } })).userId, owner);
      assert.deepEqual((await guest.get('/api/orders')).body.items.map((row) => row.id), [purchase.body.order.id]);
      assert.deepEqual((await guest.get('/api/guest/orders')).body.items.map((row) => row.id), [guestOrder.body.order.id]);
      assert.equal((await guest.get(`/api/orders/${guestOrder.body.order.id}`)).status, 200);
      assert.equal((await post(customer, `/api/dev/payments/${purchase.body.order.id}/simulate`)).status, 200);
      assert.equal((await customer.get(`/api/orders/${purchase.body.order.id}/delivery`)).status, 200);
      assert.equal((await other.get(`/api/orders/${purchase.body.order.id}/delivery`)).status, 404);
    });

    await t.test('SMTP queue persists encrypted payloads and retries with concurrent claims using only mocked delivery', async () => {
      const config = readAuthEmailConfig({ NODE_ENV: 'development', AUTH_EMAIL_TRANSPORT: 'smtp', AUTH_APP_ORIGIN: 'https://marketplace.example.test',
        SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'mail@example.test', SMTP_FROM: 'mail@example.test',
        SMTP_PASS: 'fictional-integration-secret', AUTH_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64url') });
      let time = Date.now(), calls = 0, fail = true;
      const service = authenticationEmail(prisma, { config, clock: () => time, transport: { async send() { calls++; if (fail) throw new Error('Private mocked provider diagnostic'); } } });
      await prisma.$transaction((tx) => service.queue(tx, otherUser.id, otherUser.email, 'RESET_PASSWORD', 'dark'));
      const queued = await prisma.authEmail.findFirstOrThrow({ where: { userId: otherUser.id, subject: 'Reset your password' } });
      assert.ok(!queued.body.includes('#token='));
      assert.equal(await service.deliver(queued.id), 'FAILED');
      assert.equal(authEmailPreview((await prisma.authEmail.findUniqueOrThrow({ where: { id: queued.id } })).body).status, 'FAILED');
      time += 30001; fail = false;
      assert.deepEqual((await Promise.all([service.deliver(queued.id), service.deliver(queued.id)])).sort(), ['SENT', 'SKIPPED']);
      const sent = await prisma.authEmail.findUniqueOrThrow({ where: { id: queued.id } });
      assert.equal(authEmailPreview(sent.body).status, 'SENT'); assert.ok(!sent.body.includes('payload')); assert.equal(calls, 2);
    });

    await t.test('CSRF, auth rate limits and the private local outbox cannot be bypassed', async () => {
      const server = await start(), agent = request.agent(server);
      assert.equal((await agent.post('/api/auth/login').send({ email: address, password: changedPassword })).status, 403);
      assert.equal((await agent.get('/api/dev/auth-email-outbox')).status, 403);
      for (let count = 0; count < 20; count++) assert.equal((await post(agent, '/api/auth/forgot-password', { email: rateAddress })).status, 202);
      assert.equal((await post(agent, '/api/auth/forgot-password', { email: rateAddress })).status, 429);
      const independentServer = request.agent(await start());
      assert.equal((await post(independentServer, '/api/auth/forgot-password', { email: rateAddress })).status, 429);
    });
  } finally {
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    for (const address of addresses) { const user = await prisma.user.findUnique({ where: { email: address } }); if (user) trackedUsers.add(user.id); }
    await prisma.order.deleteMany({ where: { id: { in: [...trackedOrders] } } });
    await prisma.category.deleteMany({ where: { id: { in: [...categories] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...trackedUsers] } } });
    await prisma.session.deleteMany({ where: { idHash: { in: [...trackedSessions] } } });
    const throttleKeys = [...addresses, `${run}-missing@example.test`, `${run}-unknown@example.test`].map((address) => createHmac('sha256', process.env.SESSION_SECRET).update('auth-rate/').update(address).digest('hex'));
    await prisma.authRateLimit.deleteMany({ where: { keyHash: { in: throttleKeys } } });
    await prisma.$disconnect();
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-auth-'));
    await rm(temp, { recursive: true, force: true });
  }
});
