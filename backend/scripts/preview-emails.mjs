import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { renderPurchaseConfirmationEmail, renderSupplierDeliveryEmail } from '../dist/email-templates.js';

// Reserved example domains only. This preview never reads the database or sends an email.
const order = {
  id: 'demo-order', orderNumber: 'DEMO-2026-001', customerEmail: 'comprador@example.test',
  status: 'PAID', payment: { status: 'PAID' }, totalCents: 2400,
  items: [{ categoryId: 'demo-category', categoryName: 'Casa & Decoração', priceCents: 2400, quantity: 1 }],
};
const categories = [{
  id: 'demo-category', name: 'Casa & Decoração', contacts: [{
    supplierName: 'Atelier Exemplo — fornecedor fictício', email: 'fornecedor@example.test',
    website: 'https://supplier.example', notes: 'Dados inteiramente fictícios para pré-visualização.\nNão utilizar para compras reais.',
  }],
}];
const options = { appUrl: 'https://marketplace.example' };
const messages = {
  'purchase-confirmation': renderPurchaseConfirmationEmail(order, options),
  'supplier-delivery': renderSupplierDeliveryEmail(order, categories, options),
  'payment-pending': renderPurchaseConfirmationEmail({ ...order, status: 'PENDING', payment: { status: 'PENDING' } }, options),
};
const directory = await mkdtemp(path.join(tmpdir(), 'supplier-market-email-preview-'));
for (const [name, message] of Object.entries(messages)) {
  for (const [extension, body] of [['html', message.html], ['txt', message.text]]) {
    const file = path.join(directory, `${name}.${extension}`);
    await writeFile(file, body, 'utf8');
    console.log(file);
  }
}
console.log('Open the HTML files in a browser; the TXT files are their plain-text alternatives. All data is fictional.');
