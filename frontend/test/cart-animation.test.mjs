import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCartStore, cartStore } from '../src/stores.ts';
import { cartFeedback, cartCountForDisplay, createCartFeedback } from '../src/cart-feedback.ts';
import { cartFlightDuration, cartFlightFrames, flyToCart, pulseCartButton } from '../src/cart-animation.ts';
import { AddToCartButton, CartFeedbackNotice } from '../src/CartFeedback.tsx';

const a = { categoryId: 'animation-a', name: 'Fictional category A', priceCents: 1200 };
const b = { categoryId: 'animation-b', name: 'Fictional category B', priceCents: 1500 };
const button = {};
function feedbackFixture() {
  const cart = createCartStore(), flights = [], visual = { bounces: 0, pulses: 0 };
  const feedback = createCartFeedback(cart, {
    fly(_button, complete) { flights.push(complete); return true; },
    bounce() { visual.bounces++; }, pulse() { visual.pulses++; },
  });
  return { cart, feedback, flights, visual, count: () => cartCountForDisplay(cart.getSnapshot(), feedback.getSnapshot().pendingIds) };
}

test('Cart animation: commits immediately, rejects rapid duplicates, and updates the visible counter once on arrival', () => {
  const fixture = feedbackFixture();
  assert.equal(fixture.feedback.add(a, button), true);
  assert.deepEqual(fixture.cart.getSnapshot(), [a]);
  assert.equal(fixture.count(), 0);
  assert.equal(fixture.feedback.getSnapshot().message, '');
  assert.equal(fixture.feedback.add(a, button), false);
  assert.equal(fixture.flights.length, 1);
  fixture.flights[0](true);
  fixture.flights[0](true);
  assert.equal(fixture.count(), 1);
  assert.equal(fixture.visual.bounces, 1);
  assert.equal(fixture.feedback.getSnapshot().sequence, 1);
  assert.match(fixture.feedback.getSnapshot().message, /Fictional category A adicionado/);
  assert.equal(fixture.feedback.add(a, button), false);
  assert.equal(fixture.cart.getSnapshot().length, 1);
  fixture.cart.set([]);
  assert.equal(fixture.feedback.add(a, button), true);
  fixture.flights[1](true);
  assert.equal(fixture.cart.getSnapshot().length, 1);
});

test('Cart animation: independent flights settle correctly and removed products do not receive success feedback', () => {
  const fixture = feedbackFixture();
  fixture.feedback.add(a, button); fixture.feedback.add(b, button);
  assert.equal(fixture.cart.getSnapshot().length, 2);
  assert.equal(fixture.count(), 0);
  fixture.flights[1](true);
  assert.equal(fixture.count(), 1);
  fixture.cart.set((items) => items.filter((item) => item.categoryId !== a.categoryId));
  fixture.flights[0](true);
  assert.equal(fixture.count(), 1);
  assert.equal(fixture.visual.bounces, 1);
  assert.equal(fixture.feedback.getSnapshot().lastAddedId, b.categoryId);
  assert.deepEqual(fixture.feedback.getSnapshot().pendingIds, []);
});

test('Cart animation: rejected or failed state updates never animate or announce success', () => {
  const fixture = feedbackFixture();
  assert.equal(fixture.feedback.add({ ...a, priceCents: -1 }, button), false);
  assert.equal(fixture.flights.length, 0);
  assert.equal(fixture.feedback.getSnapshot().message, '');
  const failing = createCartFeedback({ getSnapshot: () => [], set() { throw new Error('Update failed'); } }, {
    fly() { throw new Error('Must not animate'); }, pulse() { assert.fail('Must not pulse'); }, bounce() { assert.fail('Must not bounce'); },
  });
  assert.equal(failing.add(a, button), false);
  assert.equal(failing.getSnapshot().message, '');
});

