import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from './api';
import { authStore, type AuthState } from './stores';

const panel = 'mx-auto my-8 max-w-lg v3-space-y-4 rounded-2xl border border-line bg-surface p-6 text-ink shadow-sm';
const input = 'mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-ink';
const button = 'rounded-lg bg-action px-4 py-2 text-action-ink disabled:opacity-50';
type Flow = 'login' | 'register' | 'verify-email' | 'forgot-password' | 'reset-password' | 'resend-verification';
const titles: Record<Flow, string> = { login: 'Entrar', register: 'Criar conta', 'verify-email': 'Verificar email', 'forgot-password': 'Recuperar senha', 'reset-password': 'Definir nova senha', 'resend-verification': 'Reenviar verificação' };

export function AccountNavigation({ demo }: { demo: boolean }) {
  const auth = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  if (demo) return null;
  const logout = async () => {
    setError('');
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', body: '{}' });
      authStore.set(await apiFetch<AuthState>('/api/auth/me'));
      navigate('/login');
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível sair.'); }
  };
  return <nav aria-label="Conta" className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm text-ink-secondary">
    {auth?.authenticated ? <><span>{auth.displayName} · {auth.role}</span><Link to="/orders">Compras da conta</Link><button type="button" onClick={logout}>Sair</button></> : <><Link to="/login">Entrar</Link><Link to="/register">Criar conta</Link></>}
    <Link to="/guest/orders">Compras como convidado</Link>
    {auth?.authenticated && auth.role === 'SUPPLIER' && <Link to="/supplier">Meus contactos</Link>}
    {auth?.authenticated && auth.role === 'ADMIN' && <Link to="/admin/accounts">Contas e fornecedores</Link>}
    {auth?.role === 'ADMIN' && <Link to="/dev/auth-email-outbox">Emails de autenticação locais</Link>}
    {auth?.sessionExpired && <span role="status">A sessão terminou. Entre novamente para aceder à conta.</span>}
    {error && <span role="alert">{error}</span>}
  </nav>;
}

export function AuthPage({ flow }: { flow: Flow }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [displayName, setName] = useState('');
  const [token, setToken] = useState(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const navigate = useNavigate();
  useEffect(() => {
    // Bearer links stay in memory, never local/session storage or a server URL query.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  const needsEmail = ['login', 'register', 'forgot-password', 'resend-verification'].includes(flow);
  const needsPassword = ['login', 'register', 'reset-password'].includes(flow);
  const needsToken = ['verify-email', 'reset-password'].includes(flow);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    const body = flow === 'register' ? { email, password, displayName } : flow === 'login' ? { email, password }
      : flow === 'reset-password' ? { token, password } : flow === 'verify-email' ? { token } : { email };
    try {
      const response = await apiFetch<{ user?: AuthState; delivery?: 'local-preview' | 'queued' }>(`/api/auth/${flow}`, { method: 'POST', body: JSON.stringify(body) });
      if (flow === 'login' && response.user) { authStore.set(response.user); navigate('/orders', { replace: true }); }
      else if (needsToken) { setToken(''); setMessage(flow === 'verify-email' ? 'Email verificado. Pode entrar na conta.' : 'Senha alterada. Entre com a nova senha.'); }
      else setMessage(response.delivery === 'local-preview'
        ? 'Pedido aceite. Se o endereço for elegível, consulte a outbox local de autenticação; nenhum email é enviado.'
        : 'Pedido aceite para processamento, sem confirmação de entrega. Se o endereço for elegível e não receber instruções, peça um novo link.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Não foi possível concluir.'); }
    finally { setPassword(''); setBusy(false); }
  };
  return <section className={panel} key={flow}>
    <h1 className="text-2xl font-bold">{titles[flow]}</h1>
    {!message && <form onSubmit={submit} className="v3-space-y-4">
      {flow === 'register' && <label className="block">Nome<input className={input} required minLength={2} maxLength={80} autoComplete="name" value={displayName} onChange={(event) => setName(event.target.value)} /></label>}
      {needsEmail && <label className="block">Email<input className={input} type="email" required maxLength={254} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
      {needsPassword && <label className="block">Senha<input className={input} type="password" required minLength={12} maxLength={128} autoComplete={flow === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} /><span className="text-sm text-ink-muted">12–128 caracteres.</span></label>}
      {needsToken && !token && <p role="alert">Abra o link de verificação ou recuperação recebido no email.</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button className={button} disabled={busy || needsToken && !token}>{busy ? 'A processar…' : titles[flow]}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    {message && !needsToken && <button type="button" className={button} onClick={() => setMessage('')}>Fazer novo pedido</button>}
    <div className="flex flex-wrap gap-4 text-sm"><Link to="/login">Entrar</Link><Link to="/register">Criar conta</Link><Link to="/forgot-password">Esqueci a senha</Link><Link to="/resend-verification">Reenviar verificação</Link></div>
  </section>;
}
