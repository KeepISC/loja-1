import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from '../src/App.tsx';
import { createCartStore, createAuthStore, cartStore, authStore } from '../src/stores.ts';
import { createCheckout } from '../src/checkout.ts';
import { apiFetch } from '../src/api.ts';
import { loadOwnedOrder, orderOutcome } from '../src/orders.ts';
import { CategoryForm, OrderSummary, EmailPreview, EmailHtmlPreview } from '../src/MarketplacePages.tsx';

const a = { categoryId: 'a', name: 'Category A', priceCents: 1600 };
const b = { categoryId: 'b', name: 'Category B', priceCents: 2400 };
const auth = (role) => ({ role, displayName: 'Mock ' + role, email: role.toLowerCase() + '@local.test', mode: 'development', mockAccountSwitchingEnabled: true });
const delivered = { id: 'owned-order', orderNumber: 'ORD-fixture', status: 'PAID', customerEmail: 'buyer@example.test', totalCents: 1600, emailDelivery: { status: 'SENT' } };
function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: (key) => items.delete(key) };
}

test('F01: independent cart subscribers share additions, removals and deduplicated totals', () => {
  const storage = memoryStorage(), cart = createCartStore(storage);
  const seenA = [], seenB = [];
  const unsubscribe = cart.subscribe(() => seenA.push(cart.getSnapshot().map((item) => item.categoryId)));
  cart.subscribe(() => seenB.push(cart.getSnapshot().map((item) => item.categoryId)));
  cart.set((previous) => [...previous, a]);
  cart.set((previous) => [...previous, b]);
  cart.set((previous) => [...previous, a]);
  assert.deepEqual(cart.getSnapshot(), [a, b]);
  assert.deepEqual(seenA, seenB);
  assert.equal(cart.getSnapshot().reduce((sum, item) => sum + item.priceCents, 0), 4000);
  assert.deepEqual(createCartStore(storage).getSnapshot(), [a, b]);
  unsubscribe();
  cart.set((previous) => previous.filter((item) => item.categoryId !== 'a'));
  assert.deepEqual(cart.getSnapshot(), [b]);
  assert.equal(seenA.length, 3);
  assert.equal(seenB.length, 4);
});

test('F01: malformed, duplicate and unavailable localStorage do not break cart', () => {
  for (const value of ['{bad', '{}', 'null']) assert.deepEqual(createCartStore(memoryStorage({ 'supplier-cart': value })).getSnapshot(), []);
  const stored = createCartStore(memoryStorage({ 'supplier-cart': JSON.stringify([a, a, { categoryId: 'bad', name: 'Bad', priceCents: -1 }]) }));
  assert.deepEqual(stored.getSnapshot(), [a]);
  const blocked = createCartStore({ getItem() { throw new Error('disabled'); }, setItem() { throw new Error('disabled'); } });
  blocked.set([a]);
  assert.deepEqual(blocked.getSnapshot(), [a]);
});

test('F02: shared auth notifies all consumers on reversible identity changes', () => {
  const store = createAuthStore(), header = [], page = [];
  store.subscribe(() => header.push(store.getSnapshot().role));
  store.subscribe(() => page.push(store.getSnapshot().role));
  for (const role of ['GUEST', 'ADMIN', 'GUEST']) store.set(auth(role));
  assert.deepEqual(header, ['GUEST', 'ADMIN', 'GUEST']);
  assert.deepEqual(header, page);
  assert.equal(store.getSnapshot().mockAccountSwitchingEnabled, true);
});

test('F01/F02: real header/cart/admin components read shared store snapshots', () => {
  const render = (route) => renderToStaticMarkup(React.createElement(StaticRouter, { location: route }, React.createElement(App)));
  try {
    authStore.set(auth('GUEST')); cartStore.set([a, b, a]);
    const cart = render('/cart');
    assert.match(cart, /aria-label="Abrir carrinho, 2 itens"/);
    assert.match(cart, /Category A/);
    assert.match(cart, /Category B/);
    assert.match(render('/admin'), /Acesso restrito/);
    authStore.set(auth('ADMIN'));
    const admin = render('/admin');
    assert.match(admin, /Mock ADMIN/);
    assert.doesNotMatch(admin, /Acesso restrito/);
    assert.match(admin, /Carregando painel administrativo/);
  } finally { authStore.set(null); cartStore.set([]); }
});

