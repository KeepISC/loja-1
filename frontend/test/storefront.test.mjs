import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import postcss from 'postcss';
import { StoreHome, StoreHeader, StoreCartPage, StoreProductPage } from '../src/Storefront.tsx';
import { localPreviewTheme, selectLocalPreview } from '../src/Appearance.tsx';
import { cartStore } from '../src/stores.ts';
import { defaultTheme, themes } from '../src/themes.ts';

const items = [
  { id: 'fiction-a', slug: 'first', name: 'Primeira categoria', description: 'Uma seleção fictícia', priceCents: 1200, imageUrl: '/loja-1/images/demo-category.svg', active: true },
  { id: 'fiction-b', slug: 'second', name: 'Segunda categoria', description: 'Outra seleção fictícia', priceCents: 900, imageUrl: '/loja-1/images/demo-category.svg', active: true },
];
const newThemes = ['minimal', 'marketplace', 'dark'];
const render = (component, props, route = '/') => renderToStaticMarkup(React.createElement(StaticRouter, { location: route }, React.createElement(component, props)));
const catalog = (theme, route, extra = {}) => render(StoreHome, { theme, demo: true, items, loading: false, error: null, ...extra }, route);

test('Storefront: Classic is the default and new themes have different compositions and product structures', () => {
  assert.equal(defaultTheme, 'classic');
  assert.deepEqual(themes.map(({ id }) => id), ['classic', ...newThemes]);
  const minimal = catalog('minimal');
  const market = catalog('marketplace');
  const dark = catalog('dark');
  assert.match(minimal, /sf-editorial/);
  assert.match(minimal, /sf-minimal-card-copy/);
  assert.doesNotMatch(minimal, /sf-market-layout|sf-dark-card/);
  assert.match(market, /sf-category-sidebar/);
  assert.match(market, /sf-product-meta/);
  assert.doesNotMatch(market, /sf-editorial|sf-dark-card/);
  assert.match(dark, /sf-category-tiles/);
  assert.match(dark, /sf-dark-card-bottom/);
  assert.doesNotMatch(dark, /sf-editorial|sf-market-layout/);
  for (const html of [minimal, market, dark]) {
    assert.equal((html.match(/data-cart-product="true"/g) ?? []).length, 2);
    assert.match(html, /data-cart-image="true"/);
    assert.match(html, /href="\/categories\/first"/);
    assert.match(html, /aria-label="Adicionar Primeira categoria ao carrinho"/);
    assert.doesNotMatch(html, /href="#sf-catalog"/); // Raw fragment links break HashRouter.
  }
});

