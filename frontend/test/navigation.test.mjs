import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import postcss from 'postcss';
import App from '../src/App.tsx';
import { cartStore, authStore } from '../src/stores.ts';
import { cartFeedback } from '../src/cart-feedback.ts';
import { observeStickyHeader } from '../src/navigation.ts';

const item = { categoryId: 'nav-fixture', name: 'Fictional category', priceCents: 1200 };
const render = (route = '/', demo = false) => renderToStaticMarkup(React.createElement(StaticRouter, { location: route }, React.createElement(App, { demo })));

test('Navigation: one accessible cart icon and counter reuse confirmed state before auth loads and after add/remove', () => {
  try {
    authStore.set(null); cartStore.set([]); cartFeedback.clearMessage();
    let html = render();
    assert.match(html, /aria-label="Abrir carrinho, 0 itens"/);
    assert.equal((html.match(/data-cart-icon="true"/g) || []).length, 1);
    assert.equal((html.match(/class="market-cart-count"/g) || []).length, 1);
    assert.match(html, /aria-label="Menu de navegação" aria-expanded="false" aria-controls="market-navigation"/);
    assert.match(html, /id="market-navigation" aria-label="Navegação principal" data-open="false"/);
    assert.doesNotMatch(html, /backdrop-blur/); // A filtered ancestor would trap the mobile fixed cart inside the header.
    assert.equal(cartFeedback.add(item, { ownerDocument: { defaultView: null }, isConnected: false }), true);
    html = render();
    assert.match(html, /aria-label="Abrir carrinho, 1 item"/);
    assert.match(html, /class="market-cart-count" aria-hidden="true">1<\/span>/);
    cartStore.set([]);
    assert.match(render(), /aria-label="Abrir carrinho, 0 itens"/);
  } finally { authStore.set(null); cartStore.set([]); cartFeedback.clearMessage(); }
});

test('Navigation: shopping routes float the same cart; purchase/account screens keep it in the sticky header; demo remains restricted', () => {
  for (const route of ['/', '/categories/fixture']) assert.match(render(route), /<header data-floating-cart="true"/);
  for (const route of ['/cart', '/checkout', '/orders', '/orders/fixture', '/success', '/admin', '/dev/email-outbox']) {
    const html = render(route);
    assert.match(html, /<header data-floating-cart="false"/);
    assert.match(html, /class="market-cart-link bg-action text-action-ink"[^>]*href="\/cart"/);
  }
  const demo = render('/checkout', true);
  assert.match(demo, /Disponível apenas na aplicação local/);
  assert.doesNotMatch(demo, /Simular pagamento|href="\/admin"|href="\/orders"/);
});

test('Navigation: scroll shadow, measured anchor clearance and observer/listener cleanup follow the actual header size', () => {
  const listeners = new Map(), values = new Map([['--market-header-height', '80px']]);
  let height = 64.2, resized, observed, disconnected = false;
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe(element) { observed = element; }
    disconnect() { disconnected = true; }
  };
  const view = {
    scrollY: 0,
    addEventListener(type, handler, options) { listeners.set(type, { handler, options }); },
    removeEventListener(type, handler) { assert.equal(listeners.get(type).handler, handler); listeners.delete(type); },
  };
  const style = { getPropertyValue: (key) => values.get(key) || '', setProperty: (key, value) => values.set(key, value), removeProperty: (key) => values.delete(key) };
  const header = { dataset: {}, getBoundingClientRect: () => ({ height }), ownerDocument: { defaultView: view, documentElement: { style } } };
  try {
    const cleanup = observeStickyHeader(header);
    assert.equal(observed, header);
    assert.equal(values.get('--market-header-height'), '65px');
    assert.equal(header.dataset.scrolled, 'false');
    assert.deepEqual(listeners.get('scroll').options, { passive: true });
    view.scrollY = 200; listeners.get('scroll').handler();
    assert.equal(header.dataset.scrolled, 'true');
    height = 124; resized(); // Expanded mobile menu or a wrapped/zoomed header.
    assert.equal(values.get('--market-header-height'), '124px');
    height = 72; listeners.get('resize').handler();
    assert.equal(values.get('--market-header-height'), '72px');
    view.scrollY = 0; listeners.get('scroll').handler();
    assert.equal(header.dataset.scrolled, 'false');
    cleanup();
    assert.equal(disconnected, true);
    assert.equal(listeners.size, 0);
    assert.equal(values.get('--market-header-height'), '80px');
  } finally {
    if (previousObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousObserver;
  }
});

test('Navigation styles: mobile/desktop share theme tokens, safe clearance and the existing focus/reduced-motion rules', () => {
  const css = postcss.parse(readFileSync(new URL('../src/navigation.css', import.meta.url), 'utf8'));
  const properties = (selector, mobile) => {
    const result = {};
    css.walkRules((rule) => {
      if (rule.selector !== selector || Boolean(rule.parent.type === 'atrule') !== mobile) return;
      rule.walkDecls((declaration) => { result[declaration.prop] = declaration.value; });
    });
    return result;
  };
  assert.equal(properties('.market-header', false).position, 'sticky');
  assert.equal(properties('.market-header', false).top, '0');
  assert.match(properties('html', false)['scroll-padding-top'], /--market-header-height/);
  assert.equal(properties('.market-menu-toggle', false).display, 'none');
  assert.equal(properties('.market-menu-toggle', true)['min-height'], '44px');
  assert.equal(properties('.market-navigation', true).display, 'none');
  assert.equal(properties('.market-navigation[data-open="true"]', true).display, 'flex');
  const floating = properties('.market-header[data-floating-cart="true"] .market-cart-link', true);
  assert.equal(floating.position, 'fixed');
  assert.match(floating.bottom, /env\(safe-area-inset-bottom/);
  assert.equal(floating.height, '3.5rem');
  assert.equal(properties('.cart-feedback-notice', true).bottom, properties('.marketplace-shell', true)['padding-bottom']);
  assert.match(properties('.market-cart-count', false).color, /var\(--ink\)/);
  const base = readFileSync(new URL('../src/themes/base.css', import.meta.url), 'utf8');
  assert.match(base, /:focus-visible/);
  assert.match(base, /prefers-reduced-motion/);
});
