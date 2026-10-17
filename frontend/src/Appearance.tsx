import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from './api';
import type { AuthState } from './stores';
import { createThemeStore, themes } from './themes';

export const themeStore = createThemeStore(apiFetch);
const useTheme = () => useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getSnapshot);

export function ThemeController({ auth, demo }: { auth: AuthState | null; demo: boolean }) {
  const state = useTheme();
  const administrator = !demo && auth?.role === 'ADMIN';
  useEffect(() => {
    void themeStore.refresh();
    if (demo) return;
    const refresh = () => { void themeStore.refresh(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [demo]);
  useEffect(() => { if (!administrator) themeStore.cancelPreview(); }, [administrator]);
  useEffect(() => {
    document.documentElement.dataset.theme = administrator && state.preview ? state.preview : state.applied;
  }, [administrator, state.preview, state.applied]);
  if (!administrator || !state.preview) return null;
  return <aside className="theme-preview-notice" role="status" aria-live="polite">
    <p><strong>Pré-visualização:</strong> {themes.find((theme) => theme.id === state.preview)?.name}. Só é visível nesta sessão.</p>
    <div className="flex flex-wrap gap-2">
      <button className="theme-button" disabled={state.saving} onClick={() => void themeStore.apply(state.preview!)}>Aplicar tema</button>
      <button className="theme-button theme-button-secondary" disabled={state.saving} onClick={() => themeStore.cancelPreview()}>Cancelar pré-visualização</button>
    </div>
    {state.error && <p role="alert">{state.error}</p>}
  </aside>;
}

export function AppearancePanel({ auth }: { auth: AuthState | null }) {
  const state = useTheme();
  if (auth?.role !== 'ADMIN' || !auth.mockAccountSwitchingEnabled) return null;
  return <section className="appearance-panel" aria-labelledby="appearance-title" aria-busy={state.saving}>
    <div className="appearance-heading">
      <div><p className="theme-eyebrow">A SUA MONTRA</p><h2 id="appearance-title" className="text-2xl font-bold">Aparência / Temas</h2></div>
      <p className="text-sm text-ink-muted">Compare sem compromisso. Aplicar guarda a escolha para todos os visitantes.</p>
    </div>
    <div className="theme-grid">{themes.map((theme) => <article className="theme-choice" key={theme.id}>
      <div data-theme={theme.id} className="theme-preview" aria-hidden="true">
        <div className="theme-preview-nav"><span className="theme-preview-logo" />Supplier Market<span>● ● ●</span></div>
        <div className="theme-preview-hero"><span>{theme.label}</span><strong>Encontre a próxima<br />grande oportunidade.</strong><i>Explorar catálogo ↗</i></div>
        <div className="theme-preview-products">{['Tecnologia', 'Design', 'Lifestyle'].map((name) => <div key={name}><div className="theme-preview-image" /><strong>{name}</strong><span>Descobrir →</span></div>)}</div>
      </div>
      <div className="theme-choice-copy"><p className="theme-eyebrow">{theme.label}</p><h3 className="text-xl font-bold">{theme.name}</h3><p className="text-sm text-ink-muted">{theme.description}</p>
        <p className="theme-selection" aria-live="polite">{state.applied === theme.id ? '✓ Tema aplicado' : state.preview === theme.id ? 'Em pré-visualização' : 'Disponível para comparar'}</p>
        <div className="flex flex-wrap gap-2">
          <button className="theme-button theme-button-secondary" aria-label={'Pré-visualizar ' + theme.name} aria-pressed={state.preview === theme.id} disabled={state.saving} onClick={() => themeStore.preview(theme.id)}>Pré-visualizar</button>
          <button className="theme-button" aria-label={'Aplicar ' + theme.name} disabled={state.saving || (state.applied === theme.id && !state.preview)} onClick={() => void themeStore.apply(theme.id)}>Aplicar tema</button>
        </div>
      </div>
    </article>)}</div>
    {state.error && <p role="alert" className="mt-4 text-red-700">{state.error} <button className="underline" onClick={() => void themeStore.refresh()}>Recarregar</button></p>}
    <p className="mt-4 text-sm text-ink-muted" role="status">{state.saving ? 'A guardar a escolha…' : 'O tema aplicado fica guardado no servidor. A pré-visualização não altera a escolha pública.'}</p>
  </section>;
}
