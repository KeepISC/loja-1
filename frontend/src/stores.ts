import { isDemo } from './deployment';

export type Role = 'ADMIN' | 'GUEST';
export type AuthState = {
  role: Role;
  displayName: string;
  email: string;
  mode?: string;
  mockAccountSwitchingEnabled?: boolean;
};
export type CartItem = { categoryId: string; name: string; priceCents: number };

type Update<T> = T | ((previous: T) => T);

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(update: Update<T>) {
      value = typeof update === 'function' ? (update as (previous: T) => T)(value) : update;
      listeners.forEach((listener) => listener());
    },
  };
}

function normalizeCart(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter((item): item is CartItem => {
    if (!item || typeof item.categoryId !== 'string' || !item.categoryId || typeof item.name !== 'string'
      || !Number.isSafeInteger(item.priceCents) || item.priceCents <= 0 || seen.has(item.categoryId)) return false;
    seen.add(item.categoryId);
    return true;
  }).map(({ categoryId, name, priceCents }) => ({ categoryId, name, priceCents }));
}

export function createCartStore(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  let initial: CartItem[] = [];
  try { initial = normalizeCart(JSON.parse(storage?.getItem('supplier-cart') || '[]')); } catch { /* Use an empty cart if storage is corrupt or unavailable. */ }
  const store = createStore(initial);
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    set(update: Update<CartItem[]>) {
      const next = normalizeCart(typeof update === 'function' ? update(store.getSnapshot()) : update);
      store.set(next);
      try { storage?.setItem('supplier-cart', JSON.stringify(next)); } catch { /* The current tab can still check out without storage. */ }
    },
  };
}

export const createAuthStore = () => createStore<AuthState | null>(null);

// One store per application, shared by the header, category buttons and checkout.
let browserStorage: Storage | undefined;
try { browserStorage = isDemo || typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* Storage may be disabled. */ }
export const cartStore = createCartStore(browserStorage);
export const authStore = createAuthStore();
