import { useEffect, useState } from 'react';
import { apiFetch } from './api';
import { useActiveTheme } from './Appearance';
import { isDemo } from './deployment';
import { EmailHtmlPreview } from './MarketplacePages';
import type { AuthState } from './stores';
import { themes, type ThemeId } from './themes';

export const emailTypes = [
  { id: 'purchase-confirmation', label: 'Confirmação de compra' },
  { id: 'supplier-delivery', label: 'Entrega de contactos' },
  { id: 'payment-pending', label: 'Pagamento pendente' },
  { id: 'payment-failed', label: 'Pagamento não concluído' },
] as const;
type EmailType = typeof emailTypes[number]['id'];
type Preview = { theme: ThemeId; delivery: { subject: string; recipient: string; body: string; html: string } };

export function emailPreviewUrl(theme: ThemeId, type: EmailType) {
  return `/api/admin/email-preview?${new URLSearchParams({ theme, type })}`;
}

export function EmailThemePreview({ auth }: { auth: AuthState | null }) {
  const theme = useActiveTheme(auth, isDemo);
  const [type, setType] = useState<EmailType>('purchase-confirmation');
  const [plainText, setPlainText] = useState(false);
  const [result, setResult] = useState<{ key: string; preview?: Preview; error?: string } | null>(null);
  const allowed = !isDemo && auth?.role === 'ADMIN' && auth.mockAccountSwitchingEnabled === true;
  const key = `${theme}|${type}`;
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    apiFetch<Preview>(emailPreviewUrl(theme, type), { signal: controller.signal })
      .then((preview) => {
        if (!controller.signal.aborted && preview.theme === theme) setResult({ key, preview });
      })
      .catch(() => { if (!controller.signal.aborted) setResult({ key, error: 'Não foi possível carregar a prévia do email.' }); });
    return () => controller.abort();
  }, [allowed, key, theme, type]);
  if (!allowed) return null;
  const current = result?.key === key ? result : null;
  return <section className="appearance-panel v3-space-y-4" aria-labelledby="email-theme-title">
    <div className="appearance-heading">
      <div><p className="theme-eyebrow">EMAILS / PRÉ-VISUALIZAÇÃO</p><h2 id="email-theme-title" className="text-2xl font-bold">O mesmo tema, também no email.</h2></div>
      <p className="text-sm text-ink-muted">Tema: <strong>{themes.find((item) => item.id === theme)?.name}</strong>. Acompanha o tema da loja ou a sua pré-visualização.</p>
    </div>
    <p className="text-sm text-ink-muted">Dados inteiramente fictícios. Esta prévia não envia emails nem altera a configuração.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Tipo de email<select className="ml-2 rounded border border-line-strong px-3 py-2" value={type} onChange={(event) => setType(event.target.value as EmailType)}>{emailTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <button type="button" className="theme-button theme-button-secondary" aria-pressed={plainText} onClick={() => setPlainText(!plainText)}>{plainText ? 'Ver versão HTML' : 'Ver texto simples'}</button>
    </div>
    {!current && <p role="status">A preparar prévia do email…</p>}
    {current?.error && <p role="alert">{current.error}</p>}
    {current?.preview && <><p className="text-sm">{current.preview.delivery.subject} · {current.preview.delivery.recipient}</p>{plainText ? <pre className="whitespace-pre-wrap break-words text-sm">{current.preview.delivery.body}</pre> : <EmailHtmlPreview html={current.preview.delivery.html} />}</>}
  </section>;
}
