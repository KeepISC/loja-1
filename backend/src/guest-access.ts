import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';

declare module 'express-serve-static-core' {
  interface Request { guestCustomerId?: string }
}

export const guestCookieName = 'market_guest';
const lifetime = 7 * 24 * 60 * 60 * 1000;

function credentialEmail(credential: string) {
  // Only a digest is stored. Neither a customer/order ID nor the role-session cookie is a guest credential.
  return `guest-${createHash('sha256').update(credential).digest('hex')}@local.test`;
}

export async function resolveGuest(req: Request, prisma: PrismaClient) {
  const cookies = (req.headers.cookie || '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(`${guestCookieName}=`));
  if (cookies.length !== 1) return undefined;
  const credential = cookies[0].slice(guestCookieName.length + 1);
  const match = /^([A-Za-z0-9_-]{43})\.(\d{13})$/.exec(credential);
  if (!match || Buffer.from(match[1], 'base64url').toString('base64url') !== match[1]
    || Number(match[2]) <= Date.now()) return undefined;
  const user = await prisma.user.findUnique({ where: { email: credentialEmail(credential) }, select: { id: true, role: true } });
  return user?.role === 'GUEST' ? user.id : undefined;
}

export async function ensureGuest(req: Request, res: Response, prisma: PrismaClient) {
  if (req.guestCustomerId) return req.guestCustomerId;
  const credential = `${randomBytes(32).toString('base64url')}.${Date.now() + lifetime}`;
  const email = credentialEmail(credential);
  let id: string | undefined;
  const legacyId = req.session.customerId;
  if (legacyId) {
    // Upgrade only a proven live legacy session's private synthetic user, never the shared guest identity.
    const upgraded = await prisma.user.updateMany({
      where: { id: legacyId, role: 'GUEST', email: `guest-${legacyId}@local.test` }, data: { email },
    });
    if (upgraded.count) id = legacyId;
  }
  if (!id) id = (await prisma.user.create({ data: { email, role: 'GUEST', displayName: 'Mock Guest' } })).id;
  req.guestCustomerId = id;
  req.session.customerId = id; // Compatibility/cache only; protected routes use the validated capability above.
  res.cookie(guestCookieName, credential, { httpOnly: true, sameSite: 'lax', secure: false, path: '/', maxAge: lifetime });
  return id;
}

export async function revokeGuest(req: Request, res: Response, prisma: PrismaClient) {
  if (req.guestCustomerId) {
    await prisma.user.updateMany({ where: { id: req.guestCustomerId, role: 'GUEST' }, data: { email: `revoked-${randomUUID()}@local.test` } });
  }
  res.clearCookie(guestCookieName, { httpOnly: true, sameSite: 'lax', secure: false, path: '/' });
}
