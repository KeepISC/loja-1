import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../../', import.meta.url));
let prisma;
try {
  execFileSync('git', ['check-ignore', '-q', '--', '.env.auth-admin.local'], { cwd: root, stdio: 'ignore' });
  const config = parse(readFileSync(path.join(root, '.env.auth-admin.local')));
  if (!config.ADMIN_EMAIL || config.CONFIRM_INITIAL_ADMIN !== 'true' || process.env.NODE_ENV === 'production') throw new Error();
  // Keep the existing local database selection; MySQL must be explicitly loaded
  // using the same test-only environment preloader as the integration suite.
  const { PrismaClient } = await import('../dist/database.js');
  const { bootstrapAdmin } = await import('../dist/admin-bootstrap.js');
  const { authSchemaInitializer } = await import('../dist/auth-schema.js');
  prisma = new PrismaClient();
  await authSchemaInitializer(prisma)();
  await bootstrapAdmin(prisma, config.ADMIN_EMAIL);
  console.log('Initial Admin granted. Existing sessions were invalidated; sign in again.');
} catch {
  console.error('Initial Admin setup failed. Configure the ignored .env.auth-admin.local file and a verified Customer; bootstrap is unavailable once a real Admin exists. Details hidden.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
