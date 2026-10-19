import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AddToCartButton, useCartFeedback } from './CartFeedback';
import { cartCountForDisplay } from './cart-feedback';
import { observeStickyHeader } from './navigation';
import { cartStore, authStore } from './stores';
import type { ThemeId } from './themes';

export type Product = { id: string; slug: string; name: string; description: string; priceCents: number; imageUrl: string; active: boolean };

export type NewTheme = Exclude<ThemeId, 'classic'>;

const money = (cents: number) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const useCart = () => useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, cartStore.getSnapshot);

function CartIcon() {
  return <span className="cart-icon" data-cart-icon aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" focusable="false"><path d="M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2" /></svg></span>;
}

export function StoreHeader({ theme, demo }: { theme: NewTheme; demo: boolean }) {
  const auth = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
  const cart = useCart();
  const feedback = useCartFeedback();
  const count = cartCountForDisplay(cart, feedback.pendingIds);
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const header = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const cartTrigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => header.current ? observeStickyHeader(header.current) : undefined, [theme]);
  useEffect(() => { setMenu(false); setOpen(false); }, [location.pathname, theme]);
  const links = <><Link to="/">{theme === 'minimal' ? 'A coleção' : 'Explorar'}</Link><Link to="/cart">Carrinho</Link>{!demo && <><Link to="/orders">Meus pedidos</Link>{auth?.role === 'ADMIN' && <Link to="/admin">Admin</Link>}</>}</>;
  const brand = <Link to="/" className="sf-brand">{theme === 'dark' && <span aria-hidden="true" className="sf-monogram">S/M</span>}<span>Supplier<span className="sf-brand-second"> Market</span></span></Link>;
  const bag = <button type="button" ref={cartTrigger} className="sf-bag" aria-label={`Abrir carrinho, ${count} ${count === 1 ? 'item' : 'itens'}`} aria-haspopup="dialog" onClick={() => setOpen(true)}><CartIcon /><span className="sf-bag-label">{theme === 'minimal' ? 'Sacola' : 'Carrinho'}</span><span className="sf-bag-count">{count}</span>{theme === 'dark' && <span className="sf-bag-total">{money(cart.reduce((sum, item) => sum + item.priceCents, 0))}</span>}</button>;
  return <>
    <header ref={header} className={`sf-header sf-header-${theme}`} onKeyDown={(event) => { if (event.key === 'Escape' && menu) { setMenu(false); toggle.current?.focus(); } }}>
      {theme === 'marketplace' &&
        <div className="sf-utility">
          O seu próximo fornecedor começa aqui <span>Catálogo de contactos por categoria</span>
        </div>
      }
      <div className="sf-header-row">
        {theme === 'minimal' &&
          <nav className="sf-desktop-links" aria-label="Coleção">
            <Link to="/">A coleção</Link><Link to="/#sf-catalog">Categorias ↗</Link>
          </nav>
        }
        {brand}
        {theme === 'marketplace' &&
          <form role="search" className="sf-header-search" onSubmit={(event) => { event.preventDefault(); const query = new FormData(event.currentTarget).get('q'); navigate('/?q=' + encodeURIComponent(String(query ?? ''))); }}>
            <label className="sr-only" htmlFor="header-search">
              Pesquisar categorias
            </label>
            <input id="header-search" name="q" type="search" placeholder="O que procura para o seu negócio?" /><button aria-label="Pesquisar" type="submit">⌕</button>
          </form>
        }
        {theme === 'dark' &&
          <nav className="sf-desktop-links" aria-label="Explorar">
            {links}
          </nav>
        }
        <button type="button" ref={toggle} className="sf-menu" aria-label="Menu de navegação" aria-controls="sf-navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}>{menu ? 'Fechar' : 'Menu'} <span aria-hidden="true">☰</span></button>
        {bag}
      </div>

      <nav id="sf-navigation" className={`sf-navigation ${theme === 'marketplace' ? 'sf-navigation-marketplace' : ''}`} data-open={menu} aria-label="Navegação principal" onClick={() => setMenu(false)}>
        {links}{theme === 'marketplace' && <Link to="/#sf-catalog">Todas as categorias ↓</Link>}
      </nav>

    </header>
    {open && <CartDialog theme={theme} demo={demo} onClose={() => setOpen(false)} />}
  </>;
}

