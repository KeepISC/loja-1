import * as crypto from 'node:crypto';

// Node >=24.7 provides the native Argon2 implementation. This declaration bridges
// the project's Node 22 type definitions; no password algorithm is implemented here.
type Argon2 = (algorithm: 'argon2id', parameters: {
  message: Buffer; nonce: Buffer; parallelism: number; tagLength: number; memory: number; passes: number;
}, callback: (error: Error | null, result: Buffer) => void) => void;
const argon2 = (crypto as unknown as { argon2?: Argon2 }).argon2;
let active = 0;
export class PasswordCapacityError extends Error {}

async function derive(password: string, salt: Buffer, memory = 19456, passes = 2, parallelism = 1) {
  if (!argon2) throw new Error('Native Argon2id requires Node 24.7 or newer.');
  if (active >= 4) throw new PasswordCapacityError('Authentication is busy. Try again shortly.');
  active++;
  const message = Buffer.from(password, 'utf8');
  try {
    return await new Promise<Buffer>((resolve, reject) => argon2('argon2id', {
      message, nonce: salt, memory, passes, parallelism, tagLength: 32,
    }, (error, result) => error ? reject(error) : resolve(result)));
  } finally { message.fill(0); active--; }
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt);
  return `$argon2id$v=19$m=19456,t=2,p=1$${salt.toString('base64').replace(/=+$/, '')}$${hash.toString('base64').replace(/=+$/, '')}`;
}

export async function verifyPassword(encoded: string, password: string) {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(encoded);
  if (!match) return false;
  const [, m, t, p, salt, expected] = match;
  if (+m < 19456 || +m > 65536 || +t < 2 || +t > 4 || +p < 1 || +p > 4) return false;
  const actual = await derive(password, Buffer.from(salt, 'base64'), +m, +t, +p);
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'base64'));
}
