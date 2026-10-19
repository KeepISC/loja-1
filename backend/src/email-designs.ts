import type { ThemeId } from './appearance.js';

// Only renderer-created, already escaped content is passed to these layouts.
export type EmailDocument = { title: string; intro: string; content: string; url?: string;
  actionLabel?: string; actionNote?: string; footerNotice?: string; closingNote?: string };
type Design = {
  canvas: string; surface: string; muted: string; ink: string; secondary: string;
  accent: string; actionInk: string; line: string; headingFont: string;
};
const sans = 'Arial,Helvetica,sans-serif';
const designs: Record<Exclude<ThemeId, 'classic'>, Design> = {
  minimal: {
    canvas: '#f9f8f4', surface: '#ffffff', muted: '#f1f0ea', ink: '#242722', secondary: '#595e52',
    accent: '#304231', actionInk: '#ffffff', line: '#dcdcd3', headingFont: 'Georgia,Times,serif',
  },
  marketplace: {
    canvas: '#f3f6fa', surface: '#ffffff', muted: '#e8eff7', ink: '#14253d', secondary: '#4d5e77',
    accent: '#164ca5', actionInk: '#ffffff', line: '#d4deea', headingFont: sans,
  },
  dark: {
    canvas: '#0e1110', surface: '#181d1a', muted: '#222a25', ink: '#f3f7ee', secondary: '#a6baaa',
    accent: '#cbf273', actionInk: '#141d10', line: '#3e4e41', headingFont: `'Arial Black',Arial,Helvetica,sans-serif`,
  },
};

// Adapt only trusted style attributes, never text, URLs or escaped dynamic values.
// The receipt and supplier fields remain shared with Classic's content renderer.
function contentForDesign(content: string, design: Design, theme: ThemeId) {
  const colors: Record<string, string> = {
    '#f3f6fb': design.muted, '#ffffff': design.surface, '#f8fafc': design.muted,
    '#182331': design.ink, '#394558': design.secondary, '#526074': design.secondary,
    '#254fb5': design.accent, '#dce3ee': design.line, '#e4e9f2': design.line,
  };
  return content.replace(/style="([^"]*)"/g, (_attribute, css: string) => {
    let styled = css.replace(/#[\da-f]{6}/gi, (color) => colors[color.toLowerCase()] ?? color);
    styled = styled.replaceAll(`font-family:${sans}`, `font-family:${design.headingFont}`);
    if (theme === 'minimal') styled = styled.replaceAll('padding:16px;', 'padding:24px 16px;');
    if (theme === 'dark') styled = styled.replaceAll('border:1px solid', 'border-left:3px solid');
    return `style="${styled}"`;
  });
}

function button(url: string | undefined, design: Design, theme: ThemeId, escape: (value: string) => string, document?: EmailDocument) {
  if (!url) return '';
  const minimal = theme === 'minimal';
  const background = minimal ? design.surface : design.accent;
  const ink = minimal ? design.accent : design.actionInk;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 12px;border-collapse:collapse;"><tr><td bgcolor="${background}" style="background-color:${background};border:1px solid ${design.accent};text-align:center;padding:16px 24px;"><a href="${escape(url)}" style="font-family:${sans};color:${ink};font-size:15px;font-weight:bold;text-decoration:none;display:inline-block;">${escape(document?.actionLabel ?? 'Ver pedido')}</a></td></tr></table><p style="font-size:13px;color:${design.secondary};margin:8px 0 0;line-height:20px;">${escape(document?.actionNote ?? 'O acesso ao pedido continua a exigir a sessão autorizada.')}</p>`;
}

function footer(design: Design, theme: ThemeId, document: EmailDocument, escape: (value: string) => string) {
  return `<tr><td bgcolor="${design.canvas}" style="padding:${theme === 'minimal' ? '28px 20px' : '20px'};border-top:1px solid ${design.line};background-color:${design.canvas};color:${design.secondary};font-family:${sans};font-size:12px;line-height:19px;${theme === 'minimal' ? 'text-align:center;' : ''}"><strong>Supplier Market</strong><br>${escape(document.footerNotice ?? 'Email transacional do ambiente local de demonstração. Nenhuma mensagem externa foi enviada.')}<br>${escape(document.actionNote ?? 'Os contactos adquiridos são privados; não partilhe esta mensagem.')}</td></tr>`;
}

