import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { authSchemaInitializer } from '../src/auth-schema.ts';
import { bootstrapAdmin } from '../src/admin-bootstrap.ts';
import { hashPassword } from '../src/passwords.ts';

test('Auth migration preserves legacy SQLite data and initial Admin setup grants no unverified or second Admin', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'loja1-auth-migration-'));
  const filename = path.join(temp, 'legacy.db');
  const sqlite = new DatabaseSync(filename);
  const fixture = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const legacy = fixture.split(/\r?\n/).filter((line) => !/CREATE (?:TABLE|(?:UNIQUE )?INDEX) (?:Account|AuthToken|AuthEmail|AuthRateLimit|SupplierProfile|SupplierContact_supplierId_idx)/.test(line)).join('\n').replace(', supplierId TEXT REFERENCES SupplierProfile(userId) ON DELETE SET NULL ON UPDATE CASCADE', '');
  sqlite.exec(legacy);
  sqlite.exec("INSERT INTO User (id,role,displayName,email) VALUES ('legacy-guest','GUEST','Fixture','guest@local.test'); INSERT INTO Category (id,name,slug,description,priceCents,imageUrl,updatedAt) VALUES ('legacy-category','Fixture','legacy-category','Preserved fixture',1200,'fixture',CURRENT_TIMESTAMP); INSERT INTO SupplierContact (id,categoryId,supplierName,email) VALUES ('legacy-contact','legacy-category','Preserved contact','fixture@example.test');");
  sqlite.close();
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'file:' + filename.replaceAll('\\', '/');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  try {
    await authSchemaInitializer(prisma)(); await authSchemaInitializer(prisma)();
    assert.equal((await prisma.user.findUnique({ where: { id: 'legacy-guest' } })).role, 'GUEST');
    assert.equal((await prisma.supplierContact.findUnique({ where: { id: 'legacy-contact' } })).supplierName, 'Preserved contact');
    assert.equal(await prisma.account.count(), 0);
    const passwordHash = await hashPassword('Fictional bootstrap test password');
    const user = await prisma.user.create({ data: { email: 'bootstrap@example.test', role: 'CUSTOMER', displayName: 'Fixture', account: { create: { passwordHash } } } });
    await assert.rejects(bootstrapAdmin(prisma, user.email), /verified Customer/);
    await prisma.account.update({ where: { userId: user.id }, data: { emailVerifiedAt: new Date() } });
    await bootstrapAdmin(prisma, user.email);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).role, 'ADMIN');
    assert.equal((await prisma.account.findUnique({ where: { userId: user.id } })).sessionVersion, 1);
    await assert.rejects(bootstrapAdmin(prisma, user.email), /already exists/);
  } finally {
    await prisma.$disconnect();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    assert.ok(path.resolve(temp).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(temp).startsWith('loja1-auth-migration-'));
    await rm(temp, { recursive: true, force: true });
  }
});
