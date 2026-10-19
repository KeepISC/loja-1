import { themeIds, type ThemeId } from './appearance.js';
import { themedEmailLayout, type EmailDocument } from './email-designs.js';

export type EmailMessage = { subject: string; text: string; html: string; document?: EmailDocument };
export type EmailOrder = {
  id: string; orderNumber: string; customerEmail: string; totalCents: number; status: string;
  payment?: { status: string } | null;
  items: Array<{ categoryId: string; categoryName: string; priceCents: number; quantity: number }>;
};
type EmailContact = { supplierName: string; email: string; telephone?: string | null; whatsapp?: string | null; website?: string | null; notes?: string | null };
export type EmailCategory = { id: string; name: string; contacts: EmailContact[] };
type Options = { appUrl?: string; theme?: ThemeId };

export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const lines = (value: string) => escapeEmailHtml(value).replace(/\r?\n/g, '<br>');
const money = (cents: number) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const verified = (order: EmailOrder) => order.status === 'PAID' && order.payment?.status === 'PAID';
const subjectReference = (value: string) => value.replace(/[\r\n]+/g, ' ').slice(0, 180);

function httpsUrl(value?: string | null) {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : undefined;
  } catch { return undefined; }
}

function orderUrl(order: EmailOrder, options: Options) {
  const url = httpsUrl(options.appUrl);
  if (!url) return undefined;
  url.pathname = url.pathname.replace(/\/?$/, '/') + 'orders/' + encodeURIComponent(order.id);
  url.search = ''; url.hash = '';
  return url.href;
}

function action(url?: string) {
  return url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 12px;"><tr><td bgcolor="#254fb5" style="background-color:#254fb5;border-radius:6px;text-align:center;padding:14px 24px;"><a href="${escapeEmailHtml(url)}" style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Ver pedido</a></td></tr></table><p style="font-size:13px;color:#526074;margin:8px 0 0;line-height:20px;">O acesso ao pedido continua a exigir a sessão autorizada.</p>` : '';
}

export function renderEmailDocument(document: EmailDocument, theme: ThemeId = 'classic') {
  if (!themeIds.includes(theme)) throw new Error('Invalid email theme.');
  // Validate even stored/preview URLs; no arbitrary link can enter a presentation.
  const safe = { ...document, url: httpsUrl(document.url)?.href };
  return theme === 'classic' ? layout(safe.title, safe.intro, safe.content, safe.url) : themedEmailLayout(theme, safe, escapeEmailHtml);
}

function layout(title: string, intro: string, content: string, url?: string) {
  return `<!doctype html>
<html lang="pt-PT"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f3f6fb;color:#182331;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeEmailHtml(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f6fb" style="width:100%;background-color:#f3f6fb;border-collapse:collapse;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #dce3ee;border-collapse:collapse;">
<tr><td style="padding:24px;border-top:4px solid #254fb5;border-bottom:1px solid #e4e9f2;"><p style="margin:0;color:#254fb5;font-size:22px;line-height:28px;font-weight:bold;letter-spacing:-0.5px;">Supplier Market</p><p style="margin:5px 0 0;color:#526074;font-size:12px;line-height:18px;letter-spacing:1px;">DIGITAL SUPPLIER MARKETPLACE</p></td></tr>
<tr><td style="padding:28px 24px;font-size:16px;line-height:25px;word-wrap:break-word;overflow-wrap:anywhere;">
<h1 style="margin:0 0 14px;color:#182331;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:34px;font-weight:bold;">${escapeEmailHtml(title)}</h1>
<p style="margin:0 0 24px;color:#394558;font-size:16px;line-height:25px;">${escapeEmailHtml(intro)}</p>
${content}${action(url)}
<p style="margin:24px 0 0;color:#526074;font-size:14px;line-height:22px;">Pode consultar os seus pedidos na aplicação local. Guarde esta mensagem para referência.</p>
</td></tr>
<tr><td bgcolor="#f8fafc" style="padding:20px 24px;border-top:1px solid #e4e9f2;background-color:#f8fafc;color:#526074;font-size:12px;line-height:19px;"><strong>Supplier Market</strong><br>Email transacional do ambiente local de demonstração. Nenhuma mensagem externa foi enviada.<br>Os contactos adquiridos são privados; não partilhe esta mensagem.</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

function receipt(order: EmailOrder) {
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;"><tr><td style="padding:14px;background-color:#f3f6fb;border:1px solid #dce3ee;font-size:14px;line-height:22px;word-break:break-word;"><strong>Pedido:</strong> ${escapeEmailHtml(order.orderNumber)}<br><strong>Destinatário:</strong> ${escapeEmailHtml(order.customerEmail)}<br><strong>Pagamento:</strong> ${verified(order) ? 'Confirmado' : 'Não confirmado'}</td></tr></table>
<h2 style="font-size:18px;line-height:26px;color:#182331;margin:24px 0 10px;">Resumo da compra</h2>
<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:22px;"><thead><tr><th scope="col" align="left" style="padding:8px 0;color:#526074;border-bottom:1px solid #dce3ee;">Categoria</th><th scope="col" align="right" style="padding:8px 0;color:#526074;border-bottom:1px solid #dce3ee;">Valor</th></tr></thead><tbody>
${order.items.map((item) => `<tr><td style="padding:12px 8px 12px 0;word-break:break-word;border-bottom:1px solid #e4e9f2;">${escapeEmailHtml(item.categoryName)} × ${escapeEmailHtml(String(item.quantity))}</td><td align="right" style="padding:12px 0;border-bottom:1px solid #e4e9f2;white-space:nowrap;">${escapeEmailHtml(money(item.priceCents * item.quantity))}</td></tr>`).join('')}
<tr><th scope="row" align="left" style="padding:14px 0;color:#182331;">Total do pedido</th><td align="right" style="padding:14px 0;font-weight:bold;color:#182331;white-space:nowrap;">${escapeEmailHtml(money(order.totalCents))}</td></tr></tbody></table>`;
  const text = [`Pedido: ${order.orderNumber}`, `Destinatário: ${order.customerEmail}`, `Pagamento: ${verified(order) ? 'Confirmado' : 'Não confirmado'}`, '', 'Categorias compradas:', ...order.items.map((item) => `- ${item.categoryName} × ${item.quantity}: ${money(item.priceCents * item.quantity)}`), `Total do pedido: ${money(order.totalCents)}`].join('\n');
  return { html, text };
}

