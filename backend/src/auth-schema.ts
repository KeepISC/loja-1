import type { PrismaClient } from '@prisma/client';

// Existing SQLite databases use additive initialization. MySQL uses migrations.
export function authSchemaInitializer(prisma: PrismaClient) {
  let ready: Promise<void> | undefined;
  return () => ready ??= (async () => {
    if (!process.env.DATABASE_URL?.startsWith('file:')) return;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS Account (userId TEXT NOT NULL PRIMARY KEY REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE, passwordHash TEXT NOT NULL, emailVerifiedAt DATETIME, sessionVersion INTEGER NOT NULL DEFAULT 0)`;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS AuthToken (idHash TEXT NOT NULL PRIMARY KEY, userId TEXT NOT NULL REFERENCES Account(userId) ON DELETE CASCADE ON UPDATE CASCADE, purpose TEXT NOT NULL, expiresAt DATETIME NOT NULL, usedAt DATETIME)`;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS AuthToken_userId_purpose_key ON AuthToken(userId, purpose)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS AuthToken_expiresAt_idx ON AuthToken(expiresAt)`;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS AuthEmail (id TEXT NOT NULL PRIMARY KEY, userId TEXT NOT NULL REFERENCES Account(userId) ON DELETE CASCADE ON UPDATE CASCADE, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS AuthEmail_userId_createdAt_idx ON AuthEmail(userId, createdAt)`;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS AuthRateLimit (keyHash TEXT NOT NULL PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expiresAt DATETIME NOT NULL)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS AuthRateLimit_expiresAt_idx ON AuthRateLimit(expiresAt)`;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS SupplierProfile (userId TEXT NOT NULL PRIMARY KEY REFERENCES User(id) ON DELETE CASCADE ON UPDATE CASCADE, active BOOLEAN NOT NULL DEFAULT false)`;
    const columns = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info('SupplierContact')`;
    if (!columns.some((column) => column.name === 'supplierId')) {
      try { await prisma.$executeRaw`ALTER TABLE SupplierContact ADD COLUMN supplierId TEXT REFERENCES SupplierProfile(userId) ON DELETE SET NULL ON UPDATE CASCADE`; }
      catch (error) {
        const current = await prisma.$queryRaw<Array<{ name: string }>>`PRAGMA table_info('SupplierContact')`;
        if (!current.some((column) => column.name === 'supplierId')) throw error;
      }
    }
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS SupplierContact_supplierId_idx ON SupplierContact(supplierId)`;
  })().catch((error) => { ready = undefined; throw error; });
}
