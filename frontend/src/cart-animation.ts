export const cartFlightDuration = 620;
const thumbnailSize = 56;

type Point = { x: number; y: number };
export function cartFlightFrames(start: Point, end: Point): Keyframe[] {
  const arcHeight = Math.min(150, Math.hypot(end.x - start.x, end.y - start.y) * .25 + 40);
  // Keep the thumbnail inside the viewport when the header is close to its top edge.
  const control = { x: (start.x + end.x) / 2, y: Math.max(thumbnailSize / 2, Math.min(start.y, end.y) - arcHeight) };
  return Array.from({ length: 21 }, (_, index) => {
    const t = index / 20;
    const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x;
    const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y;
    return { offset: t, transform: `translate3d(${x - start.x}px, ${y - start.y}px, 0) scale(${1 - .75 * t})`, opacity: t < .85 ? .95 : .95 - (t - .85) * 5 };
  });
}

const reducedMotion = (view: Window | null) => !view || Boolean(view.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const visibleCenter = (rect: DOMRect, view: Window): Point | null => {
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return rect.width > 0 && rect.height > 0 && point.x > 0 && point.x < view.innerWidth && point.y > 0 && point.y < view.innerHeight ? point : null;
};

function smallAnimation(element: HTMLElement, frames: Keyframe[], duration: number) {
  if (!element.isConnected || reducedMotion(element.ownerDocument.defaultView) || typeof element.animate !== 'function') return;
  try {
    const animation = element.animate(frames, { duration, easing: 'ease-out' });
    const motion = element.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    const stop = () => { if (motion?.matches) animation.cancel(); };
    motion?.addEventListener?.('change', stop);
    const cleanup = () => motion?.removeEventListener?.('change', stop);
    void animation.finished.then(cleanup, cleanup);
  } catch { /* Visual feedback must never prevent a successful cart update. */ }
}

export function pulseCartButton(button: HTMLButtonElement) {
  smallAnimation(button, [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: .4 }, { transform: 'scale(1)' }], 240);
}

export function bounceCart(button: HTMLButtonElement) {
  const icon = button.ownerDocument.querySelector<HTMLElement>('[data-cart-icon]');
  if (icon) smallAnimation(icon, [
    { transform: 'translateY(0) scale(1)' },
    { transform: 'translateY(-3px) scale(1.22)', offset: .35 },
    { transform: 'translateY(1px) scale(.96)', offset: .7 },
    { transform: 'translateY(0) scale(1)' },
  ], 300);
}

export function flyToCart(button: HTMLButtonElement, landed: (arrived: boolean) => void): boolean {
  const doc = button.ownerDocument;
  const view = doc.defaultView;
  if (!view || reducedMotion(view)) return false;
  const image = button.closest('[data-cart-product]')?.querySelector<HTMLImageElement>('img[data-cart-image]');
  const target = doc.querySelector<HTMLElement>('[data-cart-icon]');
  if (!image?.complete || !image.naturalWidth || !target?.isConnected || typeof image.animate !== 'function') return false;
  const start = visibleCenter(image.getBoundingClientRect(), view);
  const end = visibleCenter(target.getBoundingClientRect(), view);
  if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) < 24) return false;

  const copy = doc.createElement('img');
  copy.className = 'cart-flying-image';
  copy.src = image.currentSrc || image.src;
  copy.alt = '';
  copy.draggable = false;
  copy.setAttribute('aria-hidden', 'true');
  copy.style.left = `${start.x - thumbnailSize / 2}px`;
  copy.style.top = `${start.y - thumbnailSize / 2}px`;
  let animation: Animation;
  try {
    doc.body.appendChild(copy);
    animation = copy.animate(cartFlightFrames(start, end), { duration: cartFlightDuration, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' });
  } catch { copy.remove(); return false; }

  let settled = false;
  const motion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const finish = (arrived: boolean) => {
    if (settled) return;
    settled = true;
    view.clearTimeout(watchdog);
    view.removeEventListener('resize', cancel);
    view.removeEventListener('scroll', cancel, true);
    motion?.removeEventListener?.('change', onMotionChange);
    copy.remove();
    try { animation.cancel(); } catch { /* Always release the confirmed cart update, even if cancellation fails. */ }
    landed(arrived && target.isConnected);
  };
  const cancel = () => finish(false);
  const onMotionChange = () => { if (motion?.matches) cancel(); };
  // A watchdog also releases visual state if a browser never settles its animation promise.
  const watchdog = view.setTimeout(cancel, cartFlightDuration + 150);
  view.addEventListener('resize', cancel);
  view.addEventListener('scroll', cancel, true);
  motion?.addEventListener?.('change', onMotionChange);
  void animation.finished.then(() => finish(true), cancel);
  return true;
}
