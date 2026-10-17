import { useEffect, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { apiFetch } from './api';
import type { AuthState } from './stores';
import { createThemeStore, isThemeId, themes, type ThemeId } from './themes';

export const themeStore = createThemeStore(apiFetch);
const useTheme = () => useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getSnapshot);

export function localPreviewTheme(location?: Pick<Location, 'hostname' | 'search'>): ThemeId | null {
  if (!location || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
  const candidate = new URLSearchParams(location.search).get('theme');
  return isThemeId(candidate) ? candidate : null;
}

const subscribeLocalPreview = (listener: () => void) => {
  window.addEventListener('storefront-preview', listener);
  window.addEventListener('popstate', listener);
  return () => { window.removeEventListener('storefront-preview', listener); window.removeEventListener('popstate', listener); };
};
// Retain the local preview when BrowserRouter navigation replaces the query string.
// Nothing is persisted to storage, sent to the API, or enabled on the public host.
let localSelection: ThemeId | null | undefined;
const localSnapshot = () => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return null;
  if (localSelection === undefined) localSelection = localPreviewTheme(window.location);
  return localSelection;
};
const useLocalPreview = () => useSyncExternalStore(subscribeLocalPreview, localSnapshot, () => null);

export function selectLocalPreview(theme: ThemeId | null) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) || (theme !== null && !isThemeId(theme))) return;
  localSelection = theme;
  const url = new URL(window.location.href);
  if (theme) url.searchParams.set('theme', theme); else url.searchParams.delete('theme');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event('storefront-preview'));
}

export function useActiveTheme(auth: AuthState | null, demo: boolean): ThemeId {
  const state = useTheme();
  const local = useLocalPreview();
  return local ?? (!demo && auth?.role === 'ADMIN' && state.preview ? state.preview : state.applied);
}

export function ThemeController({ auth, demo }: { auth: AuthState | null; demo: boolean }) {
  const state = useTheme();
  const active = useActiveTheme(auth, demo);
  const administrator = !demo && auth?.role === 'ADMIN';
  const location = useLocation();
  const local = useLocalPreview();
  useEffect(() => {
    if (local && new URLSearchParams(window.location.search).get('theme') !== local) selectLocalPreview(local);
  }, [local, location]);
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
    document.documentElement.dataset.theme = active;
  }, [active]);
  if (local) return <aside className="theme-preview-notice" aria-label="Prévia local de temas">
    <p>Prévia local · {themes.find((theme) => theme.id === local)?.name}. A escolha pública não é alterada.</p>
    <nav className="flex flex-wrap gap-2" aria-label="Temas locais">{[...themes, { id: null, name: 'Terminar prévia' }].map((theme) => <button type="button" className="theme-button theme-button-secondary" key={theme.id ?? 'end'} aria-pressed={local === theme.id} onClick={() => selectLocalPreview(theme.id)}>{theme.name}</button>)}</nav>
  </aside>;
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
      <div><p className="theme-eyebrow">STOREFRONT THEME</p><h2 id="appearance-title" className="text-2xl font-bold">Aparência / Temas</h2></div>
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
