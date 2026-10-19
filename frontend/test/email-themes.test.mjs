import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { EmailThemePreview, emailPreviewUrl, emailTypes } from '../src/EmailThemePreview.tsx';
import { themeStore } from '../src/Appearance.tsx';
import { themes } from '../src/themes.ts';
import { demoApiFetch, demoNotice } from '../src/demo.ts';

const admin = { role: 'ADMIN', displayName: 'Mock Administrator', email: 'admin@local.test', mockAccountSwitchingEnabled: true };
const render = (auth) => renderToStaticMarkup(React.createElement(StaticRouter, null, React.createElement(EmailThemePreview, { auth })));

test('Email theme preview: admin sees every email type and preview follows unsaved storefront selection without applying it', () => {
  assert.equal(render(null), '');
  assert.equal(render({ ...admin, role: 'GUEST' }), '');
  assert.equal(render({ ...admin, mockAccountSwitchingEnabled: false }), '');
  const applied = themeStore.getSnapshot().applied;
  try {
    for (const theme of themes) {
      themeStore.preview(theme.id);
      const html = render(admin);
      assert.ok(html.includes(`<strong>${theme.name}</strong>`));
      for (const type of emailTypes) assert.ok(html.includes(`value="${type.id}"`));
      assert.match(html, /não envia emails nem altera/);
      assert.match(html, /role="status"/);
      assert.equal(themeStore.getSnapshot().applied, applied);
      const url = new URL(emailPreviewUrl(theme.id, 'supplier-delivery'), 'http://localhost');
      assert.equal(url.pathname, '/api/admin/email-preview');
      assert.equal(url.searchParams.get('theme'), theme.id);
      assert.equal(url.searchParams.get('type'), 'supplier-delivery');
    }
  } finally { themeStore.cancelPreview(); }
});

test('Email theme preview: public demo rejects all preview and outbox endpoints without any network call', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Must not access a backend'); };
  try {
    for (const { id } of themes) {
      for (const type of emailTypes) await assert.rejects(demoApiFetch(emailPreviewUrl(id, type.id)), { message: demoNotice });
      await assert.rejects(demoApiFetch('/api/dev/email-outbox?theme=' + id), { message: demoNotice });
    }
  } finally { globalThis.fetch = original; }
});
