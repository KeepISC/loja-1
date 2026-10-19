import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import postcss from 'postcss';
import postcssConfig from '../postcss.config.js';
import { createThemeStore, themes } from '../src/themes.ts';
import { AppearancePanel, themeStore } from '../src/Appearance.tsx';
import App from '../src/App.tsx';
import { authStore } from '../src/stores.ts';

const admin = { role: 'ADMIN', displayName: 'Mock Administrator', email: 'admin@local.test', mockAccountSwitchingEnabled: true };

test('Themes: preview is immediate, survives public refresh, and cancels without any write', async () => {
  const calls = [];
  const store = createThemeStore(async (url, init) => { calls.push([url, init]); return { theme: 'dark' }; });
  await store.refresh();
  store.preview('marketplace');
  assert.equal(store.getSnapshot().preview, 'marketplace');
  assert.equal(store.getSnapshot().applied, 'dark');
  await store.refresh();
  assert.equal(store.getSnapshot().preview, 'marketplace');
  store.cancelPreview();
  assert.equal(store.getSnapshot().preview, null);
  assert.equal(store.getSnapshot().applied, 'dark');
  store.preview('unrecognized-theme');
  assert.equal(store.getSnapshot().preview, null);
  assert.ok(calls.every(([url, init]) => url === '/api/appearance' && !init?.method));
});

test('Themes: apply saves through the admin API and a new visitor reads the shared choice', async () => {
  let saved = 'classic';
  const api = async (url, init) => {
    if (init?.method === 'PUT') {
      assert.equal(url, '/api/admin/appearance');
      saved = JSON.parse(init.body).theme;
    } else assert.equal(url, '/api/appearance');
    return { theme: saved };
  };
  const manager = createThemeStore(api);
  manager.preview('dark');
  await manager.apply('dark');
  assert.equal(manager.getSnapshot().applied, 'dark');
  assert.equal(manager.getSnapshot().preview, null);
  const visitorAfterReload = createThemeStore(api);
  await visitorAfterReload.refresh();
  assert.equal(visitorAfterReload.getSnapshot().applied, 'dark');
});

test('Themes: failed writes keep the last confirmed theme and allow preview cancellation', async () => {
  const store = createThemeStore(async () => { throw new Error('Forbidden or network failure'); });
  store.preview('dark');
  await store.apply('dark');
  assert.equal(store.getSnapshot().applied, 'classic');
  assert.equal(store.getSnapshot().preview, 'dark');
  assert.equal(store.getSnapshot().saving, false);
  assert.ok(store.getSnapshot().error);
  store.cancelPreview();
  assert.equal(store.getSnapshot().preview, null);
});

test('Themes: an older public read cannot undo a newly applied theme', async () => {
  let resolveRead;
  const store = createThemeStore(async (_url, init) => init?.method === 'PUT' ? { theme: 'marketplace' } : new Promise((resolve) => { resolveRead = resolve; }));
  const staleRead = store.refresh();
  await store.apply('marketplace');
  resolveRead({ theme: 'dark' }); await staleRead;
  assert.equal(store.getSnapshot().applied, 'marketplace');
});

test('Themes: ADMIN sees four scoped preview cards and a preview banner across marketplace routes', () => {
  const render = (auth) => renderToStaticMarkup(React.createElement(AppearancePanel, { auth }));
  assert.equal(render(null), '');
  assert.equal(render({ ...admin, role: 'GUEST' }), '');
  const html = render(admin);
  for (const theme of themes) {
    assert.ok(html.includes(theme.name));
    assert.ok(html.includes(`data-theme="${theme.id}"`));
    assert.ok(html.includes('Pré-visualizar ' + theme.name));
    assert.ok(html.includes('Aplicar ' + theme.name));
  }
  try {
    authStore.set(admin); themeStore.preview('dark');
    for (const route of ['/', '/cart', '/checkout', '/categories/fixture', '/admin']) {
      const page = renderToStaticMarkup(React.createElement(StaticRouter, { location: route }, React.createElement(App)));
      assert.match(page, /Pré-visualização:/);
      assert.match(page, /Dark/);
      assert.match(page, /Cancelar pré-visualização/);
    }
    authStore.set({ ...admin, role: 'GUEST' });
    const guest = renderToStaticMarkup(React.createElement(StaticRouter, { location: '/cart' }, React.createElement(App)));
    assert.doesNotMatch(guest, /Pré-visualização:|Cancelar pré-visualização|Aplicar tema/);
  } finally { authStore.set(null); themeStore.cancelPreview(); }
});