test('Cart animation: missing capabilities and cancelled flights use button feedback without changing cart quantity', () => {
  for (const fly of [() => false, () => { throw new Error('Animation unavailable'); }]) {
    const cart = createCartStore(); let pulses = 0;
    const feedback = createCartFeedback(cart, { fly, pulse() { pulses++; }, bounce() { assert.fail('No flight arrived'); } });
    assert.equal(feedback.add(a, button), true);
    assert.equal(cartCountForDisplay(cart.getSnapshot(), feedback.getSnapshot().pendingIds), 1);
    assert.equal(pulses, 1);
    assert.ok(feedback.getSnapshot().message);
  }
  const fixture = feedbackFixture(); fixture.feedback.add(a, button); fixture.flights[0](false);
  assert.equal(fixture.visual.pulses, 1);
  assert.equal(fixture.visual.bounces, 0);
  assert.equal(fixture.count(), 1);
});

test('Cart animation: the 620 ms transform-only trajectory curves above the straight path and ends at the cart', () => {
  const frames = cartFlightFrames({ x: 100, y: 500 }, { x: 900, y: 40 });
  assert.ok(cartFlightDuration >= 500 && cartFlightDuration <= 700);
  assert.match(frames[0].transform, /translate3d\(0px, 0px, 0\) scale\(1\)/);
  assert.match(frames.at(-1).transform, /translate3d\(800px, -460px, 0\) scale\(0.25\)/);
  const midpointY = Number(frames[10].transform.match(/, ([-\d.]+)px,/)[1]);
  assert.ok(midpointY < -230, 'Arc must rise above the straight-line midpoint');
  for (const frame of frames) {
    assert.deepEqual(Object.keys(frame).sort(), ['offset', 'opacity', 'transform']);
    assert.ok(500 + Number(frame.transform.match(/, ([-\d.]+)px,/)[1]) >= 28, 'Thumbnail must not arc outside the top of the viewport');
  }
});

function browserFixture({ mobile = false, reduced = false } = {}) {
  const listeners = new Map(), timers = new Map(), motionListeners = new Set();
  const motion = { matches: reduced, addEventListener(_type, handler) { motionListeners.add(handler); }, removeEventListener(_type, handler) { motionListeners.delete(handler); } };
  const view = {
    innerWidth: mobile ? 390 : 1200, innerHeight: 844,
    matchMedia: () => motion,
    setTimeout(handler) { timers.set(1, handler); return 1; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener(type) { listeners.delete(type); },
  };
  let finishAnimation, cancelAnimation;
  const animation = { finished: new Promise((resolve, reject) => { finishAnimation = resolve; cancelAnimation = reject; }), cancel() { cancelAnimation(new Error('Cancelled')); } };
  const capture = { copies: 0, removed: 0, frames: null, options: null };
  const target = { isConnected: true, getBoundingClientRect: () => ({ left: mobile ? 320 : 1000, top: 20, width: 20, height: 20 }) };
  const image = { complete: true, naturalWidth: 640, currentSrc: '/loja-1/images/demo-category.svg', animate() {}, getBoundingClientRect: () => ({ left: 20, top: 200, width: 140, height: 100 }) };
  const copy = { style: {}, setAttribute() {}, remove() { capture.removed++; }, animate(frames, options) { capture.frames = frames; capture.options = options; return animation; } };
  const doc = { defaultView: view, querySelector: () => target, createElement: () => copy, body: { appendChild() { capture.copies++; } } };
  const source = { ownerDocument: doc, isConnected: true, closest: () => ({ querySelector: () => image }), animate() { assert.fail('Reduced-motion fallback must not animate'); } };
  return { source, image, target, doc, motion, motionListeners, view, listeners, timers, capture, finishAnimation };
}

test('Cart animation: desktop/mobile flights clean up their image, timers and listeners after landing', async () => {
  for (const mobile of [false, true]) {
    const fixture = browserFixture({ mobile }), landings = [];
    assert.equal(flyToCart(fixture.source, (arrived) => landings.push(arrived)), true);
    assert.equal(fixture.capture.copies, 1);
    assert.equal(fixture.capture.options.duration, cartFlightDuration);
    fixture.finishAnimation(); await Promise.resolve();
    assert.deepEqual(landings, [true]);
    assert.equal(fixture.capture.removed, 1);
    assert.equal(fixture.timers.size, 0);
    assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.motionListeners.size, 0);
  }
});

