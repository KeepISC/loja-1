import type { PrismaClient } from '@prisma/client';
import { retryTransaction } from './transaction-retry.js';

// Operator-only first-admin setup. No HTTP route or development-role session can
// promote an account. The caller must explicitly choose an already verified user.
export async function bootstrapAdmin(prisma: PrismaClient, address: string) {
  await retryTransaction(() => prisma.$transaction(async (tx) => {
    await tx.siteSetting.upsert({ where: { key: 'admin-bootstrap-lock' }, create: { key: 'admin-bootstrap-lock', value: 'locked' }, update: { value: 'locked' } });
    if (await tx.user.count({ where: { role: 'ADMIN', account: { isNot: null } } })) throw new Error('A real Admin already exists; initial bootstrap is closed.');
    const user = await tx.user.findUnique({ where: { email: address.trim().toLowerCase() }, include: { account: true } });
    if (!user?.account?.emailVerifiedAt || user.role !== 'CUSTOMER') throw new Error('Choose an existing verified Customer account.');
    await tx.account.update({ where: { userId: user.id }, data: { sessionVersion: { increment: 1 } } });
    await tx.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
  }));
}
