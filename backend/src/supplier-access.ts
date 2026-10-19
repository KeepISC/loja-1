import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AuthError, requireAccount } from './authentication.js';
import { retryTransaction } from './transaction-retry.js';

export const contactSchema = z.object({
  supplierName: z.string().min(2).max(80), email: z.string().email().max(254),
  telephone: z.string().max(80).optional().or(z.literal('')),
  whatsapp: z.string().max(80).optional().or(z.literal('')),
  website: z.string().max(200).optional().or(z.literal('')),
  notes: z.string().max(1500).optional().or(z.literal('')),
}).strict();
const route = (handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next) => { void handler(req, res).catch(next); };

export function supplierAdministration(prisma: PrismaClient) {
  const router = Router();
  router.get('/api/admin/accounts', requireAccount('ADMIN'), route(async (_req, res) => {
    const users = await prisma.user.findMany({ where: { account: { isNot: null } }, select: { id: true, email: true, displayName: true, role: true, account: { select: { emailVerifiedAt: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    res.json({ users });
  }));
  router.put('/api/admin/accounts/:id/supplier', requireAccount('ADMIN'), route(async (req, res) => {
    const parsed = z.object({ active: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) throw new AuthError(400, 'Provide only the Supplier active flag.');
    await retryTransaction(() => prisma.$transaction(async (tx) => {
      const userId = String(req.params.id);
      // Account version invalidation revokes every old session, including ones
      // that a concurrent in-flight response might write back after this commit.
      const account = await tx.account.updateMany({ where: { userId, emailVerifiedAt: { not: null }, user: { is: { role: { in: ['CUSTOMER', 'SUPPLIER'] } } } }, data: { sessionVersion: { increment: 1 } } });
      if (!account.count) throw new AuthError(404, 'Eligible account not found.');
      await tx.supplierProfile.upsert({ where: { userId }, create: { userId, active: parsed.data.active }, update: { active: parsed.data.active } });
      await tx.user.update({ where: { id: userId }, data: { role: parsed.data.active ? 'SUPPLIER' : 'CUSTOMER' } });
    }));
    res.json({ ok: true });
  }));
  router.put('/api/admin/contacts/:id/assignment', requireAccount('ADMIN'), route(async (req, res) => {
    const parsed = z.object({ supplierId: z.string().min(1).max(128).nullable() }).strict().safeParse(req.body);
    if (!parsed.success) throw new AuthError(400, 'Provide a Supplier ID or null.');
    await retryTransaction(() => prisma.$transaction(async (tx) => {
      const supplierId = parsed.data.supplierId;
      if (supplierId) {
        // Lock the same profile row as revocation, making assignment eligibility atomic.
        const eligible = await tx.supplierProfile.updateMany({ where: { userId: supplierId, active: true, user: { is: { role: 'SUPPLIER', account: { is: { emailVerifiedAt: { not: null } } } } } }, data: { active: true } });
        if (!eligible.count) throw new AuthError(400, 'Choose an active, verified Supplier.');
      }
      await tx.supplierContact.update({ where: { id: String(req.params.id) }, data: { supplierId } });
    }));
    res.json({ ok: true });
  }));
  router.get('/api/supplier/contacts', requireAccount('SUPPLIER'), route(async (req, res) => {
    const contacts = await prisma.supplierContact.findMany({ where: { supplierId: req.account!.id, supplier: { is: { active: true, user: { is: { role: 'SUPPLIER' } } } } }, orderBy: { id: 'asc' } });
    res.json({ contacts });
  }));
  router.put('/api/supplier/contacts/:id', requireAccount('SUPPLIER'), route(async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) throw new AuthError(400, 'Invalid contact fields.');
    const updated = await prisma.supplierContact.updateMany({
      where: { id: String(req.params.id), supplierId: req.account!.id,
        supplier: { is: { active: true, user: { is: { role: 'SUPPLIER', account: { is: { sessionVersion: req.account!.sessionVersion } } } } } } },
      data: parsed.data,
    });
    if (!updated.count) throw new AuthError(404, 'Assigned contact not found.');
    res.json({ ok: true });
  }));
  return router;
}