export function themedEmailLayout(theme: Exclude<ThemeId, 'classic'>, document: EmailDocument, escape: (value: string) => string) {
  const design = designs[theme];
  const { title, intro, content, url } = document;
  const heading = (size: number) => `<h1 style="margin:0 0 16px;color:${design.ink};font-family:${design.headingFont};font-size:${size}px;line-height:${size + 8}px;font-weight:${theme === 'minimal' ? 'normal' : 'bold'};">${escape(title)}</h1>`;
  const introduction = `<p style="margin:0 0 24px;color:${design.secondary};font-family:${sans};font-size:16px;line-height:25px;">${escape(intro)}</p>`;
  const body = contentForDesign(content, design, theme) + button(url, design, theme, escape, document)
    + `<p style="margin:28px 0 0;color:${design.secondary};font-size:14px;line-height:22px;">${escape(document.closingNote ?? 'Pode consultar os seus pedidos na aplicação local. Guarde esta mensagem para referência.')}</p>`;
  let rows: string;
  if (theme === 'minimal') {
    rows = `<tr><td align="center" style="padding:40px 20px 32px;border-bottom:1px solid ${design.line};"><p style="margin:0;color:${design.accent};font-family:Georgia,Times,serif;font-size:30px;line-height:38px;">Supplier Market</p><p style="margin:10px 0 0;color:${design.secondary};font-size:10px;line-height:18px;letter-spacing:2px;">DIGITAL SUPPLIER MARKETPLACE</p></td></tr>
<tr><td style="padding:36px 20px 8px;">${heading(32)}${introduction}</td></tr>
<tr><td bgcolor="${design.surface}" style="padding:24px 20px 32px;background-color:${design.surface};border-top:1px solid ${design.line};font-size:15px;line-height:25px;">${body}</td></tr>`;
  } else if (theme === 'marketplace') {
    rows = `<tr><td bgcolor="${design.ink}" style="padding:22px 20px;background-color:${design.ink};color:#ffffff;"><p style="margin:0;color:#ffffff;font-family:${sans};font-size:24px;line-height:32px;font-weight:bold;">Supplier Market</p></td></tr>
<tr><td bgcolor="${design.accent}" style="padding:10px 20px;background-color:${design.accent};color:#ffffff;font-size:10px;line-height:18px;letter-spacing:1px;">DIGITAL SUPPLIER MARKETPLACE</td></tr>
<tr><td style="padding:24px 16px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${design.muted}" style="width:100%;background-color:${design.muted};border-left:4px solid ${design.accent};border-collapse:collapse;"><tr><td style="padding:20px 16px;">${heading(25)}${introduction}</td></tr></table></td></tr>
<tr><td style="padding:8px 16px 28px;font-size:14px;line-height:23px;">${body}</td></tr>`;
  } else {
    rows = `<tr><td style="padding:28px 20px;border-bottom:1px solid ${design.line};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;"><tr><td width="58" bgcolor="${design.accent}" align="center" style="width:58px;padding:14px 0;background-color:${design.accent};color:${design.actionInk};font-family:Courier New,Courier,monospace;font-size:17px;font-weight:bold;">S/M</td><td style="padding-left:16px;color:${design.ink};"><p style="margin:0;font-family:${sans};font-size:21px;line-height:28px;font-weight:bold;">Supplier Market</p><p style="margin:6px 0 0;color:${design.secondary};font-size:9px;line-height:16px;letter-spacing:1px;">DIGITAL SUPPLIER MARKETPLACE</p></td></tr></table></td></tr>
<tr><td style="padding:32px 20px 4px;border-top:3px solid ${design.accent};">${heading(34)}${introduction}</td></tr>
<tr><td bgcolor="${design.surface}" style="padding:20px 16px 32px;background-color:${design.surface};font-size:15px;line-height:25px;">${body}</td></tr>`;
  }
  return `<!doctype html>
<html lang="pt-PT"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background-color:${design.canvas};color:${design.ink};font-family:${sans};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escape(intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${design.canvas}" style="width:100%;background-color:${design.canvas};border-collapse:collapse;"><tr><td align="center" style="padding:24px 8px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${design.surface}" style="width:100%;max-width:600px;background-color:${design.surface};color:${design.ink};font-family:${sans};border:1px solid ${design.line};border-collapse:collapse;word-wrap:break-word;overflow-wrap:anywhere;">
${rows}${footer(design, theme, document, escape)}</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}