function CartDialog({ theme, demo, onClose }: { theme: NewTheme; demo: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog ref={dialog} className={`sf-cart-dialog sf-cart-dialog-${theme}`} aria-labelledby="quick-cart-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>

    <div className="sf-dialog-heading">
      <div>
        <p className="sf-kicker">A SUA SELEÇÃO</p><h2 id="quick-cart-title">{theme === 'minimal' ? 'A sua sacola' : 'Carrinho'}</h2>
      </div>
      <button type="button" autoFocus className="sf-close" aria-label="Fechar carrinho" onClick={onClose}>✕</button>
    </div>
    <CartContents theme={theme} demo={demo} compact onNavigate={onClose} />
  </dialog>;
}

export function CartContents({ theme, demo, compact = false, onNavigate }: { theme: NewTheme; demo: boolean; compact?: boolean; onNavigate?: () => void }) {
  const cart = useCart();
  const total = cart.reduce((sum, item) => sum + item.priceCents, 0);
  return <div className={`sf-cart-content sf-cart-content-${theme} ${compact ? 'sf-cart-compact' : ''}`}>

    <div className="sf-cart-items">
      {!cart.length ?
        <div className="sf-cart-empty">
          <span aria-hidden="true">◯</span><h2>Ainda há espaço para descobrir.</h2><p>Adicione uma categoria à sua seleção.</p><Link to="/" className="sf-text-link" onClick={onNavigate}>Explorar catálogo ↗</Link>
        </div>
        : cart.map((item, index) =>
          <article key={item.categoryId} className="sf-cart-item">
            <span className="sf-cart-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div>
              <h3>{item.name}</h3><p>Categoria de contactos · 1 unidade</p><button type="button" className="sf-remove" aria-label={`Remover ${item.name}`} onClick={() => cartStore.set((current) => current.filter((entry) => entry.categoryId !== item.categoryId))}>Remover</button>
            </div>
            <strong>{money(item.priceCents)}</strong>
          </article>
        )}
    </div>

    <aside className="sf-cart-summary">
      <p className="sf-kicker">RESUMO DA SELEÇÃO</p>
      <div>
        <span>{cart.length} {cart.length === 1 ? 'categoria' : 'categorias'}</span><span>{money(total)}</span>
      </div>
      <div>
        <span>Processamento</span><span>{money(0)}</span>
      </div>
      <div className="sf-cart-total" aria-live="polite">
        <span>Total</span><strong>{money(total)}</strong>
      </div>
      {demo || !cart.length ? <button type="button" className="sf-primary" disabled>{demo ? 'Checkout indisponível no demo' : 'Adicione uma categoria'}</button> : <Link className="sf-primary" to="/checkout" onClick={onNavigate}>Finalizar compra ↗</Link>}
      {compact && <Link className="sf-text-link" to="/cart" onClick={onNavigate}>Ver carrinho completo →</Link>}
      <p>{demo ? 'Seleção fictícia. Sem compras ou entrega de contactos.' : 'Compra local simulada. Contactos após confirmação de pagamento.'}</p>
    </aside>

  </div>;
}

export function StoreCartPage({ theme, demo }: { theme: NewTheme; demo: boolean }) {
  return <section className="sf-page sf-cart-page">
    <Link className="sf-text-link" to="/">← Continuar a explorar</Link>
    <div className="sf-page-heading">
      <p className="sf-kicker">SELECIONADO POR SI</p><h1>{theme === 'minimal' ? 'A sua sacola.' : theme === 'dark' ? 'O próximo passo.' : 'O seu carrinho'}</h1>
    </div>
    <CartContents theme={theme} demo={demo} />
  </section>;
}
type CatalogProps = { theme: NewTheme; demo: boolean; items: Product[]; loading: boolean; error: string | null };

export function StoreHome({ theme, demo, items, loading, error }: CatalogProps) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  useEffect(() => {
    if (!loading && location.hash === '#sf-catalog') document.getElementById('sf-catalog')?.scrollIntoView();
  }, [loading, location.hash, theme]);
  const query = params.get('q') ?? '';
  const selected = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'default';
  const update = (key: string, value: string) => setParams((previous) => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const visible = items.filter((item) => (!selected || selected === item.slug) && (item.name + ' ' + item.description).toLocaleLowerCase('pt').includes(query.toLocaleLowerCase('pt')));
  if (sort === 'price-asc') visible.sort((a, b) => a.priceCents - b.priceCents);
  if (sort === 'price-desc') visible.sort((a, b) => b.priceCents - a.priceCents);
  const status = loading ? <p role="status" className="sf-status">A carregar o catálogo…</p> : error ? <p role="alert" className="sf-status">{error}</p> : !visible.length ?
    <div className="sf-status" role="status">
      <h2>Nenhuma categoria encontrada.</h2><p>Experimente outra pesquisa ou volte a explorar tudo.</p><button className="sf-text-link" onClick={() => setParams({})}>Limpar filtros</button>
    </div>
    : <p className="sr-only" role="status">{visible.length} categorias encontradas.</p>;
  const intro = demo ? 'Um catálogo fictício para explorar. Sem compras nem contactos reais.' : 'Explore categorias e encontre contactos para o seu próximo projeto. Compra local simulada.';
  const search =
    <label className="sf-catalog-search">
      <span>Pesquisar no catálogo</span><input type="search" value={query} onChange={(event) => update('q', event.target.value)} placeholder="Nome ou descrição…" />
    </label>;
  const sortControl =
    <label className="sf-sort">
      Ordenar por<select value={sort} onChange={(event) => update('sort', event.target.value)}><option value="default">Seleção original</option><option value="price-asc">Menor preço</option><option value="price-desc">Maior preço</option></select>
    </label>;
  const categoryButtons = <><button aria-pressed={!selected} onClick={() => update('category', '')}>Todas <span>{items.length}</span></button>{items.map((item, index) => <button key={item.id} aria-pressed={selected === item.slug} onClick={() => update('category', item.slug)}>{theme === 'dark' && <span className="sf-category-number">{String(index + 1).padStart(2, '0')}</span>}{item.name}<span aria-hidden="true">↗</span></button>)}</>;
  if (theme === 'minimal') return <div className="sf-page sf-minimal-home">

    <section className="sf-editorial">
      <div>
        <p className="sf-kicker">SUPPLIER MARKET / A COLEÇÃO</p><h1>Boas ligações.<br /><em>Novas possibilidades.</em></h1><p>{intro}</p><Link to="/#sf-catalog" className="sf-text-link">Descobrir a coleção <span aria-hidden="true">↓</span></Link>
      </div>
      {items[0] && <Link className="sf-editorial-image" to={`/categories/${items[0].slug}`}><img src={items[0].imageUrl} alt={items[0].name} /><span>EM FOCO / {items[0].name} <span aria-hidden="true">↗</span></span></Link>}
    </section>

    <section id="sf-catalog" className="sf-catalog-section">
      <div className="sf-catalog-heading">
        <div>
          <p className="sf-kicker">CONTACTOS POR CATEGORIA</p><h2>Explore com intenção.</h2>
        </div>
        <span>{visible.length} categorias</span>
      </div>
      <nav className="sf-category-tabs" aria-label="Filtrar categorias">
        {categoryButtons}
      </nav>
      <div className="sf-tools">
        {search}{sortControl}
      </div>
      {status}
      <div className="sf-minimal-grid">
        {visible.map((item, index) => <MinimalCard key={item.id} item={item} index={index} />)}
      </div>
    </section>

  </div>;
  if (theme === 'marketplace') return <div className="sf-page sf-marketplace-home">

    <section className="sf-market-intro">
      <div>
        <p className="sf-kicker">ENCONTRE A SUA PRÓXIMA CATEGORIA</p><h1>Mais opções para o seu negócio.</h1><p>{intro}</p>
      </div>
      <div className="sf-catalog-count">
        <strong>{items.length}</strong><span>categorias para explorar</span>
      </div>
    </section>

    <div id="sf-catalog" className="sf-market-layout">
      <aside className="sf-category-sidebar">
        <h2>Categorias</h2>
        <nav aria-label="Filtrar categorias">
          {categoryButtons}
        </nav>
        {search}
      </aside>
      <section className="sf-market-results" aria-labelledby="results-title">
        <div className="sf-catalog-heading">
          <h2 id="results-title">{query ? `Resultados para “${query}”` : 'Todos os contactos'} <small>({visible.length})</small></h2>{sortControl}
        </div>
        {status}
        <div className="sf-market-grid">
          {visible.map((item) => <MarketplaceCard key={item.id} item={item} demo={demo} />)}
        </div>
      </section>
    </div>

  </div>;
  return <div className="sf-page sf-dark-home">
    <section className="sf-dark-intro">
      <p className="sf-kicker"><span aria-hidden="true">●</span> SUPPLIER MARKET — EXPLORE O POTENCIAL</p>
      <div>
        <h1>A próxima ligação<br />muda <em>tudo.</em></h1><p>{intro}<Link to="/#sf-catalog" className="sf-text-link">Encontre o seu ponto de partida ↘</Link></p>
      </div>
    </section>
    <nav className="sf-category-tiles" aria-label="Filtrar categorias">
      {categoryButtons}
    </nav>
    <section id="sf-catalog">
      <div className="sf-catalog-heading">
        <h2>O seu próximo movimento<span className="sf-dot">.</span></h2><span>{visible.length} categorias</span>
      </div>
      <div className="sf-tools">
        {search}{sortControl}
      </div>
      {status}
      <div className="sf-dark-grid">
        {visible.map((item, index) => <DarkCard key={item.id} item={item} index={index} />)}
      </div>
    </section>
  </div>;
}

export function MinimalCard({ item, index }: { item: Product; index: number }) {
  return <article className="sf-product sf-minimal-card" data-cart-product>
    <Link className="sf-product-image" to={`/categories/${item.slug}`}><img data-cart-image src={item.imageUrl} alt={item.name} loading="lazy" /><span className="sf-image-link" aria-hidden="true">Descobrir ↗</span></Link>
    <div className="sf-minimal-card-copy">
      <p className="sf-kicker">COLEÇÃO / {String(index + 1).padStart(2, '0')}</p>
      <div>
        <h3><Link to={`/categories/${item.slug}`}>{item.name}</Link></h3><span>{money(item.priceCents)}</span>
      </div>
      <p>{item.description}</p><AddToCartButton category={item} />
    </div>
  </article>;
}

export function MarketplaceCard({ item, demo }: { item: Product; demo: boolean }) {
  return <article className="sf-product sf-market-card" data-cart-product>
    <Link className="sf-product-image" to={`/categories/${item.slug}`}><img data-cart-image src={item.imageUrl} alt={item.name} loading="lazy" /><span className="sf-product-tag">{demo ? 'FICTÍCIO' : 'CONTACTOS'}</span></Link>
    <div className="sf-market-card-copy">
      <p className="sf-kicker">CATEGORIA DE FORNECEDORES</p><h3><Link to={`/categories/${item.slug}`}>{item.name}</Link></h3><p>{item.description}</p><strong className="sf-price">{money(item.priceCents)}</strong><span className="sf-product-meta">Preço por categoria · Sem quantidade</span><AddToCartButton category={item} /><Link to={`/categories/${item.slug}`} className="sf-details-link">Ver o que inclui →</Link>
    </div>
  </article>;
}

export function DarkCard({ item, index }: { item: Product; index: number }) {
  return <article className="sf-product sf-dark-card" data-cart-product>
    <Link className="sf-product-image" to={`/categories/${item.slug}`}><img data-cart-image src={item.imageUrl} alt={item.name} loading="lazy" /><span className="sf-dark-card-index">/{String(index + 1).padStart(2, '0')}</span><span className="sf-dark-card-arrow" aria-hidden="true">↗</span></Link>
    <div className="sf-dark-card-copy">
      <div>
        <p className="sf-kicker">CONTACTOS / CATEGORIA</p><h3><Link to={`/categories/${item.slug}`}>{item.name}</Link></h3><p>{item.description}</p>
      </div>
      <div className="sf-dark-card-bottom">
        <strong>{money(item.priceCents)}</strong><AddToCartButton category={item} />
      </div>
    </div>
  </article>;
}

export function StoreProductPage({ theme, demo, item, count }: { theme: NewTheme; demo: boolean; item: Product; count: number }) {
  return <section className={`sf-page sf-detail sf-detail-${theme}`}>
    <nav className="sf-breadcrumb" aria-label="Localização">
      <Link to="/">Catálogo</Link><span aria-hidden="true">/</span><span>{item.name}</span>
    </nav>
    <div className="sf-detail-layout" data-cart-product>
      <div className="sf-detail-image">
        <img data-cart-image src={item.imageUrl} alt={item.name} />
      </div>
      <div className="sf-detail-copy">
        <p className="sf-kicker">SUPPLIER MARKET / CONTACTOS</p><h1>{item.name}</h1><p>{item.description}</p><strong className="sf-detail-price">{money(item.priceCents)}</strong>
        <dl>
          <div>
            <dt>Fornecedores públicos</dt><dd>{count}</dd>
          </div>
          <div>
            <dt>Estado</dt><dd>{item.active ? 'Ativa' : 'Inativa'}</dd>
          </div>
          <div>
            <dt>Formato</dt><dd>Categoria de contactos</dd>
          </div>
        </dl>
        <AddToCartButton category={item} /><p className="sf-detail-notice">{demo ? 'Demonstração fictícia. Compras e entrega de contactos desativadas.' : 'Compra local simulada. Contactos privados disponíveis apenas após confirmação de pagamento.'}</p><Link to="/" className="sf-text-link">← Explorar outras categorias</Link>
      </div>
    </div>
  </section>;
}
