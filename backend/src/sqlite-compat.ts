import type { PrismaClient } from '@prisma/client';

// Additive compatibility for existing SQLite files, including ones predating
// settings/sessions. MySQL DDL is managed exclusively by versioned migrations.
export function sqliteInitializer(prisma: PrismaClient) {
  let ready: Promise<void> | undefined;
  return () => ready ??= (async () => {
    if (!process.env.DATABASE_URL?.startsWith('file:')) return;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "SiteSetting" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)`;
    await prisma.$executeRaw`CREATE TABLE IF NOT EXISTS "Session" ("idHash" TEXT NOT NULL PRIMARY KEY, "data" TEXT NOT NULL, "expiresAt" DATETIME NOT NULL)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session" ("expiresAt")`;
  })().catch((error) => { ready = undefined; throw error; });
}
