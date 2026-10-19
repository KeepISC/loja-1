import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { themeIds } from '../src/appearance.ts';
import { emailPreviewTypes, renderFictionalEmail } from '../src/email-preview.ts';
import { renderPurchaseConfirmationEmail, renderSupplierDeliveryEmail, escapeEmailHtml } from '../src/email-templates.ts';
import { encodeEmailContent, decodeEmailContent, previewEmailContent } from '../src/email-content.ts';

const order = {
  id: 'fixture/order', orderNumber: 'DEMO-BASELINE', customerEmail: 'buyer@example.test',
  status: 'PAID', payment: { status: 'PAID' }, totalCents: 2400,
  items: [{ categoryId: 'a', categoryName: 'Home & Living', priceCents: 1200, quantity: 2 }],
};
const categories = [{ id: 'a', name: 'Home & Living', contacts: [{
  supplierName: 'Fixture Supplier', email: 'supplier@example.test',
  website: 'https://supplier.example/?a=1&b=2', notes: 'First line\nSecond line',
}] }];
const options = { appUrl: 'https://marketplace.example/shop/' };
const cases = (theme) => ({
  confirmation: renderPurchaseConfirmationEmail(order, { ...options, theme }),
  delivery: renderSupplierDeliveryEmail(order, categories, { ...options, theme }),
  pending: renderPurchaseConfirmationEmail({ ...order, status: 'PENDING', payment: { status: 'PENDING' } }, { ...options, theme }),
  failed: renderPurchaseConfirmationEmail({ ...order, status: 'FAILED', payment: { status: 'FAILED' } }, { ...options, theme }),
});

test('Email themes: Classic HTML, text and subjects match pre-change snapshots exactly', () => {
  // Captured from the original renderer before implementation, including CTA and contacts.
  const hashes = {
    confirmation: '9e3c2b6e7ae27fdffcd20fc0f74e413c4c7bd6b1e00f79a9bd584eccd11daebc',
    delivery: '59ae36664cfd97cffc9007f9b58f15c4afc5a47abe3a7e5a1875cf95697d3118',
    pending: '3eccf5fc1cd7733a1f149b973741fa4545ae1da8d416a2789880536c85ba19ae',
    failed: '4ad307f67a07b86d122e0fd8bdc9afcff37633666b96f8b3024e9b95fce50742',
  };
  for (const theme of [undefined, 'classic']) {
    for (const [name, message] of Object.entries(cases(theme))) {
      assert.equal(createHash('sha256').update(JSON.stringify([message.subject, message.text, message.html])).digest('hex'), hashes[name], name);
    }
  }
});