const tokensFor = (id) => Object.fromEntries([...readFileSync(new URL(`../src/themes/${id}.css`, import.meta.url), 'utf8').matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const luminance = (value) => value.trim().split(/\s+/).map(Number).map((channel) => { const v = channel / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => { const first = luminance(a), second = luminance(b); return (Math.max(first, second) + .05) / (Math.min(first, second) + .05); };

test('Themes: all palettes provide readable normal text, action labels, states, and focus indicators', () => {
  for (const { id } of themes) {
    const tokens = tokensFor(id);
    for (const [text, background] of [['ink', 'canvas'], ['ink-secondary', 'surface'], ['ink-muted', 'surface'], ['ink-muted', 'muted'], ['accent', 'canvas'], ['action-ink', 'action'], ['success-ink', 'success-bg'], ['danger-ink', 'danger-bg'], ['warning-ink', 'warning-bg']]) {
      assert.ok(contrast(tokens[text], tokens[background]) >= 4.5, `${id}: ${text} on ${background}`);
    }
    assert.ok(contrast(tokens.focus, tokens.surface) >= 3, id + ' focus');
    assert.ok(contrast(tokens['line-strong'], tokens.surface) >= 3, id + ' control boundary');
    for (const hex of tokens['hero-gradient'].match(/#[0-9a-f]{6}/g)) {
      const rgb = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)).join(' ');
      assert.ok(contrast(tokens['hero-ink'], rgb) >= 4.5, id + ' hero text');
    }
    for (const key of ['font-body', 'font-heading', 'radius-panel', 'shadow-panel', 'shadow-hover', 'accent-hover']) assert.ok(tokens[key], id + ': ' + key);
  }
});

test('Themes: shared styles and semantic Tailwind utilities compile without Vite subprocesses', async () => {
  const { default: tailwindPostcss } = await import('@tailwindcss/postcss');
  const cssUrl = new URL('../src/index.css', import.meta.url);
  const css = readFileSync(cssUrl, 'utf8');
  const compiled = await postcss([tailwindPostcss({ ...postcssConfig.plugins['@tailwindcss/postcss'], optimize: false })])
    .process(css, { from: fileURLToPath(cssUrl) });
  for (const name of ['classic', 'minimal', 'dark', 'marketplace', '.theme-preview', '.bg-action', '.bg-surface', '.text-ink', '.border-line', '.v3-space-y-4']) assert.ok(compiled.css.includes(name), name);
  assert.doesNotMatch(compiled.css, /<alpha-value>|@config\s|@source\s|@utility\s|--value\(/);
  for (const [selector, token] of [['.bg-action', '--action'], ['.bg-surface', '--surface'], ['.text-ink', '--ink'], ['.border-line', '--line'], ['.rounded-lg', '--radius-control'], ['.shadow-sm', '--shadow-panel']]) {
    let found = false;
    compiled.root.walkRules(selector, (rule) => { found ||= rule.toString().includes(`var(${token})`); });
    assert.ok(found, `${selector} retains scoped theme token ${token}`);
  }
  for (const size of [2, 3, 4, 5, 6]) {
    let found = false;
    compiled.root.walkRules(`.v3-space-y-${size} > :not([hidden]) ~ :not([hidden])`, (rule) => {
      const declarations = Object.fromEntries(rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]));
      assert.equal(declarations['margin-top'].replace(/\s/g, ''), `calc(${size}*0.25rem)`);
      assert.equal(declarations['margin-bottom'], '0');
      found = true;
    });
    assert.ok(found, `v3 spacing behavior for ${size}`);
  }
  let fontPreserved = false;
  compiled.root.walkRules('.font-sans', (rule) => { fontPreserved ||= rule.toString().includes('ui-sans-serif'); });
  assert.ok(fontPreserved, 'v3 default sans font stack is preserved');
  assert.ok(compiled.css.includes(':focus-visible'));
  assert.ok(compiled.css.includes('prefers-reduced-motion'));
});
