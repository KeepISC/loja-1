import { createRequire } from 'node:module';
import { testEnvironment } from './mysql-env.mjs';
import { inspectDatabase } from './mysql-local.mjs';

Object.assign(process.env, testEnvironment());
const require = createRequire(import.meta.url);
const { PrismaClient } = require('.prisma/mysql-client');
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
try { await inspectDatabase(prisma); }
catch (error) {
  console.error(error.code ? `MySQL preflight failed (${error.code}); details hidden.` : 'MySQL preflight failed; connection details hidden.');
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
if (process.exitCode) process.exit(process.exitCode);
