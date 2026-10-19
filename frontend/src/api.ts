import { basePath, isDemo } from './deployment';
import { demoApiFetch } from './demo';

export function createApiClient(request: typeof fetch) {
  let csrfRequest: Promise<string> | undefined;
  const token = () => csrfRequest ??= request('/api/csrf', { credentials: 'include' }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok || typeof payload.csrfToken !== 'string') throw new Error('Não foi possível iniciar uma sessão segura.');
    return payload.csrfToken;
  }).catch((error) => { csrfRequest = undefined; throw error; });

  return async function api<T>(input: string, init: RequestInit = {}): Promise<T> {
    if (!input.startsWith('/api/')) throw new Error('API requests must use a same-origin API path.');
    const headers = new Headers(init.headers);
    // FormData must retain the browser-generated multipart boundary.
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes((init.method ?? 'GET').toUpperCase());
    if (unsafe) headers.set('X-CSRF-Token', await token());
    let response = await request(input, { ...init, headers, credentials: 'include' });
    if (!response.ok) {
      let payload: { error?: string; code?: string } = {};
      try { payload = await response.json(); } catch { /* Use a generic error for non-JSON responses. */ }
      // Only retry the explicit pre-mutation CSRF rejection, never payment/order failures.
      if (unsafe && response.status === 403 && payload.code === 'CSRF_INVALID') {
        csrfRequest = undefined;
        headers.set('X-CSRF-Token', await token());
        response = await request(input, { ...init, headers, credentials: 'include' });
      } else throw new Error(payload.error ?? 'Request failed.');
    }
    if (!response.ok) {
      let message = 'Request failed.';
      try { message = (await response.json()).error ?? message; } catch { /* Do not expose raw server responses. */ }
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  };
}

const localApi = createApiClient((input, init) => fetch(input, init));
export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  if (isDemo) return demoApiFetch<T>(input, init, basePath);
  return localApi<T>(input, init);
}
