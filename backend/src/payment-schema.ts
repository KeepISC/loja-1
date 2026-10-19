import type { PrismaClient } from '@prisma/client';

// Additive SQLite upgrade; MySQL uses the versioned migration. No tables are rebuilt.
export function paymentSchemaInitializer(prisma: PrismaClient) {
  let ready: Promise<void> | undefined;
  return () => ready ??= (async () => {
    if (!process.env.DATABASE_URL?.startsWith('file:')) return;
    const additions = [
      ['Order', 'currency', "TEXT NOT NULL DEFAULT 'EUR'"],
      ['Payment', 'paymentIntentId', 'TEXT'],
      ['Payment', 'refundedCents', 'INTEGER NOT NULL DEFAULT 0'],
    ];
    for (const [table, column, declaration] of additions) {
      const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
      if (!columns.some((item) => item.name === column)) {
        try { await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${declaration}`); }
        catch (error) {
          const current = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
          if (!current.some((item) => item.name === column)) throw error;
        }
      }
    }
    // Every statement is a fixed application constant, never request input.
    for (const statement of statements) await prisma.$executeRawUnsafe(statement);
  })().catch((error) => { ready = undefined; throw error; });
}
const statements = [
  "CREATE TABLE IF NOT EXISTS PaymentAttempt (id TEXT NOT NULL PRIMARY KEY, paymentId TEXT NOT NULL REFERENCES Payment(id) ON DELETE CASCADE ON UPDATE CASCADE, status TEXT NOT NULL DEFAULT 'CREATING', sessionId TEXT, intentId TEXT, expiresAt DATETIME NOT NULL, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS PaymentAttempt_sessionId_key ON PaymentAttempt(sessionId)",
  "CREATE UNIQUE INDEX IF NOT EXISTS PaymentAttempt_intentId_key ON PaymentAttempt(intentId)",
  "CREATE INDEX IF NOT EXISTS PaymentAttempt_paymentId_createdAt_idx ON PaymentAttempt(paymentId, createdAt)",
  "CREATE TABLE IF NOT EXISTS PaymentEvent (id TEXT NOT NULL PRIMARY KEY, eventId TEXT, paymentId TEXT NOT NULL REFERENCES Payment(id) ON DELETE CASCADE ON UPDATE CASCADE, kind TEXT NOT NULL, status TEXT NOT NULL, amountCents INTEGER NOT NULL, currency TEXT NOT NULL, actorId TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE UNIQUE INDEX IF NOT EXISTS PaymentEvent_eventId_key ON PaymentEvent(eventId)",
  "CREATE INDEX IF NOT EXISTS PaymentEvent_paymentId_createdAt_idx ON PaymentEvent(paymentId, createdAt)",
  "CREATE TABLE IF NOT EXISTS PaymentRefund (id TEXT NOT NULL PRIMARY KEY, paymentId TEXT NOT NULL REFERENCES Payment(id) ON DELETE CASCADE ON UPDATE CASCADE, providerRefundId TEXT, amountCents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'REQUESTED', actorId TEXT, createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt DATETIME NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS PaymentRefund_providerRefundId_key ON PaymentRefund(providerRefundId)",
  "CREATE INDEX IF NOT EXISTS PaymentRefund_paymentId_createdAt_idx ON PaymentRefund(paymentId, createdAt)",
  "CREATE UNIQUE INDEX IF NOT EXISTS Payment_paymentIntentId_key ON Payment(paymentIntentId)",
];