for (const theme of themeIds) {
  for (const type of emailPreviewTypes) {
    test(`Email themes: ${theme} / ${type} uses email-safe markup and preserves content and URLs`, () => {
      const message = renderFictionalEmail(type, theme);
      const classic = renderFictionalEmail(type, 'classic');
      assert.equal(message.text, classic.text);
      assert.equal(message.subject, classic.subject);
      assert.match(message.html, /^<!doctype html>/);
      assert.match(message.html, /name="viewport"/);
      assert.match(message.html, /\[if mso\]/);
      assert.match(message.html, /max-width:600px/);
      assert.match(message.html, /<table role="presentation" width="100%"/);
      assert.match(message.html, /<th scope="col"/);
      assert.doesNotMatch(message.html, /<(script|style|link|img|iframe|form)\b|class=|var\(--|display\s*:\s*(?:grid|flex)|animation\s*:|@font-face|javascript:/i);
      assert.match(message.html, /font-family:(?:Arial|Georgia|'Arial Black')/);
      for (const value of ['DEMO-2026-001', 'comprador@example.test', 'Casa &amp; Decoração', '24,00']) assert.ok(message.html.includes(value), value);
      const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
      assert.deepEqual(hrefs(message.html), hrefs(classic.html));
      assert.ok(hrefs(message.html).every((url) => url.startsWith('https://')));
      if (type === 'supplier-delivery') {
        assert.match(message.html, /fornecedor@example.test/);
        assert.match(message.html, /<br>Não utilizar/);
      } else assert.doesNotMatch(message.html, /fornecedor@example.test/);
      if (type === 'payment-pending' || type === 'payment-failed') assert.doesNotMatch(message.subject, /Compra confirmada/);
      const stored = encodeEmailContent(message);
      assert.equal(previewEmailContent(stored, theme).html, message.html);
      assert.equal(decodeEmailContent(stored).html, message.html);
    });
  }
}

test('Email themes: designs have different header/content structures and appropriate brand palettes', () => {
  const minimal = renderFictionalEmail('supplier-delivery', 'minimal').html;
  const market = renderFictionalEmail('supplier-delivery', 'marketplace').html;
  const dark = renderFictionalEmail('supplier-delivery', 'dark').html;
  assert.match(minimal, /align="center" style="padding:40px 20px 32px/);
  assert.match(minimal, /font-family:Georgia,Times,serif;font-size:32px/);
  assert.match(minimal, /background-color:#f9f8f4/);
  assert.match(market, /bgcolor="#14253d"/);
  assert.match(market, /border-left:4px solid #164ca5/);
  assert.match(dark, /S\/M<\/td>/);
  assert.match(dark, /background-color:#0e1110/);
  assert.match(dark, /color:#141d10/);
  assert.match(dark, /background-color:#cbf273/);
  const tableCount = (html) => (html.match(/<table\b/g) ?? []).length;
  assert.ok(tableCount(market) > tableCount(minimal));
  assert.ok(tableCount(dark) > tableCount(minimal));
});

test('Email themes: normal text and action labels meet contrast requirements on their email surfaces', () => {
  const luminance = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const [ink, background] of [['#526074', '#f3f6fb'], ['#ffffff', '#254fb5'], ['#595e52', '#f1f0ea'], ['#304231', '#ffffff'], ['#4d5e77', '#e8eff7'], ['#ffffff', '#164ca5'], ['#a6baaa', '#222a25'], ['#141d10', '#cbf273']]) {
    const values = [luminance(ink), luminance(background)].sort((a, b) => a - b);
    assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `${ink} on ${background}`);
  }
});

test('Email themes: dynamic fields stay escaped and style-like text is never recolored', () => {
  const attack = `<script>alert("x")</script> & 'quoted' #254fb5 style="color:#182331"`;
  for (const theme of themeIds) {
    const input = { ...order, orderNumber: attack, customerEmail: attack, items: [{ ...order.items[0], categoryName: attack }] };
    const contacts = [{ id: 'a', name: attack, contacts: [{ supplierName: attack, email: attack, telephone: attack, whatsapp: attack, website: attack, notes: attack + '\nnext' }] }];
    const message = renderSupplierDeliveryEmail(input, contacts, { ...options, theme });
    assert.ok(message.html.split(escapeEmailHtml(attack)).length >= 10, theme);
    assert.doesNotMatch(message.html, /<script|onclick=|href="javascript:/i);
    assert.match(message.html, /&quot;<br>next/);
    assert.ok(message.text.includes(attack));
    for (const appUrl of ['javascript:alert(1)', 'https://user:secret@example.test', 'http://localhost:5173', 'https://example.test\n/unsafe']) {
      assert.doesNotMatch(renderPurchaseConfirmationEmail(order, { appUrl, theme }).html, /href=/);
    }
    for (const website of ['javascript:alert(1)', 'https://user:secret@example.test', 'data:text/html,unsafe']) {
      assert.doesNotMatch(renderSupplierDeliveryEmail(order, [{ id: 'a', name: 'Fixture', contacts: [{ supplierName: 'Fixture', email: 'supplier@example.test', website }] }], { theme }).html, /href=/);
    }
    for (const status of ['PENDING', 'FAILED', 'CANCELLED']) {
      const unpaid = { ...order, status, payment: { status } };
      assert.throws(() => renderSupplierDeliveryEmail(unpaid, { filter() { throw new Error('Contacts inspected'); } }, { theme }), /Contacts require/);
      assert.doesNotMatch(renderPurchaseConfirmationEmail(unpaid, { theme }).subject, /Compra confirmada/);
    }
  }
  assert.throws(() => renderPurchaseConfirmationEmail(order, { theme: 'unknown' }), /Invalid email theme/);
});

test('Email themes: saved and historical Classic messages re-render through the same renderer without changing snapshots', () => {
  for (const source of Object.values(cases('classic'))) {
    // Historical envelopes have no presentation metadata.
    const historical = encodeEmailContent({ subject: source.subject, html: source.html, text: source.text });
    const stored = encodeEmailContent(source);
    for (const theme of themeIds) {
      const expected = Object.values(cases(theme)).find((message) => message.subject === source.subject);
      assert.equal(previewEmailContent(stored, theme).html, expected.html);
      assert.equal(previewEmailContent(historical, theme).html, expected.html);
      assert.equal(previewEmailContent(stored, theme).body, source.text);
      assert.equal(decodeEmailContent(stored).html, source.html);
    }
  }
  assert.deepEqual(previewEmailContent('Historical <text>', 'dark'), { body: 'Historical <text>' });
  const unknown = encodeEmailContent({ text: 'Historical', html: '<p>Unrecognized legacy HTML</p>' });
  assert.equal(previewEmailContent(unknown, 'minimal').html, '<p>Unrecognized legacy HTML</p>');
  assert.throws(() => previewEmailContent(unknown, '__proto__'), /Invalid email theme/);
});
