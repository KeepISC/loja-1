import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { apiFetch } from './api';
import { loadOwnedOrder, orderOutcome, type Order } from './orders';
import type { AuthState } from './stores';

type Category = { id: string; name: string; slug: string; description: string; priceCents: number; active: boolean };
type ContactDraft = { supplierName: string; email: string; telephone: string; whatsapp: string; website: string; notes: string };
type Contact = ContactDraft & { id: string };
type Delivery = { recipient: string; subject: string; body: string; html?: string };
type OutboxItem = Delivery & { id: string; orderId: string; status: string; attempts: number; lastError?: string | null };
const panel = 'rounded-2xl border border-line bg-surface p-5 shadow-sm';
const button = 'rounded-lg bg-action px-3 py-2 text-sm text-action-ink disabled:opacity-50';
const secondary = 'rounded-lg border border-line-strong px-3 py-2 text-sm disabled:opacity-50';
const inputClass = 'mt-1 w-full rounded-lg border border-line-strong px-3 py-2';
const money = (cents: number) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const message = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir o pedido.';

function Shell({ children }: { children: ReactNode }) { return <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">{children}</div>; }
function ErrorMessage({ text }: { text?: string | null }) { return text ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{text}</p> : null; }
function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block text-sm font-medium text-ink-secondary">{label}<input {...props} className={inputClass} /></label>;
}

function useResource<T>(url: string | null, identity = '') {
  const [version, setVersion] = useState(0);
  const key = `${url}|${identity}|${version}`;
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  useEffect(() => {
    if (!url) return;
    let active = true;
    apiFetch<T>(url).then((data) => { if (active) setState({ key, data }); })
      .catch((error) => { if (active) setState({ key, error: message(error) }); });
    return () => { active = false; };
  }, [url, key]);
  const current = state.key === key ? state : null;
  return { data: current?.data, error: current?.error, loading: Boolean(url && !current), reload: () => setVersion((value) => value + 1) };
}

