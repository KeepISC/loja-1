import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from './api';
import type { AuthState } from './stores';
import { EmailPreview } from './MarketplacePages';

const panel = 'mx-auto my-8 max-w-5xl v3-space-y-4 rounded-2xl border border-line bg-surface p-6 text-ink';
const button = 'rounded-lg border border-line-strong px-3 py-2 disabled:opacity-50';
const input = 'w-full rounded-lg border border-line-strong bg-surface p-2 text-ink';
type Contact = { id: string; categoryId: string; supplierName: string; email: string; telephone: string | null; whatsapp: string | null; website: string | null; notes: string | null; supplierId: string | null };
type Account = { id: string; displayName: string; email: string; role: string; account: { emailVerifiedAt: string | null } };
type Message = { id: string; recipient: string; subject: string; body: string; html?: string; status?: string; attempts?: number };

export function SupplierContacts({ auth }: { auth: AuthState | null }) {
  const [contacts, setContacts] = useState<Contact[]>([]), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const allowed = auth?.authenticated && auth.role === 'SUPPLIER';
  useEffect(() => {
    let active = true; setContacts([]);
    if (allowed) apiFetch<{ contacts: Contact[] }>('/api/supplier/contacts').then((data) => { if (active) setContacts(data.contacts); }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [allowed, auth?.email]);
  if (!allowed) return <section className={panel}><h1>Acesso de fornecedor necessário</h1><p>Entre numa conta com acesso Supplier concedido por Admin.</p></section>;
  const save = async (event: FormEvent, contact: Contact) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const { supplierName, email, telephone, whatsapp, website, notes } = contact;
    try { await apiFetch(`/api/supplier/contacts/${encodeURIComponent(contact.id)}`, { method: 'PUT', body: JSON.stringify({ supplierName, email, telephone: telephone ?? '', whatsapp: whatsapp ?? '', website: website ?? '', notes: notes ?? '' }) }); setMessage('Contacto guardado.'); }
    catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível guardar.'); }
    finally { setBusy(false); }
  };
  return <section className={panel}><h1 className="text-2xl font-bold">Meus contactos atribuídos</h1>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {!contacts.length && <p>Nenhum contacto atribuído.</p>}
    {contacts.map((contact) => <form key={contact.id} onSubmit={(event) => save(event, contact)} className="v3-space-y-3 rounded-lg border border-line p-4">
      {(['supplierName', 'email', 'telephone', 'whatsapp', 'website', 'notes'] as const).map((field) => <label key={field} className="block">{{ supplierName: 'Nome', email: 'Email', telephone: 'Telefone', whatsapp: 'WhatsApp', website: 'Website', notes: 'Notas' }[field]}<input className={input} type={field === 'email' ? 'email' : 'text'} required={field === 'email' || field === 'supplierName'} maxLength={field === 'notes' ? 1500 : field === 'website' ? 200 : field === 'email' ? 254 : 80} value={contact[field] ?? ''} onChange={(event) => setContacts((rows) => rows.map((row) => row.id === contact.id ? { ...row, [field]: event.target.value } : row))} /></label>)}
      <button className={button} disabled={busy}>Guardar contacto</button>
    </form>)}
  </section>;
}

export function AdminAccounts({ auth }: { auth: AuthState | null }) {
  const [users, setUsers] = useState<Account[]>([]), [contacts, setContacts] = useState<Contact[]>([]), [error, setError] = useState(''), [version, setVersion] = useState(0), [busy, setBusy] = useState(false);
  const allowed = auth?.authenticated && auth.role === 'ADMIN';
  useEffect(() => {
    let active = true; setUsers([]); setContacts([]);
    if (allowed) Promise.all([
      apiFetch<{ users: Account[] }>('/api/admin/accounts'),
      apiFetch<{ items: { contacts: Contact[] }[] }>('/api/admin/categories'),
    ]).then(([accounts, categories]) => { if (active) { setUsers(accounts.users); setContacts(categories.items.flatMap((category) => category.contacts)); } }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [allowed, auth?.email, version]);
  if (!allowed) return <section className={panel}>Entre numa conta Admin real para gerir contas. O seletor de demonstração não concede este acesso.</section>;
  const update = async (url: string, body: unknown) => {
    setBusy(true); setError('');
    try { await apiFetch(url, { method: 'PUT', body: JSON.stringify(body) }); setVersion((value) => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível guardar.'); }
    finally { setBusy(false); }
  };
  return <section className={panel}><h1 className="text-2xl font-bold">Contas e fornecedores</h1>{error && <p role="alert">{error}</p>}
    {users.map((user) => <div key={user.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"><span>{user.displayName} · {user.email} · {user.role}</span>{user.role !== 'ADMIN' && <button className={button} disabled={busy || !user.account.emailVerifiedAt} onClick={() => update(`/api/admin/accounts/${encodeURIComponent(user.id)}/supplier`, { active: user.role !== 'SUPPLIER' })}>{user.role === 'SUPPLIER' ? 'Revogar Supplier' : 'Conceder Supplier'}</button>}</div>)}
    <h2 className="text-xl font-semibold">Atribuição de contactos existentes</h2>
    {contacts.map((contact) => <label key={contact.id} className="block">{contact.supplierName}<select className={input} disabled={busy} value={contact.supplierId ?? ''} onChange={(event) => update(`/api/admin/contacts/${encodeURIComponent(contact.id)}/assignment`, { supplierId: event.target.value || null })}><option value="">Sem fornecedor</option>{users.filter((user) => user.role === 'SUPPLIER').map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.email}</option>)}{contact.supplierId && !users.some((user) => user.id === contact.supplierId && user.role === 'SUPPLIER') && <option value={contact.supplierId}>Atribuição inativa</option>}</select></label>)}
  </section>;
}

export function AuthEmailOutbox({ auth }: { auth: AuthState | null }) {
  const [items, setItems] = useState<Message[]>([]), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const allowed = auth?.role === 'ADMIN';
  useEffect(() => {
    let active = true; setItems([]);
    if (allowed) apiFetch<{ items: Message[] }>('/api/dev/auth-email-outbox').then((data) => { if (active) setItems(data.items); }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [allowed, version, auth?.email]);
  if (!allowed) return <section className={panel}>Outbox local reservada a Admin.</section>;
  return <section className={panel}><h1 className="text-2xl font-bold">Emails de autenticação</h1><p>No modo preview, os emails ficam apenas nesta outbox. No modo SMTP, consulte o estado de processamento; a aceitação pelo servidor não garante entrega na caixa de entrada.</p><button className={button} onClick={() => setVersion((value) => value + 1)}>Atualizar</button>{error && <p role="alert">{error}</p>}{items.map((item) => <div key={item.id}>{item.status && <p role="status">{item.status} · Tentativas: {item.attempts ?? 0}</p>}<EmailPreview delivery={item} /></div>)}</section>;
}
