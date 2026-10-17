import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPurchaseConfirmationEmail, renderSupplierDeliveryEmail, escapeEmailHtml } from '../src/email-templates.ts';
import { encodeEmailContent, decodeEmailContent } from '../src/email-content.ts';

const order = {
  id: 'order/with spaces', orderNumber: 'DEMO-123', customerEmail: 'buyer@example.test',
  status: 'PAID', payment: { status: 'PAID' }, totalCents: 2400,
  items: [{ categoryId: 'bought', categoryName: 'Home & Living', priceCents: 1200, quantity: 2 }],
};
const categories = [
  { id: 'bought', name: 'Home & Living', contacts: [{ supplierName: 'Fictional Supplier', email: 'purchased@example.test', website: 'https://supplier.example/?a=1&b=2', notes: 'First line\nSecond line' }] },
  { id: 'other', name: 'Not purchased', contacts: [{ supplierName: 'Excluded supplier', email: 'excluded@example.test' }] },
];

test('Email rendering: table-based inline design has readable plain-text counterparts and no external assets', () => {
  for (const message of [renderPurchaseConfirmationEmail(order), renderSupplierDeliveryEmail(order, categories)]) {
    assert.match(message.html, /^<!doctype html>/);
    assert.match(message.html, /lang="pt-PT"/);
    assert.match(message.html, /name="viewport"/);
    assert.match(message.html, /<table role="presentation" width="100%"/);
    assert.match(message.html, /max-width:600px/);
    assert.match(message.html, /\[if mso\]/);
    assert.match(message.html, /font-family:Arial,Helvetica,sans-serif/);
    assert.match(message.html, /<h1 style=/);
    assert.match(message.html, /<th scope="col"/);
    assert.doesNotMatch(message.html, /<(script|style|link|img)\b|class=|javascript:/i);
    assert.match(message.text, /Pedido: DEMO-123/);
    assert.match(message.text, /Home & Living × 2/);
    assert.match(message.text, /Total do pedido: 24,00/);
    assert.match(message.text, /Nenhuma mensagem externa foi enviada/);
    assert.doesNotMatch(message.text, /<table|<br>|&amp;/);
  }
});

test('Email rendering: all dynamic HTML fields are escaped while text remains readable', () => {
  const malicious = `<script>alert("x")</script> & 'quoted'`;
  const dangerousOrder = { ...order, orderNumber: malicious, customerEmail: malicious, items: [{ ...order.items[0], categoryName: malicious }] };
  const dangerousCategories = [{ id: 'bought', name: malicious, contacts: [{ supplierName: malicious, email: malicious, telephone: malicious, whatsapp: malicious, website: malicious, notes: malicious + '\nnext line' }] }];
  const delivery = renderSupplierDeliveryEmail(dangerousOrder, dangerousCategories);
  assert.equal(escapeEmailHtml(malicious), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;');
  assert.ok(delivery.html.split(escapeEmailHtml(malicious)).length >= 10);
  assert.match(delivery.html, /&#39;quoted&#39;<br>next line/);
  assert.doesNotMatch(delivery.html, /<script|onclick=|href="javascript:/i);
  assert.ok(delivery.text.includes(malicious));
  assert.match(delivery.text, /\nnext line/);
  const confirmation = renderPurchaseConfirmationEmail(dangerousOrder);
  assert.ok(confirmation.html.includes(escapeEmailHtml(malicious)));
  assert.doesNotMatch(confirmation.html, /<script/i);
  assert.doesNotMatch(renderPurchaseConfirmationEmail({ ...order, orderNumber: 'safe\r\nBcc: injected' }).subject, /[\r\n]/);
});

test('Email links: only absolute HTTPS links without credentials are emitted; optional CTA preserves base paths', () => {
  for (const appUrl of [undefined, 'http://localhost:5173', '/orders', 'javascript:alert(1)', 'https://user:secret@marketplace.example', 'https://marketplace.example\n/injected']) {
    assert.doesNotMatch(renderPurchaseConfirmationEmail(order, { appUrl }).html, /href=/);
  }
  const options = { appUrl: 'https://marketplace.example/shop/?query=1#hash' };
  const message = renderSupplierDeliveryEmail(order, categories, options);
  assert.match(message.html, /href="https:\/\/marketplace.example\/shop\/orders\/order%2Fwith%20spaces"/);
  assert.match(message.text, /Ver pedido: https:\/\/marketplace.example\/shop\/orders\/order%2Fwith%20spaces/);
  assert.match(message.html, /href="https:\/\/supplier.example\/\?a=1&amp;b=2"/);
  assert.ok([...message.html.matchAll(/href="([^"]*)"/g)].every((match) => match[1].startsWith('https://')));
  for (const website of ['http://supplier.example', 'javascript:alert(1)', 'data:text/html,test', 'https://user:password@supplier.example']) {
    const rendered = renderSupplierDeliveryEmail(order, [{ ...categories[0], contacts: [{ ...categories[0].contacts[0], website }] }]);
    assert.doesNotMatch(rendered.html, /href=/);
    assert.ok(rendered.text.includes(website));
  }
});

test('Email privacy: confirmations never inspect or contain contacts regardless of payment status', () => {
  for (const [status, payment] of [['PENDING', { status: 'PENDING' }], ['FAILED', { status: 'FAILED' }], ['CANCELLED', { status: 'CANCELLED' }], ['PAID', null], ['PAID', { status: 'PENDING' }], ['PENDING', { status: 'PAID' }], ['PAID', { status: 'PAID' }]]) {
    const input = { ...order, status, payment, get contacts() { throw new Error('Must not read contacts'); } };
    const message = renderPurchaseConfirmationEmail(input);
    assert.doesNotMatch(message.html + message.text, /purchased@example.test|excluded@example.test/);
    if (status !== 'PAID' || payment?.status !== 'PAID') {
      assert.doesNotMatch(message.subject, /Compra confirmada/);
      assert.match(message.text, /pagamento não está confirmado/);
      assert.throws(() => renderSupplierDeliveryEmail(input, { filter() { throw new Error('Supplier data inspected too early'); } }), /Contacts require a verified paid order and payment/);
    }
  }
});

test('Email privacy: verified delivery includes only purchased category contacts in both representations', () => {
  const message = renderSupplierDeliveryEmail(order, categories);
  for (const body of [message.html, message.text]) {
    assert.match(body, /purchased@example.test/);
    assert.doesNotMatch(body, /excluded@example.test|Excluded supplier|Not purchased/);
  }
  const empty = renderSupplierDeliveryEmail(order, [{ ...categories[0], contacts: [] }]);
  assert.match(empty.html, /Não existem contactos disponíveis/);
  assert.match(empty.text, /Não existem contactos disponíveis/);
});

test('Email persistence: both alternatives share one body; historical text and corrupt records fail safely', () => {
  const message = renderSupplierDeliveryEmail(order, categories);
  assert.deepEqual(decodeEmailContent(encodeEmailContent(message)), { body: message.text, html: message.html });
  const legacy = '<script>plain historical text</script>';
  assert.deepEqual(decodeEmailContent(legacy), { body: legacy });
  for (const suffix of ['{', 'null', '{"text":"fallback","html":42}']) {
    const decoded = decodeEmailContent('SUPPLIER_MARKET_EMAIL_V1\n' + suffix);
    assert.equal(decoded.html, undefined);
    assert.match(decoded.body, /não está disponível/);
  }
});
