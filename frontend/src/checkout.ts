import type { CartItem } from './stores';

type DeliveredOrder = {
  id: string;
  orderNumber: string;
  customerEmail: string;
  status: string;
  totalCents: number;
  emailDelivery?: { status: string } | null;
};
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Attempt = { key: string; signature: string; orderId?: string };

export function createCheckout(api: Api, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  let attempt: Attempt | undefined;
  try {
    const saved = JSON.parse(storage?.getItem('supplier-checkout') || 'null');
    if (saved && typeof saved.key === 'string' && typeof saved.signature === 'string'
      && (saved.orderId === undefined || typeof saved.orderId === 'string')) attempt = saved;
  } catch { /* Start a new checkout when persisted state is unavailable. */ }
  const persist = () => { try { storage?.setItem('supplier-checkout', JSON.stringify(attempt)); } catch { /* Retain in memory. */ } };
  return {
    async complete(cart: CartItem[], email: string): Promise<DeliveredOrder> {
      if (!cart.length) throw new Error('Adicione pelo menos um item ao carrinho.');
      const ids = [...new Set(cart.map((item) => item.categoryId))].sort();
      const signature = JSON.stringify({ ids, email });
      if (attempt?.signature !== signature) attempt = { key: crypto.randomUUID(), signature };
      persist();
      if (!attempt.orderId) {
        const response = await api<{ order: DeliveredOrder }>('/api/orders', {
          method: 'POST',
          body: JSON.stringify({ customerEmail: email, checkoutKey: attempt.key, items: ids.map((categoryId) => ({ categoryId })) }),
        });
        attempt.orderId = response.order.id;
        persist();
      }
      const result = await api<{ order: DeliveredOrder }>('/api/dev/payments/' + encodeURIComponent(attempt.orderId) + '/simulate', { method: 'POST' });
      if (result.order.status !== 'PAID' || result.order.emailDelivery?.status !== 'SENT') {
        throw new Error('A entrega ainda não foi concluída. Tente novamente neste pedido.');
      }
      attempt = undefined;
      try { storage?.removeItem('supplier-checkout'); } catch { /* Completion remains valid. */ }
      return result.order;
    },
  };
}
