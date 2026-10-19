import { createRequire } from 'node:module';
import { z } from 'zod';

export class AuthEmailConfigurationError extends Error {
  constructor() { super('Authentication email configuration is missing or invalid.'); }
}
export type AuthEmailConfig = {
  mode: 'preview' | 'smtp'; origin: string; encryptionKey?: Buffer;
  smtp?: { host: string; port: number; user: string; pass: string; from: string; timeout: number };
};
export type AuthMail = { recipient: string; subject: string; text: string; html: string };
export type AuthEmailTransport = { send(message: AuthMail, id: string): Promise<void> };
type SmtpClient = { sendMail(message: Record<string, unknown>): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>; close(): void };
export type SmtpFactory = (options: Record<string, unknown>) => SmtpClient;

export function readAuthEmailConfig(env: NodeJS.ProcessEnv = process.env): AuthEmailConfig {
  try {
    const mode = env.AUTH_EMAIL_TRANSPORT ?? (env.NODE_ENV === 'development' ? 'preview' : '');
    if (!['preview', 'smtp'].includes(mode) || mode === 'preview' && env.NODE_ENV !== 'development') throw new Error();
    const configuredOrigin = env.AUTH_APP_ORIGIN ?? (mode === 'preview' ? 'http://localhost:5173' : '');
    if (!configuredOrigin || /[\s\u0000-\u001f\\]/.test(configuredOrigin)) throw new Error();
    const origin = new URL(configuredOrigin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || (origin.protocol !== 'https:' && !(mode === 'preview' && loopback && origin.protocol === 'http:'))
      || (mode === 'smtp' && loopback)) throw new Error();
    if (mode === 'preview') return { mode, origin: origin.origin };
    const port = Number(env.SMTP_PORT);
    const timeout = Number(env.SMTP_TIMEOUT_MS ?? 10000);
    const host = env.SMTP_HOST ?? '';
    if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
      || ![465, 587].includes(port) || !Number.isInteger(timeout) || timeout < 1000 || timeout > 30000
      || !env.SMTP_PASS || /[\r\n\u0000]/.test(env.SMTP_PASS)) throw new Error();
    const user = z.string().email().max(254).parse(env.SMTP_USER);
    const from = z.string().email().max(254).parse(env.SMTP_FROM);
    const encodedKey = env.AUTH_EMAIL_ENCRYPTION_KEY ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new Error();
    const encryptionKey = Buffer.from(encodedKey, 'base64url');
    if (encryptionKey.length !== 32 || encryptionKey.toString('base64url') !== encodedKey) throw new Error();
    return { mode: 'smtp', origin: origin.origin, encryptionKey, smtp: { host, port, user, pass: env.SMTP_PASS, from, timeout } };
  } catch { throw new AuthEmailConfigurationError(); }
}

export function authActionUrl(config: AuthEmailConfig, purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD', token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !['VERIFY_EMAIL', 'RESET_PASSWORD'].includes(purpose)) throw new AuthEmailConfigurationError();
  const url = new URL(purpose === 'VERIFY_EMAIL' ? '/verify-email' : '/reset-password', config.origin);
  url.hash = 'token=' + token;
  return url.href;
}

export function createPreviewTransport(): AuthEmailTransport {
  // The durable queue contains the rendered preview; this adapter never opens a socket.
  return { async send() {} };
}

export function createSmtpTransport(config: AuthEmailConfig, factory?: SmtpFactory): AuthEmailTransport {
  if (!config.smtp || config.mode !== 'smtp') throw new AuthEmailConfigurationError();
  const smtp = config.smtp;
  const create = factory ?? ((options) => {
    try { return createRequire(import.meta.url)('nodemailer').createTransport(options) as SmtpClient; }
    catch { throw new AuthEmailConfigurationError(); }
  });
  return {
    async send(message, id) {
      // No pool, debug, logger, URL attachments or filesystem attachments. TLS
      // certificate verification is mandatory on both implicit TLS and STARTTLS.
      let client: SmtpClient | undefined, timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!z.string().email().max(254).safeParse(message.recipient).success || !/^[A-Za-z0-9-]{1,128}$/.test(id)
          || /[\r\n]/.test(message.subject)) throw new Error('Invalid message.');
        client = create({ host: smtp.host, port: smtp.port, secure: smtp.port === 465,
          requireTLS: true, auth: { user: smtp.user, pass: smtp.pass },
          tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: smtp.host },
          connectionTimeout: smtp.timeout, greetingTimeout: smtp.timeout, socketTimeout: smtp.timeout,
          dnsTimeout: Math.min(smtp.timeout, 5000), pool: false, logger: false, debug: false,
          transactionLog: false, disableFileAccess: true, disableUrlAccess: true });
        const result = await Promise.race([
          client.sendMail({ from: { name: 'Supplier Market', address: smtp.from }, to: { address: message.recipient },
            subject: message.subject, text: message.text, html: message.html,
            messageId: `<auth-${id}@${smtp.from.split('@')[1]}>`, disableFileAccess: true, disableUrlAccess: true }),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Delivery timeout.')), smtp.timeout); }),
        ]);
        if (!result.accepted?.length || result.rejected?.length) throw new Error('Delivery rejected.');
      } catch { throw new Error('Authentication email delivery failed; retry remains available.'); }
      finally { if (timer) clearTimeout(timer); try { client?.close(); } catch { /* Suppress provider details during cleanup. */ } }
    },
  };
}
