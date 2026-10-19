import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server.js';
import { AccountNavigation, AuthPage } from '../src/AuthPages.tsx';
import { SupplierContacts, AdminAccounts } from '../src/AccountManagement.tsx';
import { authStore } from '../src/stores.ts';
import { ApiError, createApiClient } from '../src/api.ts';
import { createCheckout } from '../src/checkout.ts';

const render = (component, props) => renderToStaticMarkup(React.createElement(StaticRouter, { location: '/' }, React.createElement(component, props)));
test('Auth UI provides each flow without persisting passwords or exposing a public role selector', () => {
  for (const flow of ['login', 'register', 'verify-email', 'forgot-password', 'reset-password', 'resend-verification']) {
    const html = render(AuthPage, { flow });
    assert.match(html, /<form/); assert.doesNotMatch(html, /<select|name="role"|type="hidden"/);
    if (['login', 'register', 'reset-password'].includes(flow)) assert.match(html, /type="password"[^>]*value=""/);
    if (['verify-email', 'reset-password'].includes(flow)) assert.match(html, /disabled=""/);
  }
});

test('Auth navigation and account pages distinguish Guest, Customer, Supplier, Admin and demo', () => {
  try {
    for (const role of ['GUEST', 'CUSTOMER', 'SUPPLIER', 'ADMIN']) {
      const auth = { role, displayName: 'Fixture', email: 'fixture@example.test', authenticated: role !== 'GUEST' };
      authStore.set(auth);
      const html = render(AccountNavigation, { demo: false });
      assert.equal(html.includes('href="/supplier"'), role === 'SUPPLIER');
      assert.equal(html.includes('href="/admin/accounts"'), role === 'ADMIN');
      assert.equal(html.includes('href="/login"'), role === 'GUEST');
      assert.match(html, /href="\/guest\/orders"/);
      if (role !== 'SUPPLIER') assert.doesNotMatch(render(SupplierContacts, { auth }), /<form/);
      if (role !== 'ADMIN') assert.doesNotMatch(render(AdminAccounts, { auth }), /<select/);
      assert.equal(render(AccountNavigation, { demo: true }), '');
    }
  } finally { authStore.set(null); }
});

test('Unauthorized responses invalidate frontend auth and retain status/code without retrying mutations', async () => {
  let invalidations = 0, writes = 0;
  const response = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const client = createApiClient(async (url) => {
    if (url === '/api/csrf') return response({ csrfToken: 'fictional-token' }, 200);
    writes++; return response({ error: 'Sign in again.', code: 'AUTH_EXPIRED' }, 401);
  }, () => { invalidations++; });
  await assert.rejects(client('/api/supplier/contacts/a', { method: 'PUT', body: '{}' }), (error) => error instanceof ApiError && error.status === 401 && error.code === 'AUTH_EXPIRED');
  assert.equal(writes, 1); assert.equal(invalidations, 1);
});

test('Account checkout uses authenticated endpoints and never reuses another identity’s pending checkout', async () => {
  let identity = 'first@example.test';
  const creations = [];
  const checkout = createCheckout(async (url, init) => {
    if (url.endsWith('/orders')) { creations.push({ url, body: JSON.parse(init.body) }); return { order: { id: 'fixture-' + creations.length } }; }
    throw new ApiError('Sign in again.', 401, 'AUTH_EXPIRED');
  }, undefined, () => identity);
  const cart = [{ categoryId: 'fixture', name: 'Fixture', priceCents: 1200 }];
  await assert.rejects(checkout.complete(cart, 'delivery@example.test'), /Sign in/);
  identity = 'second@example.test';
  await assert.rejects(checkout.complete(cart, 'delivery@example.test'), /Sign in/);
  assert.equal(creations.length, 2);
  assert.ok(creations.every((request) => request.url === '/api/account/orders'));
  assert.ok(creations[0].body.checkoutKey !== creations[1].body.checkoutKey);
});