test('F07: normal checkout submits only category IDs and completes a delivered order', async () => {
  const calls = [], storage = memoryStorage();
  const api = async (url, options) => {
    calls.push([url, options]);
    return { order: url === '/api/orders' ? { ...delivered, status: 'PENDING' } : delivered };
  };
  const checkout = createCheckout(api, storage);
  assert.deepEqual(await checkout.complete([a, a], 'buyer@example.test'), delivered);
  const payload = JSON.parse(calls[0][1].body);
  assert.deepEqual(payload.items, [{ categoryId: 'a' }]);
  assert.equal(payload.totalCents, undefined);
  assert.match(payload.checkoutKey, /^[0-9a-f-]{36}$/);
  assert.equal(calls[1][0], '/api/dev/payments/owned-order/simulate');
  assert.equal(storage.getItem('supplier-checkout'), null);
});

test('F07: failed simulation resumes same order after navigation/reload', async () => {
  const calls = [], storage = memoryStorage();
  let fail = true;
  const api = async (url) => {
    calls.push(url);
    if (url !== '/api/orders' && fail) { fail = false; throw new Error('delivery failed'); }
    return { order: delivered };
  };
  await assert.rejects(createCheckout(api, storage).complete([a], 'buyer@example.test'), /delivery failed/);
  assert.equal(JSON.parse(storage.getItem('supplier-checkout')).orderId, delivered.id);
  assert.deepEqual(await createCheckout(api, storage).complete([a], 'buyer@example.test'), delivered);
  assert.equal(calls.filter((url) => url === '/api/orders').length, 1);
  assert.equal(calls.filter((url) => url.includes('/simulate')).length, 2);
});

test('F07: lost creation response reuses checkout key instead of creating a second purchase', async () => {
  const keys = [], storage = memoryStorage();
  let fail = true;
  const api = async (url, options) => {
    if (url === '/api/orders') {
      keys.push(JSON.parse(options.body).checkoutKey);
      if (fail) { fail = false; throw new Error('response lost'); }
    }
    return { order: delivered };
  };
  const checkout = createCheckout(api, storage);
  await assert.rejects(checkout.complete([a], 'buyer@example.test'), /response lost/);
  await checkout.complete([a], 'buyer@example.test');
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test('F07: pending delivery does not clear checkout state or report success', async () => {
  const storage = memoryStorage();
  const api = async () => ({ order: { ...delivered, emailDelivery: { status: 'FAILED' } } });
  await assert.rejects(createCheckout(api, storage).complete([a], 'buyer@example.test'), /entrega/);
  assert.equal(JSON.parse(storage.getItem('supplier-checkout')).orderId, delivered.id);
  await assert.rejects(createCheckout(api).complete([], 'buyer@example.test'), /pelo menos/);
});

test('F03/V02: category create/edit forms retain values and required fields', () => {
  const render = (category) => renderToStaticMarkup(React.createElement(CategoryForm, { category, onSave() {} }));
  const fresh = render(null);
  for (const label of ['Nova categoria', 'Nome', 'Slug', 'Descrição', 'Preço', 'Ativa', 'Guardar categoria']) assert.ok(fresh.includes(label), label);
  const edited = render({ id: 'a', name: 'Editable category', slug: 'editable', description: 'Fictional category description', priceCents: 1234, active: false });
  assert.match(edited, /Editar categoria/);
  assert.match(edited, /value="12.34"/);
  assert.match(edited, /Editable category/);
});

test('F03/V02: guest order routes and restricted outbox route are reachable', () => {
  const render = (location) => renderToStaticMarkup(React.createElement(StaticRouter, { location }, React.createElement(App)));
  try {
    authStore.set(auth('GUEST'));
    assert.match(render('/orders'), /Meus pedidos/);
    assert.match(render('/orders/owned-order'), /A verificar o pedido/);
    assert.match(render('/dev/email-outbox'), /Acesso restrito/);
    authStore.set(auth('ADMIN'));
    assert.match(render('/dev/email-outbox'), /Carregando emails/);
  } finally { authStore.set(null); }
});

test('F03/V02: image uploads retain multipart boundary and session credentials', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (url === '/api/csrf') return { ok: true, json: async () => ({ csrfToken: 'fictional-csrf-token' }) };
    calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    const image = new FormData(); image.append('image', new Blob(['fictional'], { type: 'image/png' }), 'fixture.png');
    await apiFetch('/api/admin/categories/a/image', { method: 'POST', body: image });
    assert.equal(calls[0].init.headers.has('Content-Type'), false);
    assert.equal(calls[0].init.body, image);
    assert.equal(calls[0].init.credentials, 'include');
    await apiFetch('/api/admin/categories', { method: 'POST', body: '{}' });
    assert.equal(calls[1].init.headers.get('Content-Type'), 'application/json');
  } finally { globalThis.fetch = original; }
});

