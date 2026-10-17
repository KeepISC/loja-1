import type { EmailMessage } from './email-templates.js';

const prefix = 'SUPPLIER_MARKET_EMAIL_V1\n';

// Store both representations in the same transaction/record; no second delivery or schema migration.
export const encodeEmailContent = (message: EmailMessage) => prefix + JSON.stringify({ text: message.text, html: message.html });

export function decodeEmailContent(value: string): { body: string; html?: string } {
  if (!value.startsWith(prefix)) return { body: value }; // Preserve historical plain-text deliveries.
  try {
    const message = JSON.parse(value.slice(prefix.length));
    if (typeof message.text === 'string' && typeof message.html === 'string') return { body: message.text, html: message.html };
  } catch { /* A corrupt representation must not be interpreted as HTML. */ }
  return { body: 'O conteúdo deste email não está disponível.' };
}
