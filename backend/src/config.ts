import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const publicDir = path.join(projectRoot, 'backend', 'public');
export const uploadDir = path.join(publicDir, 'uploads');

// npm workspace commands run from backend, not from the project root.
// A private auth override allows stable signing keys without changing the SQLite
// datasource or placing secrets in the tracked environment template.
config({ path: path.join(projectRoot, '.env.auth.local') });
config({ path: path.join(projectRoot, '.env.auth-email.local') });
config({ path: path.join(projectRoot, '.env') });
process.env.DATABASE_URL ??= `file:${path.join(projectRoot, 'database', 'dev.db').replaceAll('\\', '/')}`;

export function requireDevelopment() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('This MVP requires NODE_ENV=development. Real providers are required outside development.');
  }
}
