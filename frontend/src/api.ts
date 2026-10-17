export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // FormData must retain the browser-generated multipart boundary.
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(input, { ...init, credentials: 'include', headers });
  if (!response.ok) {
    let message = 'Request failed.';
    try {
      const payload = await response.json();
      if (typeof payload?.error === 'string') message = payload.error;
    } catch { /* Preserve a safe fallback for non-JSON responses. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}
