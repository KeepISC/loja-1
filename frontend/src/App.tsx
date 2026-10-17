import { useEffect, useState, useSyncExternalStore } from 'react';
import { authStore, cartStore, type AuthState, type Role } from './stores';
import { createCheckout } from './checkout';
import { apiFetch } from './api';
import type { Order } from './orders';
import { CategoryManagement, EmailOutboxPage, OrdersPage, OrderDetailsPage } from './MarketplacePages';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';

type Category = {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type CategoryDetails = {
  item: Category & { supplierContactsCount: number };
  supplierContactsCount: number;
};

type AdminDashboard = {
  totalCategories: number;
  activeCategories: number;
  totalOrders: number;
  paidOrders: number;
  totalRevenueCents: number;
};

type EmailOutboxItem = {
  id: string;
  orderId: string;
  status: string;
  recipient: string;
  subject: string;
  createdAt: string;
  order?: { orderNumber: string };
};

const currency = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
});

const formatMoney = (cents: number) => currency.format(cents / 100);

let authRequest: Promise<void> | undefined;
function useAuth() {
  const auth = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
  useEffect(() => {
    authRequest ??= apiFetch<AuthState>('/api/auth/me')
      .then((data) => { authStore.set(data); })
      .catch(() => { authStore.set({ role: 'GUEST', displayName: 'Mock Guest', email: 'guest@local.test' }); });
  }, []);
  return { auth, setAuth: authStore.set };
}

function useCart() {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, cartStore.getSnapshot);
  return { cart, setCart: cartStore.set };
}

let checkoutStorage: Storage | undefined;
try { checkoutStorage = window.sessionStorage; } catch { /* In-memory retry remains available. */ }
const checkout = createCheckout(apiFetch, checkoutStorage);

function Header() {
  const { auth } = useAuth();
  const { cart } = useCart();

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-lg font-bold text-slate-900">Supplier Market</Link>
          <nav className="flex flex-wrap gap-3 text-sm text-slate-600">
            <Link to="/">Catálogo</Link>
            <Link to="/cart">Carrinho</Link>
            <Link to="/orders">Meus pedidos</Link>
            <Link to="/admin">Admin</Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {auth ? (
            <>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {auth.displayName} · {auth.role}
              </span>
              <Link to="/cart" className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white">
                Carrinho ({cart.length})
              </Link>
            </>
          ) : (
            <span className="text-sm text-slate-500">Carregando...</span>
          )}
        </div>
      </div>
    </header>
  );
}

