import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { createAppearanceRepository, type ThemeId } from './appearance.js';
import { escapeEmailHtml, renderEmailDocument } from './email-templates.js';
import { authActionUrl, readAuthEmailConfig, createPreviewTransport, createSmtpTransport, type AuthEmailConfig, type AuthEmailTransport, type AuthMail } from './auth-email-transport.js';

type Purpose = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
type Status = 'PREVIEW' | 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
type Envelope = { version: 1; mode: 'preview' | 'smtp'; status: Status; attempts: number; purpose: Purpose;
  tokenHash: string; expiresAt: number; nextAttemptAt: number; lease?: string; leaseUntil?: number;
  payload?: string; failure?: 'DELIVERY_FAILED'; sentAt?: number };
const prefix = 'SUPPLIER_MARKET_AUTH_EMAIL_V1\n';
const encode = (message: Envelope) => prefix + JSON.stringify(message);
function decode(body: string): Envelope | undefined {
  if (!body.startsWith(prefix)) return;
  try { const value = JSON.parse(body.slice(prefix.length)); if (value.version === 1 && ['preview', 'smtp'].includes(value.mode)) return value as Envelope; } catch { /* Fail closed for malformed queue records. */ }
}
const subjectFor = (purpose: Purpose) => purpose === 'VERIFY_EMAIL' ? 'Verify your email' : 'Reset your password';

export function renderAuthEmail(purpose: Purpose, recipient: string, url: string, theme: ThemeId, preview: boolean): AuthMail {
  const verification = purpose === 'VERIFY_EMAIL';
  const title = verification ? 'Verifique o seu email' : 'Redefina a sua senha';
  const actionLabel = verification ? 'Verificar email' : 'Redefinir senha';
  const expiry = verification ? '24 horas' : '30 minutos';
  const intro = verification ? 'Confirme o endereço de email da sua conta Supplier Market.' : 'Recebemos um pedido de alteração da senha da sua conta Supplier Market.';
  const note = 'Este link é de uso único. Não o partilhe.';
  const footerNotice = preview ? 'Pré-visualização local. Nenhum email foi enviado.' : 'Email transacional de segurança da sua conta.';
  const content = `<p style="color:#394558;font-size:16px;line-height:25px;">O link expira em ${expiry}.</p><p style="color:#394558;font-size:14px;line-height:22px;">Abra esta ligação no navegador:<br><a href="${escapeEmailHtml(url)}">${escapeEmailHtml(url)}</a></p>`;
  return { recipient, subject: subjectFor(purpose),
    text: `Supplier Market\n${title}\n${intro}\nO link expira em ${expiry}.\n${url}\n${note}\nSe não pediu esta ação, ignore esta mensagem.\n${footerNotice}`,
    html: renderEmailDocument({ title, intro, content, url, actionLabel, actionNote: note, footerNotice,
      closingNote: 'Se não pediu esta ação, ignore esta mensagem.' }, theme) };
}

function protect(mail: AuthMail, config: AuthEmailConfig) {
  const serialized = JSON.stringify(mail);
  if (config.mode === 'preview') return serialized;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', config.encryptionKey!, iv);
  const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}
function reveal(payload: string, config: AuthEmailConfig): AuthMail {
  if (config.mode === 'preview') return JSON.parse(payload) as AuthMail;
  const [iv, tag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey!, iv); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as AuthMail;
}

export function authEmailPreview(body: string) {
  const envelope = decode(body);
  if (!envelope) return { body }; // Historical local plain-text previews remain readable.
  const state = { status: envelope.status, attempts: envelope.attempts, failure: envelope.failure };
  if (envelope.mode === 'preview' && envelope.payload) {
    const mail = JSON.parse(envelope.payload) as AuthMail;
    return { ...state, body: mail.text, html: mail.html };
  }
  return { ...state, body: 'SMTP delivery status only. Authentication links are not available in this preview.' };
}

