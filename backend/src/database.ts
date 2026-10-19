import './config.js';
import { createRequire } from 'node:module';
import * as sqlite from '@prisma/client';

export const isMysql = process.env.DATABASE_URL?.startsWith('mysql:') === true;
if (isMysql) {
  let target: URL;
  try { target = new URL(process.env.DATABASE_URL!); }
  catch { throw new Error('Invalid MySQL configuration; connection details hidden.'); }
  if (target.hostname !== 'localhost' || target.port !== '3306' || target.pathname !== '/loja1_test'
    || target.username !== 'loja1_test_app' || target.search || target.hash) {
    throw new Error('MySQL is restricted to localhost:3306/loja1_test with the local test account.');
  }
}

// Both schemas expose the same Prisma models. A separate generated client keeps
// MySQL generation from replacing the default SQLite client or its datasource.
const client: typeof sqlite = isMysql ? createRequire(import.meta.url)('.prisma/mysql-client') : sqlite;
export const PrismaClient = client.PrismaClient;
export const Prisma = client.Prisma;
export type PrismaClient = sqlite.PrismaClient;
