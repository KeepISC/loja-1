export const demoNotice = 'Modo demo — dados fictícios. Compras, pagamentos e entrega de contactos estão desativados.';

const catalog = [
  { id: 'demo-tech', slug: 'tecnologia-demo', name: 'Tecnologia (demo)', description: 'Categoria fictícia de tecnologia para explorar a demonstração.', priceCents: 1200 },
  { id: 'demo-fashion', slug: 'moda-demo', name: 'Moda (demo)', description: 'Categoria fictícia de moda, sem fornecedores ou contactos reais.', priceCents: 980 },
  { id: 'demo-sport', slug: 'desporto-demo', name: 'Desporto (demo)', description: 'Categoria fictícia de desporto. Os valores são apenas ilustrativos.', priceCents: 1100 },
];

// Strict read-only allowlist: never fetch a backend, generate orders, or load private data.
export async function demoApiFetch<T>(input: string, init: RequestInit = {}, base = '/'): Promise<T> {
  if ((init.method ?? 'GET').toUpperCase() !== 'GET') throw new Error(demoNotice);
  const items = catalog.map((item) => ({ ...item, active: true, imageUrl: `${base}images/demo-category.svg`, supplierContactsCount: 0 }));
  let result: unknown;
  if (input === '/api/auth/me') {
    result = { role: 'GUEST', displayName: 'Visitante (demo)', email: 'demo@example.test', mode: 'demo', mockAccountSwitchingEnabled: false };
  } else if (input === '/api/appearance') {
    result = { theme: 'classic' };
  } else if (input === '/api/categories') {
    result = { items };
  } else {
    const item = items.find((item) => input === `/api/categories/${item.slug}`);
    if (!item) throw new Error(demoNotice);
    result = { item, supplierContactsCount: 0 };
  }
  return result as T;
}
