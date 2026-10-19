import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';

declare module 'express-session' {
  interface SessionData { csrfToken?: string }
}

export type SecurityConfig = { remote: boolean; origin?: string; secret: string; origins: Set<string> };
export const isLoopback = (address?: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');
const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function securityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  if (env.REMOTE_TESTING && !['true', 'false'].includes(env.REMOTE_TESTING)) throw new Error('REMOTE_TESTING must be true or false.');
  const remote = env.REMOTE_TESTING === 'true';
  let origin: string | undefined;
  if (remote) {
    try {
      const url = new URL(env.REMOTE_ORIGIN ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || localHost.test(url.host) || url.hostname.endsWith('.trycloudflare.com')) throw new Error();
      origin = url.origin;
    } catch { throw new Error('Remote testing requires a dedicated HTTPS REMOTE_ORIGIN protected by Cloudflare Access. Quick tunnels are not supported.'); }
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || /replace|example|change.?me/i.test(env.SESSION_SECRET)) {
      throw new Error('Remote testing requires a randomly generated SESSION_SECRET of at least 32 characters.');
    }
  } else if (env.REMOTE_ORIGIN) throw new Error('REMOTE_ORIGIN requires REMOTE_TESTING=true.');
  const configured = env.SESSION_SECRET;
  const secret = configured && configured.length >= 32 && !/replace|change.?me/i.test(configured) ? configured : randomBytes(48).toString('base64url');
  const origins = new Set(remote ? [origin!] : [
    ...['localhost', '127.0.0.1', '[::1]'].flatMap((host) => [5173, 4173, Number(env.PORT || 3001)].map((port) => `http://${host}:${port}`)),
  ]);
  return { remote, origin, secret, origins };
}

export const cookieOptions = (remote: boolean) => ({ httpOnly: true, secure: remote || process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' });

export function boundary(config: SecurityConfig): RequestHandler {
  return (req, res, next) => {
    const host = req.get('host') ?? '';
    if (req.originalUrl.length > 2048) return res.status(414).json({ error: 'Request URL is too long.' });
    if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: 'Only loopback origin connections are accepted.' });
    if (config.remote) {
      if (host.toLowerCase() !== new URL(config.origin!).host || req.get('x-forwarded-proto') !== 'https') {
        return res.status(403).json({ error: 'Use the configured private HTTPS origin.' });
      }
    } else if (!localHost.test(host) || Object.keys(req.headers).some((name) => name.startsWith('x-forwarded-') || name.startsWith('cf-'))) {
      return res.status(403).json({ error: 'Local mode cannot be accessed through a tunnel or forwarded host. Use private remote-test mode.' });
    }
    const origin = req.get('origin');
    if ((origin && !config.origins.has(origin)) || req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    next();
  };
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (req.app.locals.remoteTesting) res.set('Strict-Transport-Security', 'max-age=86400');
  next();
};

// All remote testers share the loopback connector's budget. Never trust client
// X-Forwarded-For / CF-Connecting-IP for rate-limit keys or authorization.
export function createRateLimit(max: number, windowMs = 60000, clock = Date.now): RequestHandler {
  const buckets = new Map<string, { count: number; expires: number }>();
  return (req, res, next) => {
    const now = clock();
    for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    const key = req.socket.remoteAddress ?? 'unknown';
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= 1024) return res.status(429).set('Retry-After', '60').json({ error: 'Too many requests. Try again later.' });
      bucket = { count: 0, expires: now + windowMs }; buckets.set(key, bucket);
    }
    if (++bucket.count > max) return res.status(429).set('Retry-After', String(Math.max(1, Math.ceil((bucket.expires - now) / 1000)))).json({ error: 'Too many requests. Try again later.' });
    next();
  };
}

export const unsafeMethod = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

export function csrfToken(req: Request, res: Response) {
  // Concurrent initial reads of an established session must issue the same token.
  // The server-only key and session ID bind it to this session; regeneration rotates it.
  req.session.csrfToken ??= createHmac('sha256', req.app.locals.csrfSecret).update('supplier-market/csrf/').update(req.sessionID).digest('base64url');
  res.set('Cache-Control', 'no-store').json({ csrfToken: req.session.csrfToken });
}

export const csrfProtection: RequestHandler = (req, res, next) => {
  if (!unsafeMethod(req.method)) return next();
  const received = req.get('x-csrf-token');
  const expected = req.session.csrfToken;
  if (!received || !expected || !/^[A-Za-z0-9_-]{43}$/.test(received) || received.length !== expected.length || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return res.status(403).json({ error: 'CSRF token is missing or invalid.', code: 'CSRF_INVALID' });
  }
  if (Number(req.get('content-length') ?? 0) > 0 && !req.is('application/json')
    && !(req.method === 'POST' && /^\/api\/admin\/categories\/[^/]+\/image$/.test(req.path) && req.is('multipart/form-data'))) {
    return res.status(415).json({ error: 'Use JSON for API requests or multipart for image uploads.' });
  }
  next();
};

export const storefrontCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