export function renderPurchaseConfirmationEmail(order: EmailOrder, options: Options = {}): EmailMessage {
  const paid = verified(order);
  const failed = ['FAILED', 'CANCELLED'].includes(order.status) || ['FAILED', 'CANCELLED'].includes(order.payment?.status ?? '');
  const title = paid ? 'Compra confirmada' : failed ? 'Pagamento não concluído' : 'Pedido recebido';
  const intro = paid ? 'O seu pagamento foi confirmado. Aqui está o resumo da sua compra.' : 'O pagamento não está confirmado. Os contactos só ficam disponíveis após confirmação do pagamento.';
  const summary = receipt(order);
  const url = orderUrl(order, options);
  const document = { title, intro, content: summary.html, url };
  return {
    subject: `${title} — ${subjectReference(order.orderNumber)}`,
    html: renderEmailDocument(document, options.theme),
    document,
    text: [title, intro, '', summary.text, url ? `\nVer pedido: ${url}` : '', '', 'Supplier Market — ambiente local de demonstração. Nenhuma mensagem externa foi enviada.'].filter(Boolean).join('\n'),
  };
}

export function renderSupplierDeliveryEmail(order: EmailOrder, categories: EmailCategory[], options: Options = {}): EmailMessage {
  // Check verified payment before inspecting any supplier fields, even outside the provider.
  if (!verified(order)) throw new Error('Contacts require a verified paid order and payment.');
  const purchased = new Set(order.items.map((item) => item.categoryId));
  const selected = categories.filter((category) => purchased.has(category.id));
  const summary = receipt(order);
  const contactText: string[] = [];
  const contactHtml = selected.map((category) => {
    contactText.push(`Categoria: ${category.name}`);
    const cards = category.contacts.map((contact) => {
      const fields = [['Email', contact.email], ['Telefone', contact.telephone], ['WhatsApp', contact.whatsapp], ['Website', contact.website], ['Notas', contact.notes]];
      contactText.push(`- ${contact.supplierName}`, ...fields.map(([label, value]) => `  ${label}: ${value || 'Não indicado'}`));
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:12px 0 20px;"><tr><td style="padding:16px;border:1px solid #dce3ee;background-color:#f8fafc;">
<h3 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;color:#182331;font-size:17px;line-height:25px;word-break:break-word;">${escapeEmailHtml(contact.supplierName)}</h3>
<table width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;line-height:22px;">${fields.map(([label, value]) => {
        const href = label === 'Website' ? httpsUrl(value)?.href : undefined;
        const display = lines(value || 'Não indicado');
        return `<tr><th scope="row" align="left" valign="top" style="width:28%;padding:5px 10px 5px 0;color:#526074;font-weight:normal;">${escapeEmailHtml(label!)}</th><td valign="top" style="padding:5px 0;color:#182331;word-break:break-word;overflow-wrap:anywhere;">${href ? `<a href="${escapeEmailHtml(href)}" style="color:#254fb5;text-decoration:underline;">${display}</a>` : display}</td></tr>`;
      }).join('')}</table></td></tr></table>`;
    }).join('');
    if (!category.contacts.length) contactText.push('Não existem contactos disponíveis nesta categoria.');
    return `<h2 style="margin:28px 0 12px;font-size:20px;line-height:28px;color:#182331;word-break:break-word;">${escapeEmailHtml(category.name)}</h2>${cards || '<p style="font-size:14px;line-height:22px;color:#526074;">Não existem contactos disponíveis nesta categoria.</p>'}`;
  }).join('');
  const title = 'Os seus contactos estão prontos';
  const intro = 'Compra confirmada. Consulte abaixo os contactos das categorias que adquiriu.';
  const url = orderUrl(order, options);
  const document = { title, intro, content: summary.html + '<h2 style="margin:28px 0 0;color:#182331;font-size:22px;line-height:30px;">Contactos dos fornecedores</h2>' + contactHtml, url };
  return {
    subject: `Entrega de contactos do pedido ${subjectReference(order.orderNumber)}`,
    html: renderEmailDocument(document, options.theme),
    document,
    text: [title, intro, '', summary.text, '', 'Contactos dos fornecedores:', ...contactText, url ? `\nVer pedido: ${url}` : '', '', 'Supplier Market — ambiente local de demonstração. Nenhuma mensagem externa foi enviada.', 'Os contactos adquiridos são privados; não partilhe esta mensagem.'].join('\n'),
  };
}
