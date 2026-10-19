import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { authStore, cartStore, type AuthState, type Role } from './stores';
import { createCheckout } from './checkout';
import { hostedCheckoutUrl } from './payments';
import { apiFetch } from './api';
import { isDemo } from './deployment';
import { demoNotice } from './demo';
import { AppearancePanel, ThemeController, useActiveTheme } from './Appearance';
import { EmailThemePreview } from './EmailThemePreview';
import { AccountNavigation, AuthPage } from './AuthPages';
import { AdminAccounts, SupplierContacts, AuthEmailOutbox } from './AccountManagement';
import type { ThemeId } from './themes';
import { StoreHeader, StoreHome, StoreCartPage, StoreProductPage } from './Storefront';
import { AddToCartButton, CartFeedbackNotice, useCartFeedback } from './CartFeedback';
import { cartCountForDisplay } from './cart-feedback';
import { observeStickyHeader } from './navigation';
import type { Order } from './orders';
import { CategoryManagement, EmailOutboxPage, OrdersPage, OrderDetailsPage } from './MarketplacePages';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';

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
try { if (!isDemo) checkoutStorage = window.sessionStorage; } catch { /* In-memory retry remains available. */ }
const checkout = createCheckout(apiFetch, checkoutStorage, () => {
  const auth = authStore.getSnapshot();
  return auth?.authenticated ? auth.email : '';
});

