import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, testEnvironment, redact, LocalMysqlError } from './mysql-env.mjs';

const require = createRequire(import.meta.url);
const schema = path.join(root, 'prisma/mysql/schema.prisma');
const action = process.argv[2];
const actions = ['generate', 'inspect', 'migrate', 'test', 'validate'];

function run(args, env, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
  process.stdout.write(redact(result.stdout, env));
  process.stderr.write(redact(result.stderr, env));
  if (result.error || result.status !== 0) throw new LocalMysqlError(`Local command failed (${result.error?.code ?? result.status}); no credentials logged.`);
}

export async function inspectDatabase(prisma) {
  const [identity] = await prisma.$queryRaw`SELECT DATABASE() AS db, CURRENT_USER() AS account, @@port AS port, VERSION() AS version`;
  if (identity.db !== 'loja1_test' || !identity.account.startsWith('loja1_test_app@') || Number(identity.port) !== 3306 || !/^8\.0\./.test(identity.version)) {
    throw new LocalMysqlError('Connected server identity does not match the required local MySQL 8.0 test database/account/port.');
  }
  const tables = await prisma.$queryRaw`SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`;
  console.log('Verified localhost:3306/loja1_test, expected account, MySQL 8.0.');
  console.log('Existing tables: ' + (tables.map((table) => `${table.name} (${table.engine})`).join(', ') || '(empty)'));
  const known = new Set(['user', 'category', 'suppliercontact', 'order', 'orderitem', 'payment', 'emaildelivery', 'sitesetting', 'session', '_prisma_migrations', 'account', 'authtoken', 'authemail', 'authratelimit', 'supplierprofile']);
  if (tables.some((table) => !known.has(table.name.toLowerCase()))) throw new LocalMysqlError('Unexpected tables found; inspect and back up the test database before migrating.');
  if (tables.length && !tables.some((table) => table.name === '_prisma_migrations')) {
    throw new LocalMysqlError('Nonempty database without Prisma migration history; automatic baselining/reset is prohibited.');
  }
  if (tables.some((table) => table.engine !== 'InnoDB')) throw new LocalMysqlError('Existing tables must use InnoDB.');
  // Counts provide a pre-migration inventory without displaying customer records.
  for (const [table, model] of [['User', 'user'], ['Category', 'category'], ['Order', 'order'], ['Session', 'session']]) {
    if (tables.some((entry) => entry.name.toLowerCase() === table.toLowerCase())) console.log(`${table}: ${await prisma[model].count()} rows`);
  }
  return tables;
}

async function main() {
  if (!actions.includes(action)) throw new LocalMysqlError('Usage: node backend/scripts/mysql-local.mjs generate|inspect|migrate|test|validate');
  const env = testEnvironment({ allowPlaceholder: action === 'generate' });
  if (action === 'generate' || action === 'validate') {
    run([require.resolve('prisma/build/index.js'), 'generate', '--schema', schema], env);
    if (action === 'generate') return;
  }
  const { PrismaClient } = require('.prisma/mysql-client');
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try { await inspectDatabase(prisma); } finally { await prisma.$disconnect(); }
  if (action === 'migrate' || action === 'validate') {
    run([require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], env);
    run([require.resolve('prisma/build/index.js'), 'migrate', 'status', '--schema', schema], env);
  }
  if (action === 'test' || action === 'validate') {
    run([require.resolve('typescript/bin/tsc'), '-p', 'backend/tsconfig.json'], env);
    run(['--import', './test/source-loader.mjs', '--test', '--test-isolation=none', 'test/database.integration.mjs'], env, path.join(root, 'backend'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Prisma errors can contain connection strings. Report only our own safe messages or a code.
    console.error(error instanceof LocalMysqlError ? error.message : 'MySQL operation failed; connection details hidden.');
    process.exitCode = 1;
  });
}
