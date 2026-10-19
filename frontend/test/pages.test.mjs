import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import App from '../src/App.tsx';
import { demoApiFetch, demoNotice } from '../src/demo.ts';
import { authStore, cartStore } from '../src/stores.ts';
import config from '../vite.config.ts';
import { themeStore } from '../src/Appearance.tsx';
import { themes } from '../src/themes.ts';

test('Pages catalog is fictional, contact-free, and uses the repository asset prefix', async () => {
  const { items } = await demoApiFetch('/api/categories', {}, '/loja-1/');
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.match(item.id, /^demo-/);
    assert.match(item.name, /demo/);
    assert.equal(item.imageUrl, '/loja-1/images/demo-category.svg');
    assert.equal(item.supplierContactsCount, 0);
    assert.deepEqual((await demoApiFetch('/api/categories/' + item.slug, {}, '/loja-1/')).item, item);
  }
  assert.doesNotMatch(JSON.stringify(items), /"(?:contacts|supplierName|email|telephone|whatsapp|notes)"\s*:/i);
  const identity = await demoApiFetch('/api/auth/me');
  assert.equal(identity.role, 'GUEST');
  assert.equal(identity.mode, 'demo');
  assert.equal(identity.mockAccountSwitchingEnabled, false);
  assert.deepEqual(await demoApiFetch('/api/appearance'), { theme: 'classic' });
  items[0].name = 'Changed locally';
  assert.notEqual((await demoApiFetch('/api/categories')).items[0].name, 'Changed locally');
});

test('Pages API rejects writes and private paths without ever using the network', async () => {
  const original = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('Network must not be used'); };
  try {
    await demoApiFetch('/api/categories');
    for (const path of ['/api/orders', '/api/orders/guess/delivery', '/api/admin/categories', '/api/admin/appearance', '/api/dev/email-outbox', '/uploads/private.png', '/api/categories/unknown', 'https://example.test/api/categories']) {
      await assert.rejects(demoApiFetch(path), { message: demoNotice });
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of ['/api/categories', '/api/orders', '/api/dev/session', '/api/dev/payments/guess/simulate', '/api/dev/email-outbox/retry/guess']) {
        await assert.rejects(demoApiFetch(path, { method, body: '{}' }), { message: demoNotice });
      }
    }
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = original; }
});

test('Pages UI blocks checkout, admin, orders and delivery in all themes even with stale ADMIN state', async () => {
  const render = (route) => renderToStaticMarkup(React.createElement(StaticRouter, { location: route }, React.createElement(App, { demo: true })));
  const originalFetch = globalThis.fetch;
  const loadTheme = async (theme) => {
    globalThis.fetch = async () => new Response(JSON.stringify({ theme }), { headers: { 'Content-Type': 'application/json' } });
    await themeStore.refresh();
  };
  try {
    authStore.set({ role: 'ADMIN', displayName: 'Stale identity', email: 'fixture@example.test', mode: 'development', mockAccountSwitchingEnabled: true });
    cartStore.set([{ categoryId: 'demo-tech', name: 'Tecnologia (demo)', priceCents: 1200 }]);
    for (const { id } of themes) {
      await loadTheme(id);
      for (const route of ['/checkout', '/admin', '/orders', '/orders/guess', '/success?orderId=guess', '/dev/email-outbox']) {
      const html = render(route);
      assert.match(html, /Modo demo/);
      assert.match(html, /Disponível apenas na aplicação local/);
      const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)?.[1];
      assert.ok(main);
      assert.doesNotMatch(main, /<input|<form|Simular pagamento|Guardar contacto|Ver email de entrega/);
      assert.doesNotMatch(html, /Simular pagamento|Guardar contacto|Ver email de entrega/);
      assert.doesNotMatch(html, />ADMIN<|href="\/admin"|href="\/orders"/);
      }
      assert.match(render('/cart'), /disabled=""[^>]*>Checkout indisponível no demo/);
    }
  } finally { await loadTheme('classic'); globalThis.fetch = originalFetch; authStore.set(null); cartStore.set([]); }
});

test('Pages configuration isolates public assets and environment variables from local development', async () => {
  const pages = config({ mode: 'pages', command: 'build' });
  const local = config({ mode: 'development', command: 'serve' });
  const production = config({ mode: 'production', command: 'build' });
  assert.equal(pages.base, '/loja-1/');
  assert.equal(pages.publicDir, 'pages-public');
  assert.deepEqual(pages.envPrefix, []);
  assert.equal(local.base, '/');
  assert.equal(production.base, '/');
  assert.equal(local.envPrefix, 'VITE_');
  assert.equal(local.server.proxy['/api'].target, 'http://127.0.0.1:3001');
  const assets = new URL('../pages-public/', import.meta.url);
  assert.deepEqual(await readdir(assets), ['images']);
  assert.deepEqual(await readdir(new URL('images/', assets)), ['demo-category.svg']);
  assert.doesNotMatch(await readFile(new URL('images/demo-category.svg', assets), 'utf8'), /<script|<foreignObject|href=|@/i);
});
