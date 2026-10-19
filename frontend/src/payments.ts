import type { Order } from './orders';
import type { CartItem } from './stores';

export function hostedCheckoutUrl(value: string) {
  try { const url = new URL(value); if (url.origin === 'https://checkout.stripe.com' && !url.username && !url.password) return url.href; } catch { /* Fail closed on malformed provider redirects. */ }
  throw new Error('Destino de pagamento inválido. Atualize o pedido.');
}
export function paymentHeading(order: Order) {
  if (order.payment?.status === 'REFUNDED') return 'Pagamento reembolsado';
  if (order.payment?.status === 'CANCELLED') return 'Pagamento cancelado';
  if (order.payment?.status === 'FAILED') return 'Pagamento falhou ou sessão expirada';
  if (order.payment?.status === 'PROCESSING') return 'Pagamento em processamento';
  if (order.status === 'PAID' && order.payment?.status === 'PAID') return 'Pagamento confirmado';
  return 'Pagamento pendente';
}
export function settleStripeCart(order: Order, cart: CartItem[], storage?: Pick<Storage, 'getItem' | 'removeItem'>) {
  if (order.status !== 'PAID' || order.payment?.status !== 'PAID') return cart;
  try {
    const attempt = JSON.parse(storage?.getItem('supplier-checkout') || 'null');
    if (attempt?.orderId !== order.id) return cart;
    const ids = new Set(order.items?.map((item) => item.categoryId));
    storage?.removeItem('supplier-checkout');
    return cart.filter((item) => !ids.has(item.categoryId));
  } catch { return cart; }
}