export function authenticationEmail(prisma: PrismaClient, options: { config?: AuthEmailConfig; transport?: AuthEmailTransport; clock?: () => number } = {}) {
  const config = options.config ?? readAuthEmailConfig();
  const transport = options.transport ?? (config.mode === 'smtp' ? createSmtpTransport(config) : createPreviewTransport());
  const now = options.clock ?? Date.now;
  const appearance = createAppearanceRepository(prisma);
  return {
    mode: config.mode,
    async queue(tx: Prisma.TransactionClient, userId: string, recipient: string, purpose: Purpose, theme: ThemeId) {
      const token = randomBytes(32).toString('base64url'), tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = now() + (purpose === 'VERIFY_EMAIL' ? 24 * 60 * 60000 : 30 * 60000);
      await tx.authToken.upsert({ where: { userId_purpose: { userId, purpose } }, create: { idHash: tokenHash, userId, purpose, expiresAt: new Date(expiresAt) }, update: { idHash: tokenHash, expiresAt: new Date(expiresAt), usedAt: null } });
      const message = renderAuthEmail(purpose, recipient, authActionUrl(config, purpose, token), theme, config.mode === 'preview');
      await tx.authEmail.deleteMany({ where: { userId, subject: message.subject } });
      await tx.authEmail.create({ data: { userId, recipient, subject: message.subject,
        body: encode({ version: 1, mode: config.mode, status: config.mode === 'preview' ? 'PREVIEW' : 'PENDING', attempts: 0,
          purpose, tokenHash, expiresAt, nextAttemptAt: now(), payload: protect(message, config) }) } });
    },
    theme: () => appearance.read(),
    async deliver(id: string): Promise<Status | 'SKIPPED'> {
      const row = await prisma.authEmail.findUnique({ where: { id } });
      if (!row) return 'SKIPPED';
      const current = decode(row.body);
      if (!current || current.mode !== config.mode || current.mode === 'preview' || ['SENT', 'CANCELLED'].includes(current.status)
        || current.nextAttemptAt > now() || current.status === 'SENDING' && (current.leaseUntil ?? 0) > now()) return 'SKIPPED';
      if (current.attempts >= 5) {
        if (current.status !== 'SENDING') return 'SKIPPED';
        await prisma.authEmail.updateMany({ where: { id, body: row.body }, data: { body: encode({ ...current, status: 'FAILED', failure: 'DELIVERY_FAILED', lease: undefined, leaseUntil: undefined }) } });
        return 'FAILED';
      }
      const token = await prisma.authToken.findUnique({ where: { idHash: current.tokenHash } });
      if (!token || token.usedAt || token.expiresAt.getTime() <= now() || token.purpose !== current.purpose || token.userId !== row.userId) {
        await prisma.authEmail.updateMany({ where: { id, body: row.body }, data: { body: encode({ ...current, status: 'CANCELLED', payload: undefined }) } });
        return 'CANCELLED';
      }
      const claimed: Envelope = { ...current, status: 'SENDING', attempts: current.attempts + 1, lease: randomUUID(), leaseUntil: now() + 60000 };
      const claimBody = encode(claimed);
      const claim = await prisma.authEmail.updateMany({ where: { id, body: row.body }, data: { body: claimBody } });
      if (!claim.count) return 'SKIPPED';
      try {
        await transport.send(reveal(claimed.payload!, config), row.id);
      } catch {
        await prisma.authEmail.updateMany({ where: { id, body: claimBody }, data: { body: encode({ ...claimed, status: 'FAILED', failure: 'DELIVERY_FAILED', lease: undefined, leaseUntil: undefined, nextAttemptAt: now() + 30000 * 2 ** (claimed.attempts - 1) }) } });
        return 'FAILED';
      }
      await prisma.authEmail.updateMany({ where: { id, body: claimBody }, data: { body: encode({ ...claimed, status: 'SENT', sentAt: now(), failure: undefined, payload: undefined, lease: undefined, leaseUntil: undefined }) } });
      return 'SENT'; // SMTP acceptance, not an inbox-delivery guarantee.
    },
    async pending(limit = 50) {
      // Page through terminal/preview records so an old completed page never
      // prevents newer pending messages from being dispatched. Memory is bounded.
      const ids: string[] = [];
      let after: string | undefined;
      while (ids.length < limit) {
        const rows = await prisma.authEmail.findMany({ where: after ? { id: { gt: after } } : {}, orderBy: { id: 'asc' }, take: 100 });
        if (!rows.length) break;
        for (const row of rows) {
          const item = decode(row.body);
          if (item?.mode === config.mode && ['PENDING', 'FAILED', 'SENDING'].includes(item.status) && (item.attempts < 5 || item.status === 'SENDING') && item.nextAttemptAt <= now()
            && (item.status !== 'SENDING' || (item.leaseUntil ?? 0) <= now())) ids.push(row.id);
          if (ids.length >= limit) break;
        }
        after = rows.at(-1)!.id;
      }
      return ids;
    },
  };
}
