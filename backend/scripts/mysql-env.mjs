import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export class LocalMysqlError extends Error {}

export function assertTestTarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new LocalMysqlError('Invalid local test DATABASE_URL; value hidden.'); }
  if (url.protocol !== 'mysql:' || url.hostname !== 'localhost' || url.port !== '3306'
    || url.pathname !== '/loja1_test' || url.username !== 'loja1_test_app' || url.search || url.hash) {
    throw new LocalMysqlError('Refusing connection: required target is localhost:3306/loja1_test as loja1_test_app, without URL options.');
  }
  return url;
}

export function testEnvironment({ allowPlaceholder = false } = {}) {
  const filename = '.env.mysql.test';
  try { execFileSync('git', ['check-ignore', '-q', '--', filename], { cwd: root, stdio: 'ignore' }); }
  catch { throw new LocalMysqlError('The local MySQL environment file must be Git-ignored.'); }
  let config;
  try { config = parse(readFileSync(path.join(root, filename))); }
  catch { throw new LocalMysqlError('Create .env.mysql.test using docs/mysql-migration.md; never send credentials in chat.'); }
  const url = assertTestTarget(config.DATABASE_URL);
  if (!allowPlaceholder && (!url.password || url.password === 'REPLACE_LOCALLY')) {
    throw new LocalMysqlError('Configure the password locally in .env.mysql.test (URL-encoded). No connection attempted.');
  }
  if (config.NODE_ENV && config.NODE_ENV !== 'development') throw new LocalMysqlError('Only development mode is allowed.');
  if (!allowPlaceholder && (!config.SESSION_SECRET || config.SESSION_SECRET.length < 32 || /replace|change.?me/i.test(config.SESSION_SECRET))) {
    throw new LocalMysqlError('Set a random SESSION_SECRET of at least 32 characters in .env.mysql.test; keep it stable across restarts.');
  }
  return {
    ...process.env, DATABASE_URL: config.DATABASE_URL, NODE_ENV: 'development',
    SESSION_SECRET: config.SESSION_SECRET, REMOTE_TESTING: 'false', REMOTE_ORIGIN: '',
    ALLOW_MOCK_PAYMENT: 'true', MYSQL_INTEGRATION: 'true',
  };
}

export function redact(output, env) {
  let text = String(output ?? '');
  const url = new URL(env.DATABASE_URL);
  for (const secret of [env.DATABASE_URL, url.password, decodeURIComponent(url.password), env.SESSION_SECRET].filter(Boolean)) {
    text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/mysql:\/\/[^\s"']+/gi, '[REDACTED MYSQL URL]');
}
