import type { ThemeId } from './appearance.js';
import { renderPurchaseConfirmationEmail, renderSupplierDeliveryEmail, type EmailOrder } from './email-templates.js';

export const emailPreviewTypes = ['purchase-confirmation', 'supplier-delivery', 'payment-pending', 'payment-failed'] as const;
export type EmailPreviewType = typeof emailPreviewTypes[number];

// Shared fictional fixtures for admin and CLI previews. No orders, contacts or
// customer records are read, and these functions never invoke an email provider.
export function renderFictionalEmail(type: EmailPreviewType, theme: ThemeId) {
  const order: EmailOrder = {
    id: 'demo-order', orderNumber: 'DEMO-2026-001', customerEmail: 'comprador@example.test',
    status: 'PAID', payment: { status: 'PAID' }, totalCents: 2400,
    items: [{ categoryId: 'demo-category', categoryName: 'Casa & Decoração', priceCents: 2400, quantity: 1 }],
  };
  const options = { appUrl: 'https://marketplace.example', theme };
  if (type === 'supplier-delivery') return renderSupplierDeliveryEmail(order, [{
    id: 'demo-category', name: 'Casa & Decoração', contacts: [{
      supplierName: 'Atelier Exemplo — fornecedor fictício', email: 'fornecedor@example.test',
      website: 'https://supplier.example', notes: 'Dados inteiramente fictícios para pré-visualização.\nNão utilizar para compras reais.',
    }],
  }], options);
  if (type === 'payment-pending' || type === 'payment-failed') {
    order.status = type === 'payment-pending' ? 'PENDING' : 'FAILED';
    order.payment = { status: order.status };
  }
  return renderPurchaseConfirmationEmail(order, options);
}
