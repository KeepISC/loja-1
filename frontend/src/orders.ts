export type Order = {
  id: string;
  orderNumber: string;
  customerEmail: string;
  status: string;
  totalCents: number;
  items?: Array<{ categoryId: string; categoryName: string; priceCents: number; quantity: number }>;
  payment?: { status: string } | null;
  emailDelivery?: { status: string } | null;
};

export function orderOutcome(order: Order) {
  if (order.status === 'PAID' && order.payment?.status === 'PAID') {
    return order.emailDelivery?.status === 'SENT' ? 'delivered' : 'delivery-pending';
  }
  return order.status === 'PENDING' ? 'payment-pending' : 'unavailable';
}

export async function loadOwnedOrder(api: <T>(url: string) => Promise<T>, id?: string | null) {
  if (!id) return null;
  return (await api<{ order: Order }>('/api/orders/' + encodeURIComponent(id))).order;
}