test('F04/V03: direct or forged success visits do not assert a confirmed payment', () => {
  const render = (location) => renderToStaticMarkup(React.createElement(StaticRouter, { location }, React.createElement(App)));
  const missing = render('/success');
  assert.match(missing, /Nenhum pedido selecionado/);
  assert.doesNotMatch(missing, /Pagamento confirmado/);
  const forged = render({ pathname: '/success', state: { order: { ...delivered } } });
  assert.match(forged, /A verificar o pedido/);
  assert.doesNotMatch(forged, /Pagamento confirmado/);
  assert.match(render('/success?orderId=owned-order'), /A verificar o pedido/);
});

test('F04/V03: success status distinguishes payment, delivery and completed states', async () => {
  const pending = { ...delivered, status: 'PENDING', payment: { status: 'PENDING' }, emailDelivery: { status: 'NOT_SENT' } };
  const paid = { ...delivered, payment: { status: 'PAID' } };
  assert.equal(orderOutcome(pending), 'payment-pending');
  assert.equal(orderOutcome(paid), 'delivered');
  assert.equal(orderOutcome({ ...paid, emailDelivery: { status: 'FAILED' } }), 'delivery-pending');
  assert.equal(orderOutcome({ ...pending, status: 'CANCELLED' }), 'unavailable');
  const markup = (order) => renderToStaticMarkup(React.createElement(OrderSummary, { order }));
  assert.match(markup(pending), /Pagamento pendente/);
  assert.doesNotMatch(markup(pending), /Pagamento confirmado/);
  assert.match(markup(paid), /outbox local/);
  assert.match(markup({ ...paid, emailDelivery: { status: 'FAILED' } }), /entrega pendente/);
  assert.equal(await loadOwnedOrder(async () => { throw new Error('should not fetch'); }, null), null);
  let requested;
  assert.deepEqual(await loadOwnedOrder(async (url) => { requested = url; return { order: pending }; }, 'owned/id'), pending);
  assert.equal(requested, '/api/orders/owned%2Fid');
  await assert.rejects(loadOwnedOrder(async () => { throw new Error('Order not found.'); }, 'foreign'), /not found/);
});

test('F03/V02: contact email viewer renders untrusted content as escaped text', () => {
  const html = renderToStaticMarkup(React.createElement(EmailPreview, { delivery: { recipient: 'buyer@example.test', subject: 'Contacts', body: '<script>alert(1)</script>' } }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('Email viewer: HTML preview is opt-in and keeps the plain-text alternative visible by default', () => {
  const html = renderToStaticMarkup(React.createElement(EmailPreview, { delivery: { recipient: 'buyer@example.test', subject: 'Contacts', body: 'Readable text <unsafe>', html: '<h1>Designed email</h1>' } }));
  assert.match(html, /Ver versão HTML/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Readable text &lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<iframe|Designed email/);
});

test('Email viewer: HTML document is isolated in an opaque sandbox with remote resources and scripts blocked', () => {
  const html = renderToStaticMarkup(React.createElement(EmailHtmlPreview, { html: '<!doctype html><html><head><title>Email</title></head><body><h1>Preview</h1></body></html>' }));
  assert.match(html, /<iframe/);
  assert.match(html, /sandbox=""/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src &#x27;none&#x27;/);
  assert.match(html, /style-src &#x27;unsafe-inline&#x27;/);
  assert.match(html, /srcDoc="&lt;!doctype html&gt;/);
  assert.doesNotMatch(html, /allow-scripts|allow-same-origin|<h1>Preview/);
});
