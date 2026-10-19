import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import nodemailer from 'nodemailer';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { once } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { authenticationEmail, authEmailPreview, renderAuthEmail } from '../src/auth-email.ts';
import { authActionUrl, readAuthEmailConfig, createPreviewTransport, createSmtpTransport } from '../src/auth-email-transport.ts';
import { authentication } from '../src/authentication.ts';
import { DatabaseSessionStore } from '../src/session-store.ts';

const smtpEnv = { NODE_ENV: 'development', AUTH_EMAIL_TRANSPORT: 'smtp', AUTH_APP_ORIGIN: 'https://marketplace.example.test',
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'mail@example.test', SMTP_FROM: 'mail@example.test',
  SMTP_PASS: 'fictional-smtp-secret', AUTH_EMAIL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'), SMTP_TIMEOUT_MS: '1000' };
const smtp = () => readAuthEmailConfig(smtpEnv);
const preview = () => readAuthEmailConfig({ NODE_ENV: 'development' });

test('Auth email config: preview is development-only; SMTP requires safe origin, TLS ports, credentials and queue key', () => {
  assert.equal(preview().mode, 'preview');
  assert.equal(smtp().mode, 'smtp');
  assert.equal(readAuthEmailConfig({ ...smtpEnv, NODE_ENV: 'production' }).mode, 'smtp');
  for (const changes of [
    { NODE_ENV: 'production', AUTH_EMAIL_TRANSPORT: 'preview' }, { AUTH_EMAIL_TRANSPORT: 'unknown' },
    { AUTH_APP_ORIGIN: '' }, { AUTH_APP_ORIGIN: 'http://marketplace.example.test' },
    { AUTH_APP_ORIGIN: 'https://attacker@example.test' }, { AUTH_APP_ORIGIN: 'https://marketplace.example.test/redirect' },
    { AUTH_APP_ORIGIN: 'https://marketplace.example.test/?next=https://attacker.example.test' },
    { AUTH_APP_ORIGIN: 'https://marketplace.example.test/#fragment' }, { AUTH_APP_ORIGIN: 'https://localhost' },
    { SMTP_HOST: 'smtp.example.test/path' }, { SMTP_PORT: '25' }, { SMTP_USER: '' }, { SMTP_PASS: '' },
    { SMTP_FROM: 'mail@example.test\r\nBcc: attacker@example.test' }, { AUTH_EMAIL_ENCRYPTION_KEY: '' },
    { AUTH_EMAIL_ENCRYPTION_KEY: 'short' }, { SMTP_TIMEOUT_MS: '0' }, { SMTP_TIMEOUT_MS: '600000' },
  ]) {
    assert.throws(() => readAuthEmailConfig({ ...smtpEnv, ...changes }), (error) => error.message === 'Authentication email configuration is missing or invalid.');
  }
});

test('Auth links: fixed configured origin and paths, fragment tokens, HTTPS SMTP, no request-host or redirect input', () => {
  for (const [purpose, expected] of [['VERIFY_EMAIL', '/verify-email'], ['RESET_PASSWORD', '/reset-password']]) {
    const url = new URL(authActionUrl(smtp(), purpose, 'a'.repeat(43)));
    assert.equal(url.origin, 'https://marketplace.example.test'); assert.equal(url.pathname, expected);
    assert.equal(url.search, ''); assert.ok(url.hash.startsWith('#token='));
  }
  assert.equal(new URL(authActionUrl(preview(), 'VERIFY_EMAIL', 'a'.repeat(43))).origin, 'http://localhost:5173');
  assert.throws(() => authActionUrl(smtp(), '//attacker.example.test', 'a'.repeat(43)));
  assert.throws(() => authActionUrl(smtp(), 'RESET_PASSWORD', 'invalid&redirect=attacker'));
});

test('Auth email rendering: all four themes preserve branding, action, expiry and honest transport notices', async () => {
  const url = authActionUrl(smtp(), 'VERIFY_EMAIL', 'a'.repeat(43));
  const layouts = new Set();
  for (const theme of ['classic', 'minimal', 'marketplace', 'dark']) {
    for (const purpose of ['VERIFY_EMAIL', 'RESET_PASSWORD']) {
      const message = renderAuthEmail(purpose, 'customer@example.test', url, theme, false);
      assert.ok(message.html.includes('Supplier Market') && message.text.includes('Supplier Market'));
      assert.ok(message.html.includes(purpose === 'VERIFY_EMAIL' ? 'Verificar email' : 'Redefinir senha'));
      assert.ok(message.text.includes(purpose === 'VERIFY_EMAIL' ? '24 horas' : '30 minutos'));
      assert.ok(!message.html.includes('Ver pedido') && !message.html.includes('Nenhuma mensagem externa foi enviada'));
      assert.ok(!/<script|<iframe|src="https?:/i.test(message.html));
      assert.ok(renderAuthEmail(purpose, 'customer@example.test', url, theme, true).text.includes('Nenhum email foi enviado'));
      layouts.add(message.html);
    }
  }
  assert.equal(layouts.size, 8);
  await createPreviewTransport().send({}, 'fixture'); // Pure local adapter, no socket/dependency activity.
});

test('SMTP transport: Nodemailer MIME composition with mocked delivery, validated TLS and no debug/attachments', async () => {
  let options, message, closed = 0, composed = false;
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const transport = createSmtpTransport(smtp(), (value) => {
    options = value;
    return { async sendMail(value) { message = value; const result = await stream.sendMail(value); composed = Buffer.isBuffer(result.message) && result.message.includes(Buffer.from('multipart/alternative')); return { accepted: ['customer@example.test'], rejected: [] }; }, close() { closed++; } };
  });
  await transport.send(renderAuthEmail('VERIFY_EMAIL', 'customer@example.test', authActionUrl(smtp(), 'VERIFY_EMAIL', 'a'.repeat(43)), 'classic', false), randomUUID());
  assert.ok(composed); assert.equal(options.secure, true); assert.equal(options.requireTLS, true);
  assert.deepEqual(options.tls, { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: 'smtp.example.test' });
  assert.equal(options.logger, false); assert.equal(options.debug, false);
  assert.equal(options.connectionTimeout, 1000); assert.equal(options.socketTimeout, 1000);
  assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
  assert.equal(message.from.name, 'Supplier Market'); assert.equal(message.to.address, 'customer@example.test'); assert.equal(closed, 1);
  const starttls = readAuthEmailConfig({ ...smtpEnv, SMTP_PORT: '587' });
  await createSmtpTransport(starttls, (value) => { assert.equal(value.secure, false); assert.equal(value.requireTLS, true); return { async sendMail() { return { accepted: ['customer@example.test'] }; }, close() {} }; }).send({ recipient: 'customer@example.test', subject: 'Fixture', text: 'Fixture', html: 'Fixture' }, randomUUID());
});

test('SMTP transport: rejection, provider exceptions, cleanup exceptions and deadline expose only a safe error', async () => {
  const message = { recipient: 'customer@example.test', subject: 'Fixture', text: 'Fixture', html: 'Fixture' };
  const safeFailure = (error) => error.message === 'Authentication email delivery failed; retry remains available.';
  for (const sendMail of [async () => { throw new Error('private provider diagnostics'); }, async () => ({ accepted: [], rejected: ['customer@example.test'] })]) {
    const transport = createSmtpTransport(smtp(), () => ({ sendMail, close() { throw new Error('private cleanup diagnostics'); } }));
    await assert.rejects(transport.send(message, randomUUID()), safeFailure);
  }
  let closed = false;
  const stalled = createSmtpTransport(smtp(), () => ({ sendMail: () => new Promise(() => {}), close() { closed = true; } }));
  await assert.rejects(stalled.send(message, randomUUID()), safeFailure); assert.equal(closed, true);
});

test('Auth email queue: preview persists; SMTP is encrypted, claimed once, retried, cancelled on expiry and redacted after acceptance', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loja1-email-queue-'));
  const filename = path.join(temp, 'queue.db'), sqlite = new DatabaseSync(filename);
  sqlite.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); sqlite.close();
  const prisma = new PrismaClient({ datasources: { db: { url: 'file:' + filename.replaceAll('\\', '/') } } });
  const previousUrl = process.env.DATABASE_URL; process.env.DATABASE_URL = 'file:' + filename.replaceAll('\\', '/');
  try {
    const user = await prisma.user.create({ data: { role: 'CUSTOMER', displayName: 'Fixture', email: 'queue@example.test', account: { create: { passwordHash: 'not-used-by-email-tests' } } } });
    const local = authenticationEmail(prisma, { config: preview() });
    await prisma.$transaction((tx) => local.queue(tx, user.id, user.email, 'VERIFY_EMAIL', 'dark'));
    const localRow = await prisma.authEmail.findFirstOrThrow({ where: { userId: user.id } });
    const displayed = authEmailPreview(localRow.body);
    assert.equal(displayed.status, 'PREVIEW'); assert.ok(displayed.html && displayed.body.includes('http://localhost:5173/verify-email#token='));
    assert.equal(await local.deliver(localRow.id), 'SKIPPED');
    let time = Date.now(), sends = 0, fail = true;
    const service = authenticationEmail(prisma, { config: smtp(), clock: () => time, transport: { async send(mail) { sends++; assert.equal(mail.recipient, user.email); if (fail) throw new Error('Private provider details'); await setTimeout(10); } } });
    await prisma.$transaction((tx) => service.queue(tx, user.id, user.email, 'VERIFY_EMAIL', 'minimal'));
    const row = await prisma.authEmail.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(!row.body.includes('#token=') && !row.body.includes('private provider'));
    assert.equal(await service.deliver(row.id), 'FAILED');
    const failed = await prisma.authEmail.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(authEmailPreview(failed.body).status, 'FAILED'); assert.ok(!failed.body.includes('Private provider details'));
    assert.equal(await service.deliver(row.id), 'SKIPPED');
    time += 30001; fail = false;
    const results = await Promise.all([service.deliver(row.id), service.deliver(row.id)]);
    assert.deepEqual(results.sort(), ['SENT', 'SKIPPED']); assert.equal(sends, 2);
    const sent = await prisma.authEmail.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(!sent.body.includes('payload')); assert.equal(authEmailPreview(sent.body).status, 'SENT');
    await prisma.$transaction((tx) => service.queue(tx, user.id, user.email, 'RESET_PASSWORD', 'classic'));
    const expired = await prisma.authEmail.findFirstOrThrow({ where: { userId: user.id, subject: 'Reset your password' } });
    await prisma.authToken.update({ where: { userId_purpose: { userId: user.id, purpose: 'RESET_PASSWORD' } }, data: { expiresAt: new Date(time - 1) } });
    assert.equal(await service.deliver(expired.id), 'CANCELLED'); assert.equal(sends, 2);
    // A full page of terminal records must never starve a newer eligible message.
    for (let index = 0; index < 101; index++) await prisma.authEmail.create({ data: { id: 'a' + String(index).padStart(4, '0'), userId: user.id, recipient: user.email, subject: 'Historical fixture', body: 'Historical local preview' } });
    await prisma.$transaction((tx) => service.queue(tx, user.id, user.email, 'VERIFY_EMAIL', 'classic'));
    assert.equal((await service.pending()).length, 1);
    const bounded = authenticationEmail(prisma, { config: smtp(), clock: () => time, transport: { async send() { throw new Error('Private delivery failure'); } } });
    const pendingId = (await bounded.pending())[0];
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal(await bounded.deliver(pendingId), 'FAILED');
      time += 30000 * 2 ** attempt + 1;
    }
    assert.equal(await bounded.deliver(pendingId), 'SKIPPED');
    assert.equal((await bounded.pending()).length, 0);
    // A crashed final attempt is terminal once its lease expires, never stuck SENDING.
    const terminal = await prisma.authEmail.findUniqueOrThrow({ where: { id: pendingId } });
    const prefix = 'SUPPLIER_MARKET_AUTH_EMAIL_V1\n', state = JSON.parse(terminal.body.slice(prefix.length));
    await prisma.authEmail.update({ where: { id: pendingId }, data: { body: prefix + JSON.stringify({ ...state, status: 'SENDING', lease: 'crashed-worker', leaseUntil: time - 1 }) } });
    assert.equal((await bounded.pending()).length, 1);
    assert.equal(await bounded.deliver(pendingId), 'FAILED');
    assert.equal((await bounded.pending()).length, 0);
    await prisma.$transaction((tx) => service.queue(tx, user.id, user.email, 'RESET_PASSWORD', 'classic'));
    const consumed = await prisma.authEmail.findFirstOrThrow({ where: { userId: user.id, subject: 'Reset your password' } });
    await prisma.authToken.update({ where: { userId_purpose: { userId: user.id, purpose: 'RESET_PASSWORD' } }, data: { usedAt: new Date(time) } });
    assert.equal(await service.deliver(consumed.id), 'CANCELLED'); assert.equal(sends, 2);
  } finally {
    await prisma.$disconnect(); if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-email-queue-'));
    await rm(temp, { recursive: true, force: true });
  }
});

