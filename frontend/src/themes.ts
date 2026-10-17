export const themes = [
  { id: 'classic', name: 'Classic', label: '01 / ORIGINAL', description: 'A loja original, com a navegação, o catálogo e o carrinho de sempre.' },
  { id: 'minimal', name: 'Minimal', label: '02 / CURATED', description: 'Uma seleção editorial. Imagens amplas, espaço para descobrir e carrinho lateral.' },
  { id: 'marketplace', name: 'Marketplace', label: '03 / EXPLORE', description: 'Pesquisa em destaque, filtros por categoria e um catálogo prático e compacto.' },
  { id: 'dark', name: 'Dark', label: '04 / AFTER HOURS', description: 'Contraste profundo, categorias visuais e uma seleção com presença.' },
] as const;
export type ThemeId = typeof themes[number]['id'];
export const defaultTheme: ThemeId = 'classic';
export const isThemeId = (value: unknown): value is ThemeId => themes.some((theme) => theme.id === value);

type Api = <T>(url: string, init?: RequestInit) => Promise<T>;
type ThemeState = { applied: ThemeId; preview: ThemeId | null; saving: boolean; error: string | null };

export function createThemeStore(api: Api) {
  let state: ThemeState = { applied: defaultTheme, preview: null, saving: false, error: null };
  let revision = 0;
  const listeners = new Set<() => void>();
  const set = (update: Partial<ThemeState>) => { state = { ...state, ...update }; listeners.forEach((listener) => listener()); };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    preview(theme: ThemeId) { if (!state.saving && isThemeId(theme)) set({ preview: theme, error: null }); },
    cancelPreview() { if (!state.saving) set({ preview: null, error: null }); },
    async refresh() {
      if (state.saving) return;
      const request = ++revision;
      try {
        const result = await api<{ theme: unknown }>('/api/appearance');
        if (!isThemeId(result.theme)) throw new Error('Tema do site inválido.');
        if (request === revision) set({ applied: result.theme, error: null });
      } catch {
        if (request === revision) set({ error: 'Não foi possível carregar o tema do site. Tente novamente.' });
      }
    },
    async apply(theme: ThemeId) {
      if (state.saving || !isThemeId(theme)) return;
      ++revision; // Discard any earlier read that could overwrite this confirmed selection.
      set({ saving: true, error: null });
      try {
        const result = await api<{ theme: unknown }>('/api/admin/appearance', { method: 'PUT', body: JSON.stringify({ theme }) });
        if (!isThemeId(result.theme)) throw new Error('Tema do site inválido.');
        set({ applied: result.theme, preview: null, saving: false });
      } catch {
        set({ saving: false, error: 'Não foi possível confirmar a alteração. Recarregue para verificar o tema guardado.' });
      }
    },
  };
}
