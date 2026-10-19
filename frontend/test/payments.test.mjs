import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedCheckoutUrl, paymentHeading, settleStripeCart } from '../src/payments.ts';
import { createCheckout } from '../src/checkout.ts';

test('Stripe frontend resumes the same owned order, redirects only to hosted Checkout and never simulates payment', async () => {
  let creations = 0, sessions = 0, saved;
  const api = async (path, init) => {
    assert.ok(!path.includes('/simulate'));
    if (path === '/api/orders') { creations++; assert.deepEqual(Object.keys(JSON.parse(init.body)).sort(), ['checkoutKey', 'customerEmail', 'items']); return { order: { id: 'owned-fixture' } }; }
    if (path.endsWith('/checkout')) { sessions++; assert.equal(init.body, '{}'); return { url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' }; }
    return { order: { id: 'owned-fixture', status: 'PENDING' } };
  };
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; }, removeItem: () => { saved = undefined; } };
  const cart = [{ categoryId: 'fixture', name: 'Fixture', priceCents: 1 }];
  const first = await createCheckout(api, storage).complete(cart, 'fixture@example.test', 'STRIPE');
  assert.equal(hostedCheckoutUrl(first.checkoutUrl), first.checkoutUrl);
  const resumed = createCheckout(api, storage);
  await resumed.complete(cart, 'fixture@example.test', 'STRIPE');
  assert.equal(creations, 1); assert.equal(sessions, 2); assert.ok(saved);
  saved = undefined; // Confirmation removed the durable attempt in this same tab.
  await resumed.complete(cart, 'fixture@example.test', 'STRIPE'); assert.equal(creations, 2);
  for (const unsafe of ['http://checkout.stripe.com/x', 'https://checkout.stripe.com.attacker.test/x', 'https://user@checkout.stripe.com/x', '//attacker.test', 'javascript:alert(1)']) assert.throws(() => hostedCheckoutUrl(unsafe));
});

test('Payment headings require stored confirmation; only a matching paid order removes its purchased cart items', () => {
  const base = { id: 'fixture', status: 'PENDING', payment: { status: 'PENDING', provider: 'STRIPE' }, items: [{ categoryId: 'bought' }] };
  const cart = [{ categoryId: 'bought' }, { categoryId: 'new-item' }]; let removed = 0;
  const storage = { getItem: () => JSON.stringify({ orderId: 'fixture' }), removeItem: () => { removed++; } };
  for (const status of ['PENDING', 'PROCESSING', 'FAILED', 'CANCELLED', 'REFUNDED']) {
    const order = { ...base, payment: { ...base.payment, status } };
    assert.ok(!paymentHeading(order).includes('confirmado')); assert.deepEqual(settleStripeCart(order, cart, storage), cart);
  }
  const paid = { ...base, status: 'PAID', payment: { ...base.payment, status: 'PAID' } };
  assert.ok(paymentHeading(paid).includes('confirmado'));
  assert.deepEqual(settleStripeCart({ ...paid, id: 'other-order' }, cart, storage), cart);
  assert.deepEqual(settleStripeCart(paid, cart, storage), [{ categoryId: 'new-item' }]); assert.equal(removed, 1);
});
