import { renderEmailDocument, type EmailMessage } from './email-templates.js';
import type { EmailDocument } from './email-designs.js';
import { themeIds, type ThemeId } from './appearance.js';

const prefix = 'SUPPLIER_MARKET_EMAIL_V1\n';

// Store both representations in the same transaction/record; no second delivery or schema migration.
export const encodeEmailContent = (message: EmailMessage) => prefix + JSON.stringify({ text: message.text, html: message.html, document: message.document });

export function decodeEmailContent(value: string): { body: string; html?: string } {
  if (!value.startsWith(prefix)) return { body: value }; // Preserve historical plain-text deliveries.
  try {
    const message = JSON.parse(value.slice(prefix.length));
    if (typeof message.text === 'string' && typeof message.html === 'string') return { body: message.text, html: message.html };
  } catch { /* A corrupt representation must not be interpreted as HTML. */ }
  return { body: 'O conteúdo deste email não está disponível.' };
}

// Recognize only the former renderer's exact Classic structure. This preserves
// historical field values rather than fetching today's potentially edited contacts.
function classicDocument(html: string): EmailDocument | undefined {
  if (!html.startsWith('<!doctype html>') || !html.includes('DIGITAL SUPPLIER MARKETPLACE')) return;
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  const intro = html.match(/<div style="display:none;[^"]*">([^<]*)<\/div>/)?.[1];
  if (!title || !intro) return;
  const marker = `<p style="margin:0 0 24px;color:#394558;font-size:16px;line-height:25px;">${intro}</p>\n`;
  const start = html.indexOf(marker);
  const end = html.indexOf('\n<p style="margin:24px 0 0;color:#526074;', start + marker.length);
  if (start < 0 || end < 0) return;
  let content = html.slice(start + marker.length, end);
  const action = content.lastIndexOf('<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 12px;">');
  const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity]!));
  let url: string | undefined;
  if (action >= 0) {
    url = decode(content.slice(action).match(/href="([^"]*)"/)?.[1] ?? '');
    content = content.slice(0, action);
  }
  return { title: decode(title), intro: decode(intro), content, url };
}

export function previewEmailContent(value: string, theme: ThemeId): { body: string; html?: string } {
  if (!themeIds.includes(theme)) throw new Error('Invalid email theme.');
  const decoded = decodeEmailContent(value);
  if (!decoded.html) return decoded;
  let document: EmailDocument | undefined;
  try {
    const stored = value.startsWith(prefix) ? JSON.parse(value.slice(prefix.length)).document : undefined;
    if (stored && typeof stored.title === 'string' && typeof stored.intro === 'string' && typeof stored.content === 'string'
      && (stored.url === undefined || typeof stored.url === 'string')) document = stored;
  } catch { /* Unrecognized historical messages keep their original representation. */ }
  document ??= classicDocument(decoded.html);
  return document ? { body: decoded.body, html: renderEmailDocument(document, theme) } : decoded;
}