function HomePage() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<{ items: Category[] }>('/api/categories')
      .then((data) => {
        if (active) setItems(data.items);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 rounded-2xl bg-gradient-to-r from-brand-500 to-brand-700 p-8 text-white shadow-lg">
        <p className="text-sm uppercase tracking-[0.2em] opacity-80">Marketplace local</p>
        <h1 className="mt-3 text-3xl font-bold">Contactos de fornecedores privados</h1>
        <p className="mt-3 max-w-xl text-sm text-brand-50">
          Explore categorias, encontre contactos selecionados e finalize uma compra local simulada.
        </p>
      </div>

      {loading ? (
        <p>Carregando categorias...</p>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((category) => (
            <article key={category.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <img src={category.imageUrl} alt={category.name} className="h-40 w-full object-cover" />
              <div className="p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold text-slate-900">{category.name}</h2>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                    {formatMoney(category.priceCents)}
                  </span>
                </div>
                <p className="mb-4 line-clamp-3 text-sm text-slate-600">{category.description}</p>
                <div className="flex items-center justify-between gap-3">
                  <Link to={`/categories/${category.slug}`} className="font-medium text-brand-600 hover:text-brand-700">
                    Ver detalhes
                  </Link>
                  <AddToCartButton category={category} />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function AddToCartButton({ category }: { category: Category }) {
  const { cart, setCart } = useCart();

  const add = () => {
    setCart((current) => [...current, { categoryId: category.id, name: category.name, priceCents: category.priceCents }]);
  };

  return (
    <button onClick={add} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white">
      Adicionar
    </button>
  );
}

function CategoryPage() {
  const { slug } = useParams();
  const [data, setData] = useState<CategoryDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let active = true;

    apiFetch<CategoryDetails>(`/api/categories/${slug}`)
      .then((payload) => {
        if (active) setData(payload);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) return <PageShell><p>Carregando categoria...</p></PageShell>;
  if (error) return <PageShell><div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div></PageShell>;
  if (!data) return <PageShell><p>Categoria não encontrada.</p></PageShell>;

  const category = data.item;

  return (
    <PageShell>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <img src={category.imageUrl} alt={category.name} className="h-64 w-full object-cover" />
          <div className="p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{category.name}</h1>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
                {formatMoney(category.priceCents)}
              </span>
            </div>
            <p className="text-slate-600">{category.description}</p>
            <div className="mt-6 flex gap-3">
              <AddToCartButton category={category} />
              <Link to="/" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700">
                Voltar ao catálogo
              </Link>
            </div>
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">Resumo</h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600">
            <li>Preço: {formatMoney(category.priceCents)}</li>
            <li>Fornecedores públicos: {data.supplierContactsCount}</li>
            <li>Estado: {category.active ? 'Ativa' : 'Inativa'}</li>
          </ul>
        </aside>
      </div>
    </PageShell>
  );
}

function CartPage() {
  const { cart, setCart } = useCart();
  const total = cart.reduce((sum, item) => sum + item.priceCents, 0);
  const navigate = useNavigate();

  const remove = (categoryId: string) => {
    setCart((current) => current.filter((item) => item.categoryId !== categoryId));
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold text-slate-900">Carrinho</h1>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
                O carrinho está vazio. Explore o catálogo para encontrar fornecedores.
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.categoryId} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div>
                    <p className="font-medium text-slate-900">{item.name}</p>
                    <p className="text-sm text-slate-500">{formatMoney(item.priceCents)}</p>
                  </div>
                  <button onClick={() => remove(item.categoryId)} className="text-sm font-medium text-red-600">
                    Remover
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Resumo</h2>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>Subtotal</span>
              <span>{formatMoney(total)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-slate-600">
              <span>Taxa de processamento</span>
              <span>€0,00</span>
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4 text-lg font-semibold text-slate-900">
              <div className="flex items-center justify-between">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>
            <button
              onClick={() => navigate('/checkout')}
              disabled={cart.length === 0}
              className="mt-5 w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Finalizar compra
            </button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function CheckoutPage() {
  const { cart, setCart } = useCart();
  const [email, setEmail] = useState('guest@local.test');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const total = cart.reduce((sum, item) => sum + item.priceCents, 0);

  const submit = async () => {
    if (!cart.length) {
      setError('Adicione pelo menos um item ao carrinho.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const order = await checkout.complete(cart, email);
      setCart([]);
      navigate('/success?orderId=' + encodeURIComponent(order.id), { state: { order } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900">Checkout</h1>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="space-y-4 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Email de entrega
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none ring-0 focus:border-brand-500"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>

          {cart.map((item) => (
            <div key={item.categoryId} className="rounded-xl border border-slate-200 p-3">
              <p className="font-medium text-slate-900">{item.name}</p>
              <p className="text-sm text-slate-500">{formatMoney(item.priceCents)}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl bg-slate-50 p-4">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Total</span>
            <span className="text-lg font-semibold text-slate-900">{formatMoney(total)}</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={submit}
          disabled={submitting || cart.length === 0}
          className="mt-6 w-full rounded-lg bg-brand-500 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? 'Processando...' : 'Simular pagamento'}
        </button>
      </div>
    </PageShell>
  );
}

function AdminPage() {
  const { auth } = useAuth();
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [outbox, setOutbox] = useState<EmailOutboxItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth || auth.role !== 'ADMIN') return;

    Promise.all([
      apiFetch<AdminDashboard>('/api/admin/dashboard'),
      apiFetch<{ items: Order[] }>('/api/admin/orders').then((data) => data.items),
      apiFetch<{ items: EmailOutboxItem[] }>('/api/dev/email-outbox').then((data) => data.items),
    ])
      .then(([dashboardData, orderData, outboxData]) => {
        setDashboard(dashboardData);
        setOrders(orderData);
        setOutbox(outboxData);
      })
      .catch(() => {
        setDashboard(null);
      })
      .finally(() => setLoading(false));
  }, [auth]);

  if (!auth || auth.role !== 'ADMIN') {
    return (
      <PageShell>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">
          Acesso restrito. Faça login como administrador para ver o painel.
        </div>
      </PageShell>
    );
  }

  if (loading) return <PageShell><p>Carregando painel administrativo...</p></PageShell>;

  return (
    <PageShell>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-slate-900">Painel administrativo</h1>

        {dashboard && (
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Categorias" value={String(dashboard.totalCategories)} />
            <StatCard label="Ativas" value={String(dashboard.activeCategories)} />
            <StatCard label="Pedidos" value={String(dashboard.totalOrders)} />
            <StatCard label="Receita" value={formatMoney(dashboard.totalRevenueCents)} />
          </div>
        )}

        <CategoryManagement onChanged={() => { apiFetch<AdminDashboard>('/api/admin/dashboard').then(setDashboard).catch(() => setDashboard(null)); }} />

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Pedidos recentes</h2>
          <div className="mt-4 space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-slate-500">Ainda não existem pedidos.</p>
            ) : (
              orders.slice(0, 5).map((order) => (
                <div key={order.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                  <div>
                    <Link to={`/orders/${order.id}`} className="font-medium text-brand-500 underline">{order.orderNumber}</Link>
                    <p className="text-sm text-slate-500">{order.customerEmail}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-slate-900">{formatMoney(order.totalCents ?? 0)}</p>
                    <p className="text-xs uppercase text-slate-500">{order.status}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Outbox de emails</h2>
          <Link to="/dev/email-outbox" className="text-brand-500 underline">Ver emails de entrega</Link>
          <div className="mt-4 space-y-3">
            {outbox.length === 0 ? (
              <p className="text-sm text-slate-500">Sem emails na outbox.</p>
            ) : (
              outbox.slice(0, 5).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-slate-200 p-3">
                  <p className="font-medium text-slate-900">{entry.subject}</p>
                  <p className="text-sm text-slate-500">{entry.recipient}</p>
                  <p className="text-xs uppercase text-slate-500">{entry.status}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>;
}

function App() {
  const { auth, setAuth } = useAuth();
  const { cart } = useCart();

  const switchRole = async (role: Role) => {
    try {
      const response = await apiFetch<{ user: AuthState }>('/api/dev/session', {
        method: 'POST',
        body: JSON.stringify({ role }),
      });
      setAuth(response.user);
    } catch {
      // ignore and leave current state
    }
  };

  return (
    <>
      <Header />
      <div className="border-b border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span>Modo local:</span>
            <span className="font-medium text-slate-900">{auth?.mode ?? 'development'}</span>
          </div>
          {auth?.mockAccountSwitchingEnabled && (
            <div className="flex items-center gap-2">
              <button onClick={() => switchRole('GUEST')} className={`rounded-lg px-3 py-2 text-sm font-medium ${auth.role === 'GUEST' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
                GUEST
              </button>
              <button onClick={() => switchRole('ADMIN')} className={`rounded-lg px-3 py-2 text-sm font-medium ${auth.role === 'ADMIN' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 border border-slate-200'}`}>
                ADMIN
              </button>
            </div>
          )}
        </div>
      </div>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/categories/:slug" element={<CategoryPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/success" element={<OrderDetailsPage auth={auth} />} />
        <Route path="/orders" element={<OrdersPage auth={auth} />} />
        <Route path="/orders/:id" element={<OrderDetailsPage auth={auth} />} />
        <Route path="/dev/email-outbox" element={<EmailOutboxPage auth={auth} />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