test('Storefront: search, category filtering, price ordering and honest empty/loading/error states work in every new composition', () => {
  for (const theme of newThemes) {
    assert.doesNotMatch(catalog(theme, '/?q=ZZZ'), /data-cart-product="true"/);
    assert.match(catalog(theme, '/?q=ZZZ'), /Nenhuma categoria encontrada/);
    const filtered = catalog(theme, '/?category=second');
    assert.equal((filtered.match(/data-cart-product="true"/g) ?? []).length, 1);
    assert.doesNotMatch(filtered, /aria-label="Adicionar Primeira/);
    assert.match(catalog(theme, '/?q=OUTRA'), /aria-label="Adicionar Segunda/);
    const sorted = catalog(theme, '/?sort=price-asc');
    assert.ok(sorted.indexOf('aria-label="Adicionar Segunda') < sorted.indexOf('aria-label="Adicionar Primeira'));
    assert.match(catalog(theme, '/', { items: [], loading: true }), /role="status"/);
    assert.match(catalog(theme, '/', { items: [], error: 'Erro fictício <script>' }), /role="alert"[^>]*>Erro fictício &lt;script&gt;/);
    assert.doesNotMatch(catalog(theme, '/', { items: [] }), /sf-editorial-image/);
  }
});

test('Storefront: distinct headers keep a single animation destination and omit privileged demo navigation', () => {
  try {
    cartStore.set([{ categoryId: items[0].id, name: items[0].name, priceCents: 1200 }]);
    for (const theme of newThemes) {
      const header = render(StoreHeader, { theme, demo: true });
      assert.match(header, /aria-label="Abrir carrinho, 1 item"/);
      assert.equal((header.match(/data-cart-icon="true"/g) ?? []).length, 1);
      assert.match(header, /aria-haspopup="dialog"/);
      assert.match(header, /aria-expanded="false"/);
      assert.doesNotMatch(header, /href="\/admin"|href="\/orders"/);
      assert.match(render(StoreHeader, { theme, demo: false }), /href="\/admin"/);
    }
    assert.match(render(StoreHeader, { theme: 'marketplace', demo: true }), /role="search"/);
  } finally { cartStore.set([]); }
});

test('Storefront: changing presentation keeps cart membership and prices; demo checkout stays disabled', () => {
  const selection = items.map((item) => ({ categoryId: item.id, name: item.name, priceCents: item.priceCents }));
  try {
    cartStore.set(selection);
    for (const theme of newThemes) {
      const html = render(StoreCartPage, { theme, demo: true });
      assert.match(html, /disabled=""[^>]*>Checkout indisponível no demo/);
      assert.doesNotMatch(html, /href="\/checkout"/);
      assert.match(html, /21,00/);
      assert.match(html, /aria-label="Remover Primeira categoria"/);
      assert.match(catalog(theme), /aria-label="Primeira categoria no carrinho"/);
      assert.deepEqual(cartStore.getSnapshot(), selection);
      const local = render(StoreCartPage, { theme, demo: false });
      assert.match(local, /href="\/checkout"/);
      const details = render(StoreProductPage, { theme, demo: true, item: items[0], count: 0 });
      assert.match(details, /Compras e entrega de contactos desativadas/);
      assert.match(details, /data-cart-product="true"/);
      assert.match(details, /Primeira categoria no carrinho/);
    }
    cartStore.set([]);
    for (const theme of newThemes) assert.doesNotMatch(render(StoreCartPage, { theme, demo: false }), /href="\/checkout"/);
  } finally { cartStore.set([]); }
});

test('Storefront: local preview allows only loopback and validated IDs, switches without reload or storage access', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(localPreviewTheme({ hostname, search: '?theme=minimal' }), 'minimal');
    assert.equal(localPreviewTheme({ hostname, search: '?theme=unknown' }), null);
  }
  assert.equal(localPreviewTheme({ hostname: 'keepisc.github.io', search: '?theme=dark' }), null);
  assert.equal(localPreviewTheme({ hostname: 'localhost.evil.test', search: '?theme=dark' }), null);
  assert.equal(localPreviewTheme(), null);
  const original = globalThis.window;
  let replaced, events = 0;
  const browser = {
    location: { hostname: 'localhost', href: 'http://localhost:4173/loja-1/?theme=classic#/categories/first' },
    history: { state: { key: 'preserved' }, replaceState: (state, _, url) => { replaced = { state, url }; } },
    dispatchEvent: (event) => { assert.equal(event.type, 'storefront-preview'); events++; },
    get localStorage() { throw new Error('Must not access storage'); },
    get sessionStorage() { throw new Error('Must not access storage'); },
  };
  try {
    globalThis.window = browser;
    selectLocalPreview('dark');
    assert.equal(replaced.url, '/loja-1/?theme=dark#/categories/first');
    assert.deepEqual(replaced.state, { key: 'preserved' });
    assert.equal(events, 1);
    selectLocalPreview('unknown');
    assert.equal(events, 1);
    browser.location.hostname = 'keepisc.github.io';
    selectLocalPreview('minimal');
    assert.equal(events, 1);
    browser.location.hostname = 'localhost';
    selectLocalPreview(null);
    assert.equal(replaced.url, '/loja-1/#/categories/first');
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

test('Storefront: responsive compositions, independent modal presentation and reduced-motion rules compile', () => {
  const css = readFileSync(new URL('../src/storefront.css', import.meta.url), 'utf8');
  const parsed = postcss.parse(css);
  const breakpoints = [];
  parsed.walkAtRules('media', (rule) => breakpoints.push(rule.params));
  assert.ok(breakpoints.includes('(max-width: 767px)'));
  assert.ok(breakpoints.includes('(max-width: 359px)'));
  assert.ok(breakpoints.includes('(prefers-reduced-motion: reduce)'));
  const selectors = [];
  parsed.walkRules((rule) => { if (rule.parent.name !== 'keyframes') selectors.push(rule.selector); });
  for (const selector of selectors) assert.match(selector, /sf-|theme-|\[data-theme="dark"\]/);
  for (const theme of newThemes) assert.ok(css.includes('.sf-cart-dialog-' + theme));
  assert.ok(css.includes('100dvh'));
  assert.ok(css.includes('safe-area-inset-bottom'));
  assert.ok(css.includes('::backdrop'));
});