test('Auth HTTP queues SMTP without connecting: known/unknown reset responses match and resending replaces failed work', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loja1-email-http-'));
  const filename = path.join(temp, 'http.db'), sqlite = new DatabaseSync(filename);
  sqlite.exec(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); sqlite.close();
  const config = { ...smtpEnv, DATABASE_URL: 'file:' + filename.replaceAll('\\', '/'), SESSION_SECRET: 'fictional-email-http-session-secret-32-plus' };
  const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  const prisma = new PrismaClient({ datasources: { db: { url: config.DATABASE_URL } } });
  let server;
  try {
    const auth = authentication(prisma), app = express();
    app.locals.csrfSecret = config.SESSION_SECRET;
    app.use(session({ secret: config.SESSION_SECRET, store: new DatabaseSessionStore(prisma), saveUninitialized: false, resave: false }));
    app.use(express.json()); app.use(auth.load); app.use('/api/auth', auth.router);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const email = 'smtp-queue@example.test', agent = request.agent(server);
    const registered = await agent.post('/api/auth/register').send({ email, password: 'Fictional email test password', displayName: 'Fixture' });
    assert.equal(registered.status, 202); assert.equal(registered.body.delivery, 'queued');
    assert.ok(!JSON.stringify(registered.body).includes('#token='));
    const known = await agent.post('/api/auth/forgot-password').send({ email });
    const unknown = await agent.post('/api/auth/forgot-password').send({ email: 'unknown@example.test' });
    assert.equal(known.status, 202); assert.deepEqual(known.body, unknown.body);
    assert.ok(known.body.message.includes('Delivery is not confirmed'));
    const row = await prisma.authEmail.findFirstOrThrow({ where: { recipient: email, subject: 'Verify your email' } });
    const service = authenticationEmail(prisma, { config: smtp(), transport: { async send() { throw new Error('Private provider failure'); } } });
    assert.equal(await service.deliver(row.id), 'FAILED');
    assert.equal((await agent.post('/api/auth/resend-verification').send({ email })).status, 202);
    const replacement = await prisma.authEmail.findFirstOrThrow({ where: { recipient: email, subject: 'Verify your email' } });
    assert.ok(replacement.id !== row.id); assert.equal(authEmailPreview(replacement.body).status, 'PENDING');
    assert.equal(await prisma.authEmail.count({ where: { recipient: email, subject: 'Verify your email' } }), 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await prisma.$disconnect();
    for (const key of Object.keys(config)) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-email-http-'));
    await rm(temp, { recursive: true, force: true });
  }
});