function Header({ demo }: { demo: boolean }) {
  const { auth } = useAuth();
  const { cart } = useCart();
  const feedback = useCartFeedback();
  const displayedCount = cartCountForDisplay(cart, feedback.pendingIds);
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const floatingCart = pathname === '/' || pathname.startsWith('/categories/');
  useEffect(() => { if (header.current) return observeStickyHeader(header.current); }, []);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <header ref={header} data-floating-cart={floatingCart} className="market-header border-b border-line bg-surface" onKeyDown={(event) => {
      if (event.key === 'Escape' && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
    }}>
      <div className="market-header-inner">
        <Link to="/" onClick={() => setMenuOpen(false)} className="market-brand text-lg font-bold text-ink">Supplier Market</Link>
        <button ref={menuButton} type="button" className="market-menu-toggle" aria-label="Menu de navegação" aria-expanded={menuOpen} aria-controls="market-navigation" onClick={() => setMenuOpen((open) => !open)}>Menu</button>
        <nav id="market-navigation" aria-label="Navegação principal" data-open={menuOpen} onClick={() => setMenuOpen(false)} className="market-navigation text-sm text-ink-secondary">
          <Link to="/">Catálogo</Link>
          <Link to="/cart">Carrinho</Link>
          {!demo && <Link to="/orders">Meus pedidos</Link>}
          {!demo && auth?.role === 'ADMIN' && <Link to="/admin">Admin</Link>}
        </nav>

        <div className="market-header-actions">
          {auth && <span className="market-header-identity rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-ink-secondary">
            {auth.displayName} · {auth.role}
          </span>}
          <Link to="/cart" onClick={() => setMenuOpen(false)} aria-label={`Abrir carrinho, ${displayedCount} ${displayedCount === 1 ? 'item' : 'itens'}`} className="market-cart-link bg-action text-action-ink">
            <span className="cart-icon" data-cart-icon aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="M2 3h3l2 12h12l2-8H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg></span>
            <span className="market-cart-label" aria-hidden="true">Carrinho</span>
            <span className="market-cart-count" aria-hidden="true">{displayedCount}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomePage({ demo, theme }: { demo: boolean; theme: ThemeId }) {
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

  if (theme !== 'classic') return <StoreHome theme={theme} demo={demo} items={items} loading={loading} error={error} />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="market-hero mb-10">
        <p className="text-sm uppercase tracking-[0.2em] opacity-80">Marketplace local</p>
        <h1 className="mt-3 text-3xl font-bold">Contactos de fornecedores privados</h1>
        <p className="mt-3 max-w-xl text-sm text-brand-50">
          {demo ? 'Explore um catálogo fictício. Esta demonstração não permite compras nem fornece contactos.' : 'Explore categorias, encontre contactos selecionados e finalize uma compra local simulada.'}
        </p>
      </div>

      {loading ? (
        <p>Carregando categorias...</p>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((category) => (
            <article key={category.id} data-cart-product className="market-card overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
              <img data-cart-image src={category.imageUrl} alt={category.name} className="h-40 w-full object-cover" />
              <div className="p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-xl font-semibold text-ink">{category.name}</h2>
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">
                    {formatMoney(category.priceCents)}
                  </span>
                </div>
                <p className="mb-4 line-clamp-3 text-sm text-ink-secondary">{category.description}</p>
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

function CategoryPage({ theme, demo }: { theme: ThemeId; demo: boolean }) {
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

  if (theme !== 'classic') return <StoreProductPage theme={theme} demo={demo} item={category} count={data.supplierContactsCount} />;

  return (
    <PageShell>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <div data-cart-product className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          <img data-cart-image src={category.imageUrl} alt={category.name} className="h-64 w-full object-cover" />
          <div className="p-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h1 className="text-3xl font-bold text-ink">{category.name}</h1>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
                {formatMoney(category.priceCents)}
              </span>
            </div>
            <p className="text-ink-secondary">{category.description}</p>
            <div className="mt-6 flex gap-3">
              <AddToCartButton category={category} />
              <Link to="/" className="rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink-secondary">
                Voltar ao catálogo
              </Link>
            </div>
          </div>
        </div>

        <aside className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Resumo</h2>
          <ul className="mt-4 v3-space-y-3 text-sm text-ink-secondary">
            <li>Preço: {formatMoney(category.priceCents)}</li>
            <li>Fornecedores públicos: {data.supplierContactsCount}</li>
            <li>Estado: {category.active ? 'Ativa' : 'Inativa'}</li>
          </ul>
        </aside>
      </div>
    </PageShell>
  );
}

function CartPage({ demo, theme }: { demo: boolean; theme: ThemeId }) {
  const { cart, setCart } = useCart();
  const total = cart.reduce((sum, item) => sum + item.priceCents, 0);
  const navigate = useNavigate();

  const remove = (categoryId: string) => {
    setCart((current) => current.filter((item) => item.categoryId !== categoryId));
  };

  if (theme !== 'classic') return <StoreCartPage theme={theme} demo={demo} />;

  return (
    <PageShell>
      <div className="mx-auto max-w-4xl">
        <h1 className="text-3xl font-bold text-ink">Carrinho</h1>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="v3-space-y-4">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center text-ink-secondary">
                O carrinho está vazio. Explore o catálogo para encontrar fornecedores.
              </div>
            ) : (
              cart.map((item) => (
                <div key={item.categoryId} className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 shadow-sm">
                  <div>
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-sm text-ink-muted">{formatMoney(item.priceCents)}</p>
                  </div>
                  <button onClick={() => remove(item.categoryId)} className="text-sm font-medium text-red-600">
                    Remover
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Resumo</h2>
            <div className="mt-4 flex items-center justify-between text-sm text-ink-secondary">
              <span>Subtotal</span>
              <span>{formatMoney(total)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-ink-secondary">
              <span>Taxa de processamento</span>
              <span>€0,00</span>
            </div>
            <div className="mt-4 border-t border-line pt-4 text-lg font-semibold text-ink">
              <div className="flex items-center justify-between">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>
            <button
              onClick={() => navigate('/checkout')}
              disabled={demo || cart.length === 0}
              className="mt-5 w-full rounded-lg bg-action px-4 py-3 text-sm font-medium text-action-ink disabled:cursor-not-allowed disabled:bg-disabled"
            >
              {demo ? 'Checkout indisponível no demo' : 'Finalizar compra'}
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
  const [payment, setPayment] = useState<{ provider: 'DUMMY' | 'STRIPE'; mockEnabled: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    apiFetch<{ provider: 'DUMMY' | 'STRIPE'; mockEnabled: boolean }>('/api/payments/config')
      .then((value) => { if (active) setPayment(value); }).catch(() => { if (active) setError('Não foi possível carregar o pagamento. Atualize a página.'); });
    return () => { active = false; };
  }, []);

  const total = cart.reduce((sum, item) => sum + item.priceCents, 0);

  const submit = async () => {
    if (!cart.length) {
      setError('Adicione pelo menos um item ao carrinho.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (!payment || payment.provider === 'DUMMY' && !payment.mockEnabled) throw new Error('O pagamento não está disponível.');
      const order = await checkout.complete(cart, email, payment.provider);
      if (order.checkoutUrl) { window.location.assign(hostedCheckoutUrl(order.checkoutUrl)); return; }
      if (payment.provider === 'DUMMY') setCart([]);
      navigate('/success?orderId=' + encodeURIComponent(order.id), { state: { order } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-ink">Checkout</h1>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div className="v3-space-y-4 md:col-span-2">
            <label className="block text-sm font-medium text-ink-secondary">
              Email de entrega
              <input
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 outline-hidden ring-0 focus:border-brand-500"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
          </div>

          {cart.map((item) => (
            <div key={item.categoryId} className="rounded-xl border border-line p-3">
              <p className="font-medium text-ink">{item.name}</p>
              <p className="text-sm text-ink-muted">{formatMoney(item.priceCents)}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl bg-muted p-4">
          <div className="flex items-center justify-between text-sm text-ink-secondary">
            <span>Total</span>
            <span className="text-lg font-semibold text-ink">{formatMoney(total)}</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <button
          onClick={submit}
          disabled={submitting || cart.length === 0 || !payment || payment.provider === 'DUMMY' && !payment.mockEnabled}
          className="mt-6 w-full rounded-lg bg-action px-4 py-3 text-sm font-medium text-action-ink disabled:cursor-not-allowed disabled:bg-disabled"
        >
          {submitting ? 'Processando...' : payment?.provider === 'STRIPE' ? 'Pagar com cartão no Stripe' : 'Simular pagamento'}
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
      <div className="v3-space-y-6">
        <h1 className="text-3xl font-bold text-ink">Painel administrativo</h1>

        {dashboard && (
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard label="Categorias" value={String(dashboard.totalCategories)} />
            <StatCard label="Ativas" value={String(dashboard.activeCategories)} />
            <StatCard label="Pedidos" value={String(dashboard.totalOrders)} />
            <StatCard label="Receita" value={formatMoney(dashboard.totalRevenueCents)} />
          </div>
        )}

        <AppearancePanel auth={auth} />
        <EmailThemePreview auth={auth} />

        <CategoryManagement onChanged={() => { apiFetch<AdminDashboard>('/api/admin/dashboard').then(setDashboard).catch(() => setDashboard(null)); }} />

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-ink">Pedidos recentes</h2>
          <div className="mt-4 v3-space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-ink-muted">Ainda não existem pedidos.</p>
            ) : (
              orders.slice(0, 5).map((order) => (
                <div key={order.id} className="flex items-center justify-between rounded-xl border border-line p-3">
                  <div>
                    <Link to={`/orders/${order.id}`} className="font-medium text-brand-500 underline">{order.orderNumber}</Link>
                    <p className="text-sm text-ink-muted">{order.customerEmail}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-ink">{formatMoney(order.totalCents ?? 0)}</p>
                    <p className="text-xs uppercase text-ink-muted">{order.status}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-ink">Outbox de emails</h2>
          <Link to="/dev/email-outbox" className="text-brand-500 underline">Ver emails de entrega</Link>
          <div className="mt-4 v3-space-y-3">
            {outbox.length === 0 ? (
              <p className="text-sm text-ink-muted">Sem emails na outbox.</p>
            ) : (
              outbox.slice(0, 5).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-line p-3">
                  <p className="font-medium text-ink">{entry.subject}</p>
                  <p className="text-sm text-ink-muted">{entry.recipient}</p>
                  <p className="text-xs uppercase text-ink-muted">{entry.status}</p>
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
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>;
}

function DemoUnavailablePage() {
  return <PageShell><h1 className="text-2xl font-bold">Disponível apenas na aplicação local</h1><p className="my-4">{demoNotice}</p><Link to="/" className="text-brand-500 underline">Voltar ao catálogo demo</Link></PageShell>;
}

function App({ demo = isDemo }: { demo?: boolean } = {}) {
  const { auth, setAuth } = useAuth();
  const { cart } = useCart();
  const theme = useActiveTheme(auth, demo);

  const switchRole = async (role: Role) => {
    if (demo) return;
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
    <div className="marketplace-shell" data-theme={theme}>
      <CartFeedbackNotice />
      <ThemeController auth={auth} demo={demo} />
      {demo && <div role="status" className="bg-amber-100 px-4 py-3 text-center font-medium text-amber-900">{demoNotice}</div>}
      {theme === 'classic' ? <Header demo={demo} /> : <StoreHeader theme={theme} demo={demo} />}
      <AccountNavigation demo={demo} />
      <div className="border-b border-line bg-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-ink-secondary">
            <span>{demo ? 'Modo público:' : 'Modo local:'}</span>
            <span className="font-medium text-ink">{demo ? 'demo' : auth?.mode ?? 'development'}</span>
          </div>
          {!demo && auth?.mockAccountSwitchingEnabled && (
            <div className="flex items-center gap-2">
              <button onClick={() => switchRole('GUEST')} className={`rounded-lg px-3 py-2 text-sm font-medium ${auth.role === 'GUEST' ? 'bg-action text-action-ink' : 'bg-surface text-ink-secondary border border-line'}`}>
                GUEST
              </button>
              <button onClick={() => switchRole('ADMIN')} className={`rounded-lg px-3 py-2 text-sm font-medium ${auth.role === 'ADMIN' ? 'bg-action text-action-ink' : 'bg-surface text-ink-secondary border border-line'}`}>
                ADMIN
              </button>
            </div>
          )}
        </div>
      </div>

      <main className="market-main"><Routes>
        <Route path="/" element={<HomePage demo={demo} theme={theme} />} />
        <Route path="/categories/:slug" element={<CategoryPage theme={theme} demo={demo} />} />
        <Route path="/cart" element={<CartPage demo={demo} theme={theme} />} />
        <Route path="/checkout" element={demo ? <DemoUnavailablePage /> : <CheckoutPage />} />
        <Route path="/success" element={demo ? <DemoUnavailablePage /> : <OrderDetailsPage auth={auth} />} />
        <Route path="/orders" element={demo ? <DemoUnavailablePage /> : <OrdersPage auth={auth} />} />
        <Route path="/guest/orders" element={demo ? <DemoUnavailablePage /> : <OrdersPage auth={auth} guest />} />
        {(['login', 'register', 'verify-email', 'forgot-password', 'reset-password', 'resend-verification'] as const).map((flow) => <Route key={flow} path={'/' + flow} element={demo ? <DemoUnavailablePage /> : <AuthPage key={flow} flow={flow} />} />)}
        <Route path="/supplier" element={demo ? <DemoUnavailablePage /> : <SupplierContacts auth={auth} />} />
        <Route path="/admin/accounts" element={demo ? <DemoUnavailablePage /> : <AdminAccounts auth={auth} />} />
        <Route path="/dev/auth-email-outbox" element={demo ? <DemoUnavailablePage /> : <AuthEmailOutbox auth={auth} />} />
        <Route path="/orders/:id" element={demo ? <DemoUnavailablePage /> : <OrderDetailsPage auth={auth} />} />
        <Route path="/dev/email-outbox" element={demo ? <DemoUnavailablePage /> : <EmailOutboxPage auth={auth} />} />
        <Route path="/admin" element={demo ? <DemoUnavailablePage /> : <AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></main>
      <footer className="market-footer">
        <div><p className="market-brand font-semibold text-ink">Supplier Market</p><p>{demo ? 'Demonstração fictícia. Sem compras ou entrega de contactos.' : 'Contactos privados. Entrega apenas após confirmação de pagamento.'}</p></div>
        <nav aria-label="Rodapé"><Link to="/">Catálogo</Link><Link to="/cart">Carrinho</Link>{!demo && <Link to="/orders">Meus pedidos</Link>}</nav>
      </footer>
    </div>
  );
}

export default App;