export function CategoryForm({ category, onSave }: { category: Category | null; onSave: (category: Category) => void }) {
  const [draft, setDraft] = useState({ name: category?.name ?? '', slug: category?.slug ?? '', description: category?.description ?? '', price: String((category?.priceCents ?? 100) / 100), active: category?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const result = await apiFetch<{ item: Category }>('/api/admin/categories' + (category ? '/' + encodeURIComponent(category.id) : ''), {
        method: category ? 'PUT' : 'POST',
        body: JSON.stringify({ name: draft.name, slug: draft.slug, description: draft.description, priceCents: Math.round(Number(draft.price) * 100), active: draft.active }),
      });
      onSave(result.item);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-3">
    <h3 className="text-lg font-semibold">{category ? 'Editar categoria' : 'Nova categoria'}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nome" required minLength={2} maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      <Field label="Slug" required minLength={2} maxLength={80} pattern="[a-z0-9-]+" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} />
      <Field label="Preço (€)" type="number" min="0.01" step="0.01" required value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
      <label className="flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />Ativa</label>
    </div>
    <label className="block text-sm font-medium">Descrição<textarea required minLength={10} maxLength={2000} className={inputClass} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
    <ErrorMessage text={error} />
    <button className={button} disabled={busy}>{busy ? 'A guardar...' : 'Guardar categoria'}</button>
  </form>;
}

function ContactManager({ category }: { category: Category }) {
  const url = `/api/admin/categories/${encodeURIComponent(category.id)}/contacts`;
  const resource = useResource<{ contacts: Contact[] }>(url);
  const empty: ContactDraft = { supplierName: '', email: '', telephone: '', whatsapp: '', website: '', notes: '' };
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await apiFetch(url + (editing ? '/' + encodeURIComponent(editing) : ''), { method: editing ? 'PUT' : 'POST', body: JSON.stringify(draft) });
      setEditing(null); setDraft(empty); resource.reload();
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true); setError(null);
    try {
      await apiFetch(url + '/' + encodeURIComponent(id), { method: 'DELETE' });
      if (editing === id) { setEditing(null); setDraft(empty); }
      resource.reload();
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <section className="space-y-4 border-t border-line pt-5">
    <h3 className="text-lg font-semibold">Contactos privados — {category.name}</h3>
    <ErrorMessage text={resource.error || error} />
    {resource.loading && <p>Carregando contactos...</p>}
    <ul className="space-y-2">{resource.data?.contacts.map((contact) => <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 break-words"><p>{contact.supplierName}</p><p className="text-sm text-ink-muted">{contact.email}</p></div>
      <div className="flex gap-2"><button className={secondary} disabled={busy} onClick={() => { setEditing(contact.id); setDraft({ supplierName: contact.supplierName, email: contact.email, telephone: contact.telephone || '', whatsapp: contact.whatsapp || '', website: contact.website || '', notes: contact.notes || '' }); }}>Editar contacto</button><button className={secondary} disabled={busy} onClick={() => remove(contact.id)}>Eliminar contacto</button></div>
    </li>)}</ul>
    <form onSubmit={save} className="space-y-3">
      <h4 className="font-medium">{editing ? 'Editar contacto' : 'Adicionar contacto'}</h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Fornecedor" required minLength={2} maxLength={80} value={draft.supplierName} onChange={(e) => setDraft({ ...draft, supplierName: e.target.value })} />
        <Field label="Email" type="email" required value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        <Field label="Telefone" maxLength={80} value={draft.telephone} onChange={(e) => setDraft({ ...draft, telephone: e.target.value })} />
        <Field label="WhatsApp" maxLength={80} value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} />
        <Field label="Website" maxLength={200} value={draft.website} onChange={(e) => setDraft({ ...draft, website: e.target.value })} />
      </div>
      <label className="block text-sm">Notas<textarea className={inputClass} maxLength={1500} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
      <div className="flex gap-2"><button className={button} disabled={busy}>Guardar contacto</button>{editing && <button type="button" className={secondary} onClick={() => { setEditing(null); setDraft(empty); }}>Cancelar edição</button>}</div>
    </form>
  </section>;
}

export function CategoryManagement({ onChanged }: { onChanged: () => void }) {
  const resource = useResource<{ items: Category[] }>('/api/admin/categories');
  const [selected, setSelected] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = () => { resource.reload(); onChanged(); };
  const deactivate = async (category: Category) => {
    setBusy(true); setError(null);
    try { await apiFetch('/api/admin/categories/' + encodeURIComponent(category.id), { method: 'DELETE' }); if (selected?.id === category.id) setSelected(null); changed(); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  return <section className={panel + ' space-y-5'}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Gerir categorias e contactos</h2><button className={secondary} onClick={() => setSelected(null)}>Nova categoria</button></div>
    <ErrorMessage text={error || resource.error} />
    {resource.loading && <p>Carregando categorias...</p>}
    <ul className="space-y-2">{resource.data?.items.map((category) => <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <span>{category.name} · {money(category.priceCents)} · {category.active ? 'Ativa' : 'Inativa'}</span>
      <div className="flex flex-wrap gap-2"><button className={secondary} onClick={() => setSelected(category)}>Editar / Contactos</button><button className={secondary} disabled={busy || !category.active} onClick={() => deactivate(category)}>Desativar</button></div>
    </li>)}</ul>
    <CategoryForm key={selected?.id || 'new'} category={selected} onSave={(category) => { setSelected(category); changed(); }} />
    {selected && <>
      <label className="block text-sm font-medium">Imagem da categoria (PNG, JPEG ou WebP, até 2 MiB)
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className="mt-2 block w-full" onChange={async (event) => {
          const input = event.currentTarget, file = input.files?.[0];
          if (!file) return;
          setBusy(true); setError(null);
          try { const form = new FormData(); form.append('image', file); await apiFetch(`/api/admin/categories/${encodeURIComponent(selected.id)}/image`, { method: 'POST', body: form }); changed(); }
          catch (err) { setError(message(err)); } finally { setBusy(false); input.value = ''; }
        }} />
      </label>
      <ContactManager key={selected.id} category={selected} />
    </>}
  </section>;
}

export function OrdersPage({ auth }: { auth: AuthState | null }) {
  const resource = useResource<{ items: Order[] }>('/api/orders', auth?.role);
  return <Shell><h1 className="text-3xl font-bold">Meus pedidos</h1><ErrorMessage text={resource.error} />
    {resource.loading && <p>Carregando pedidos...</p>}
    {resource.data?.items.length === 0 && <p>Ainda não existem pedidos nesta sessão.</p>}
    <ul className="space-y-3">{resource.data?.items.map((order) => <li key={order.id} className={panel + ' break-words'}><Link className="font-semibold text-brand-500 underline" to={'/orders/' + encodeURIComponent(order.id)}>{order.orderNumber}</Link><p>{order.status} · {money(order.totalCents)}</p></li>)}</ul>
  </Shell>;
}

export function OrderSummary({ order }: { order: Order }) {
  const outcome = orderOutcome(order);
  return <section className={panel + ' space-y-3 break-words'}>
    <h1 className="text-2xl font-bold">{outcome === 'delivered' ? 'Pagamento confirmado' : outcome === 'delivery-pending' ? 'Pagamento confirmado; entrega pendente' : outcome === 'payment-pending' ? 'Pagamento pendente' : 'Pedido indisponível para pagamento'}</h1>
    {outcome === 'delivered' && <p>O email de entrega foi gerado no outbox local.</p>}
    <p><strong>Pedido:</strong> {order.orderNumber}</p><p><strong>Estado:</strong> {order.status}</p><p><strong>Valor:</strong> {money(order.totalCents)}</p><p><strong>Email:</strong> {order.customerEmail}</p>
    <ul>{order.items?.map((item) => <li key={item.categoryId}>{item.categoryName} · {money(item.priceCents)}</li>)}</ul>
  </section>;
}

export function EmailHtmlPreview({ html }: { html: string }) {
  // Keep email markup in an opaque, script-free document; block remote resources too.
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'">';
  const document = /<head>/i.test(html) ? html.replace(/<head>/i, '<head>' + policy) : policy + html;
  return <iframe title="Pré-visualização HTML do email" sandbox="" referrerPolicy="no-referrer" srcDoc={document} className="h-[640px] w-full rounded-lg border border-line bg-white" />;
}

export function EmailPreview({ delivery }: { delivery: Delivery }) {
  const [showHtml, setShowHtml] = useState(false);
  return <section className={panel + ' min-w-0 space-y-2 break-words'}><h2 className="font-semibold">{delivery.subject}</h2><p>Destinatário: {delivery.recipient}</p>
    {delivery.html && <button type="button" className={secondary} aria-pressed={showHtml} onClick={() => setShowHtml((previous) => !previous)}>{showHtml ? 'Ver texto simples' : 'Ver versão HTML'}</button>}
    {showHtml && delivery.html ? <EmailHtmlPreview html={delivery.html} /> : <pre className="whitespace-pre-wrap break-words font-sans text-sm">{delivery.body}</pre>}
  </section>;
}

export function OrderDetailsPage({ auth }: { auth: AuthState | null }) {
  const params = useParams(), location = useLocation();
  const [search] = useSearchParams();
  const stateId = (location.state as { order?: { id?: unknown } } | null)?.order?.id;
  const id = params.id || search.get('orderId') || (typeof stateId === 'string' ? stateId : null);
  const identity = `${id}|${auth?.role}`;
  const [result, setResult] = useState<{ key: string; order?: Order; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const key = `${identity}|${version}`;
  const [email, setEmail] = useState<{ key: string; delivery: Delivery } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    loadOwnedOrder(apiFetch, id).then((order) => { if (active && order) setResult({ key, order }); })
      .catch((error) => { if (active) setResult({ key, error: message(error) }); });
    return () => { active = false; };
  }, [id, key]);
  const current = result?.key === key ? result : null;
  const order = current?.order;
  const act = async (deliveryOnly: boolean) => {
    if (!id) return;
    setBusy(true); setActionError(null);
    try {
      if (deliveryOnly) {
        const response = await apiFetch<{ delivery: Delivery }>(`/api/orders/${encodeURIComponent(id)}/delivery`);
        setEmail({ key, delivery: response.delivery });
      } else {
        await apiFetch('/api/dev/payments/' + encodeURIComponent(id) + '/simulate', { method: 'POST' });
        setVersion((value) => value + 1);
      }
    } catch (error) { setActionError(message(error)); } finally { setBusy(false); }
  };
  return <Shell>
    {!id ? <p>Nenhum pedido selecionado. Consulte os seus pedidos para verificar o pagamento.</p> : !current ? <p>A verificar o pedido...</p> : <ErrorMessage text={current.error} />}
    {order && <><OrderSummary order={order} />
      {['payment-pending', 'delivery-pending'].includes(orderOutcome(order)) && <button className={button} disabled={busy} onClick={() => act(false)}>{orderOutcome(order) === 'payment-pending' ? 'Simular pagamento' : 'Repetir entrega'}</button>}
      {orderOutcome(order) === 'delivered' && <button className={secondary} disabled={busy} onClick={() => act(true)}>Ver email de entrega</button>}
      {email?.key === key && orderOutcome(order) === 'delivered' && <EmailPreview delivery={email.delivery} />}
    </>}
    <ErrorMessage text={actionError} /><Link className="inline-block text-brand-500 underline" to="/orders">Meus pedidos</Link>
  </Shell>;
}

export function EmailOutboxPage({ auth }: { auth: AuthState | null }) {
  const allowed = auth?.role === 'ADMIN' && auth.mockAccountSwitchingEnabled === true;
  const resource = useResource<{ items: OutboxItem[] }>(allowed ? '/api/dev/email-outbox' : null, auth?.role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!allowed) return <Shell><p>Acesso restrito. Selecione ADMIN em modo de desenvolvimento.</p></Shell>;
  return <Shell><h1 className="text-3xl font-bold">Outbox de emails</h1><ErrorMessage text={resource.error || error} />
    {resource.loading && <p>Carregando emails...</p>}
    {resource.data?.items.length === 0 && <p>Sem emails na outbox.</p>}
    {resource.data?.items.map((item) => <div key={item.id} className="space-y-2"><p>{item.status} · Tentativas: {item.attempts}</p>
      {item.body ? <EmailPreview delivery={item} /> : <p>Email ainda não enviado.</p>}
      {item.status === 'FAILED' && <button className={secondary} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await apiFetch('/api/dev/email-outbox/retry/' + encodeURIComponent(item.orderId), { method: 'POST' }); resource.reload(); }
        catch (err) { setError(message(err)); } finally { setBusy(false); }
      }}>Repetir entrega</button>}
    </div>)}
  </Shell>;
}
