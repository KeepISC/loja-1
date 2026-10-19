import { Router, type Request, type RequestHandler, type Response } from 'express';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword, verifyPassword, PasswordCapacityError } from './passwords.js';
import { authSchemaInitializer } from './auth-schema.js';
import { cookieOptions, createRateLimit } from './security.js';
import { retryTransaction } from './transaction-retry.js';
import { authenticationEmail } from './auth-email.js';
import { AuthEmailConfigurationError } from './auth-email-transport.js';

export type AccountIdentity = { id: string; role: 'CUSTOMER' | 'SUPPLIER' | 'ADMIN'; email: string; displayName: string; sessionVersion: number };
declare module 'express-serve-static-core' {
  interface Request { account?: AccountIdentity; authExpired?: boolean }
}
declare module 'express-session' {
  interface SessionData { accountId?: string; accountVersion?: number; authenticatedAt?: number }
}
export class AuthError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
const route = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { void handler(req, res).catch(next); };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const email = z.string().trim().toLowerCase().email().max(254).refine((value) => !value.endsWith('@local.test'), 'Use a real account email address.');
const password = z.string().min(12).max(128);
const credentials = z.object({ email, password }).strict();
let dummyHash: Promise<string> | undefined;

export const regenerateSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
const saveSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));

export const requireAccount = (...roles: AccountIdentity['role'][]): RequestHandler => (req, res, next) => {
  if (!req.account) return res.status(401).json({ error: 'Sign in to continue.', code: req.authExpired ? 'AUTH_EXPIRED' : 'AUTH_REQUIRED' });
  if (roles.length && !roles.includes(req.account.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  next();
};

export function authentication(prisma: PrismaClient) {
  const emails = authenticationEmail(prisma);
  const generic = { message: 'If the address is eligible, the request has been accepted for processing. Delivery is not confirmed; request another link if needed.',
    delivery: emails.mode === 'preview' ? 'local-preview' : 'queued' };
  const initialize = authSchemaInitializer(prisma);
  const load: RequestHandler = (req, _res, next) => {
    const resolve = async () => {
      await initialize();
      if (!req.session.accountId) return;
      if (req.app.locals.remoteTesting) { await regenerateSession(req); return; }
      const account = await prisma.account.findUnique({ where: { userId: req.session.accountId }, include: { user: { include: { supplier: true } } } });
      if (!account || !account.emailVerifiedAt || account.sessionVersion !== req.session.accountVersion
        || !req.session.authenticatedAt || Date.now() - req.session.authenticatedAt > 12 * 60 * 60 * 1000
        || !['CUSTOMER', 'SUPPLIER', 'ADMIN'].includes(account.user.role)
        || (account.user.role === 'SUPPLIER' && !account.user.supplier?.active)) {
        req.authExpired = true;
        await regenerateSession(req);
        return;
      }
      req.account = { id: account.userId, role: account.user.role as AccountIdentity['role'], email: account.user.email, displayName: account.user.displayName, sessionVersion: account.sessionVersion };
    };
    void resolve().then(() => next(), next);
  };
  const router = Router();
  const limit = createRateLimit(20, 60000);
  let nextCleanup = 0;
  router.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    // Logout must remain available even after a failed-login rate limit or a
    // configuration change. The application-level CSRF check still applies.
    if (req.path === '/logout') return next();
    if (req.app.locals.remoteTesting) return res.status(403).json({ error: 'Account authentication is unavailable in the guest-only remote demo.' });
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || /replace|change.?me/i.test(process.env.SESSION_SECRET)) {
      return res.status(503).json({ error: 'Configure a stable random SESSION_SECRET before using account authentication.' });
    }
    return limit(req, res, next);
  });
  const throttle = async (req: Request, address: string) => {
    const keyHash = createHmac('sha256', req.app.locals.csrfSecret).update('auth-rate/').update(address).digest('hex');
    const now = new Date();
    if (Date.now() >= nextCleanup) {
      await prisma.authRateLimit.deleteMany({ where: { expiresAt: { lte: now } } });
      nextCleanup = Date.now() + 60000;
    }
    await prisma.authRateLimit.updateMany({ where: { keyHash, expiresAt: { lte: now } }, data: { count: 0, expiresAt: new Date(Date.now() + 10 * 60000) } });
    const row = await prisma.authRateLimit.upsert({ where: { keyHash }, create: { keyHash, count: 1, expiresAt: new Date(Date.now() + 10 * 60000) }, update: { count: { increment: 1 } } });
    if (row.count > 20) throw new AuthError(429, 'Too many authentication attempts. Try again later.');
  };
  router.post('/register', route(async (req, res) => {
    const parsed = credentials.extend({ displayName: z.string().trim().min(2).max(80) }).safeParse(req.body);
    if (!parsed.success) throw new AuthError(400, 'Provide a name, valid email and password of 12–128 characters.');
    await throttle(req, parsed.data.email);
    const passwordHash = await hashPassword(parsed.data.password);
    const theme = await emails.theme();
    await retryTransaction(() => prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: parsed.data.email }, include: { account: true } });
      if (existing) {
        if (existing.account && !existing.account.emailVerifiedAt) await emails.queue(tx, existing.id, existing.email, 'VERIFY_EMAIL', theme);
        return;
      }
      const user = await tx.user.create({ data: { email: parsed.data.email, displayName: parsed.data.displayName, role: 'CUSTOMER', account: { create: { passwordHash } } } });
      await emails.queue(tx, user.id, user.email, 'VERIFY_EMAIL', theme);
    })).catch((error) => { if (error?.code !== 'P2002') throw error; });
    res.status(202).json(generic);
  }));

  router.post('/login', route(async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) throw new AuthError(401, 'Invalid email or password.');
    await throttle(req, parsed.data.email);
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, include: { account: true } });
    const encoded = user?.account?.passwordHash ?? await (dummyHash ??= hashPassword(randomBytes(32).toString('base64url')).catch((error) => { dummyHash = undefined; throw error; }));
    const valid = await verifyPassword(encoded, parsed.data.password);
    if (!valid || !user?.account) throw new AuthError(401, 'Invalid email or password.');
    if (!user.account.emailVerifiedAt) throw new AuthError(403, 'Verify your email before signing in.', 'EMAIL_UNVERIFIED');
    if (!['CUSTOMER', 'SUPPLIER', 'ADMIN'].includes(user.role)) throw new AuthError(401, 'Invalid email or password.');
    await regenerateSession(req);
    req.session.accountId = user.id; req.session.accountVersion = user.account.sessionVersion; req.session.authenticatedAt = Date.now();
    req.session.cookie.maxAge = 2 * 60 * 60 * 1000;
    await saveSession(req);
    res.json({ user: { role: user.role, displayName: user.displayName, email: user.email, authenticated: true, mockAccountSwitchingEnabled: false } });
  }));

  router.post('/logout', route(async (req, res) => {
    await new Promise<void>((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
    res.clearCookie('market_session', cookieOptions(req.app.locals.remoteTesting === true));
    res.json({ ok: true });
  }));

  for (const [path, purpose] of [['/forgot-password', 'RESET_PASSWORD'], ['/resend-verification', 'VERIFY_EMAIL']] as const) {
    router.post(path, route(async (req, res) => {
      const parsed = z.object({ email }).strict().safeParse(req.body);
      if (!parsed.success) throw new AuthError(400, 'Provide a valid email address.');
      await throttle(req, parsed.data.email);
      const theme = await emails.theme();
      await retryTransaction(() => prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { email: parsed.data.email }, include: { account: true } });
        if (user?.account && (purpose === 'RESET_PASSWORD' || !user.account.emailVerifiedAt)) await emails.queue(tx, user.id, user.email, purpose, theme);
      }));
      res.status(202).json(generic);
    }));
  }

  for (const [path, purpose] of [['/verify-email', 'VERIFY_EMAIL'], ['/reset-password', 'RESET_PASSWORD']] as const) {
    router.post(path, route(async (req, res) => {
      const schema = purpose === 'RESET_PASSWORD' ? z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password }).strict() : z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) throw new AuthError(400, 'Invalid or expired link or password.');
      const passwordHash = purpose === 'RESET_PASSWORD' ? await hashPassword((parsed.data as { token: string; password?: string }).password!) : undefined;
      await retryTransaction(() => prisma.$transaction(async (tx) => {
        const idHash = digest(parsed.data.token);
        const claimed = await tx.authToken.updateMany({ where: { idHash, purpose, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (!claimed.count) throw new AuthError(400, 'Invalid or expired link.');
        const token = await tx.authToken.findUniqueOrThrow({ where: { idHash } });
        await tx.account.update({ where: { userId: token.userId }, data: purpose === 'VERIFY_EMAIL' ? { emailVerifiedAt: new Date() } : { passwordHash, sessionVersion: { increment: 1 } } });
        // Delivered development links need not remain readable after consumption.
        await tx.authEmail.deleteMany({ where: { userId: token.userId, subject: purpose === 'VERIFY_EMAIL' ? 'Verify your email' : 'Reset your password' } });
      }));
      if (purpose === 'RESET_PASSWORD') await regenerateSession(req);
      res.json({ ok: true });
    }));
  }
  return { load, router, emailMode: emails.mode };
}

export const authErrorHandler = (error: unknown) => error instanceof PasswordCapacityError ? new AuthError(503, 'Authentication is busy. Try again shortly.')
  : error instanceof AuthEmailConfigurationError ? new AuthError(503, error.message) : error;