test('Cart animation: the mobile flight lands on the floating icon and bounces that same visible target', async () => {
  const fixture = browserFixture({ mobile: true });
  fixture.target.getBoundingClientRect = () => ({ left: 336, top: 780, width: 20, height: 20 });
  let bounces = 0;
  fixture.target.ownerDocument = fixture.doc;
  fixture.target.animate = () => { bounces++; return { finished: Promise.resolve(), cancel() {} }; };
  const { bounceCart } = await import('../src/cart-animation.ts');
  assert.equal(flyToCart(fixture.source, (arrived) => { if (arrived) bounceCart(fixture.source); }), true);
  assert.equal(fixture.doc.querySelector('[data-cart-icon]'), fixture.target);
  assert.match(fixture.capture.frames.at(-1).transform, /translate3d\(256px, 540px, 0\) scale\(0.25\)/);
  fixture.finishAnimation(); await Promise.resolve();
  assert.equal(bounces, 1);
  assert.equal(fixture.capture.removed, 1);
});

test('Cart animation: reduced motion, missing images, missing icons and offscreen targets skip the flying image', () => {
  const reduced = browserFixture({ reduced: true });
  assert.equal(flyToCart(reduced.source, () => assert.fail('No flight')), false);
  pulseCartButton(reduced.source);
  assert.equal(reduced.capture.copies, 0);
  for (const modify of [
    (fixture) => { fixture.image.naturalWidth = 0; },
    (fixture) => { fixture.source.closest = () => null; },
    (fixture) => { fixture.doc.querySelector = () => null; },
    (fixture) => { fixture.target.getBoundingClientRect = () => ({ left: 0, top: -50, width: 20, height: 20 }); },
  ]) {
    const fixture = browserFixture(); modify(fixture);
    assert.equal(flyToCart(fixture.source, () => assert.fail('No flight')), false);
    assert.equal(fixture.capture.copies, 0);
  }
});

test('Cart animation: motion preference changes, scrolling and watchdog cancellation settle exactly once', async () => {
  for (const reason of ['motion', 'scroll', 'watchdog']) {
    const fixture = browserFixture(), landings = [];
    flyToCart(fixture.source, (arrived) => landings.push(arrived));
    if (reason === 'motion') { fixture.motion.matches = true; [...fixture.motionListeners][0](); }
    if (reason === 'scroll') fixture.listeners.get('scroll')();
    if (reason === 'watchdog') [...fixture.timers.values()][0]();
    await Promise.resolve();
    assert.deepEqual(landings, [false]);
    assert.equal(fixture.capture.removed, 1);
    assert.equal(fixture.timers.size, 0);
    assert.equal(fixture.listeners.size, 0);
    assert.equal(fixture.motionListeners.size, 0);
  }
});

test('Cart animation: buttons reflect confirmed membership and accessible feedback does not take focus', () => {
  try {
    cartStore.set([]); cartFeedback.clearMessage();
    const category = { id: a.categoryId, name: a.name, priceCents: a.priceCents };
    const render = () => renderToStaticMarkup(React.createElement(AddToCartButton, { category }));
    assert.doesNotMatch(render(), /disabled=""/);
    assert.equal(cartFeedback.add(a, { ownerDocument: { defaultView: null }, isConnected: false }), true);
    assert.match(render(), /disabled=""/);
    assert.match(render(), /Adicionado/);
    const notice = renderToStaticMarkup(React.createElement(CartFeedbackNotice));
    assert.match(notice, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(notice, /Fictional category A/);
    assert.doesNotMatch(notice, /tabindex|autoFocus|role="alert"/);
  } finally { cartStore.set([]); cartFeedback.clearMessage(); }
});
