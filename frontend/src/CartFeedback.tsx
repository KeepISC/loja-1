import { useEffect, useSyncExternalStore } from 'react';
import { cartStore } from './stores';
import { cartFeedback } from './cart-feedback';

export const useCartFeedback = () => useSyncExternalStore(cartFeedback.subscribe, cartFeedback.getSnapshot, cartFeedback.getSnapshot);

export function AddToCartButton({ category }: { category: { id: string; name: string; priceCents: number } }) {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot, cartStore.getSnapshot);
  const feedback = useCartFeedback();
  const adding = feedback.pendingIds.includes(category.id);
  const inCart = cart.some((item) => item.categoryId === category.id);
  const confirmed = inCart && feedback.lastAddedId === category.id;
  return <button
    type="button"
    onClick={(event) => cartFeedback.add({ categoryId: category.id, name: category.name, priceCents: category.priceCents }, event.currentTarget)}
    disabled={adding || inCart}
    aria-busy={adding}
    aria-label={inCart ? `${category.name} no carrinho` : `Adicionar ${category.name} ao carrinho`}
    className="cart-add-button rounded-lg bg-action px-3 py-2 text-sm font-medium text-action-ink"
  >{adding ? 'A adicionar…' : confirmed ? '✓ Adicionado' : inCart ? 'No carrinho' : 'Adicionar'}</button>;
}

export function CartFeedbackNotice() {
  const feedback = useCartFeedback();
  useEffect(() => {
    if (!feedback.message) return;
    const timer = window.setTimeout(() => cartFeedback.clearMessage(), 2400);
    return () => window.clearTimeout(timer);
  }, [feedback.message, feedback.sequence]);
  return <div role="status" aria-live="polite" aria-atomic="true" className={feedback.message ? 'cart-feedback-notice' : 'sr-only'}>
    {feedback.message && <span key={feedback.sequence}><span aria-hidden="true" className="cart-feedback-check">✓</span>{feedback.message}</span>}
  </div>;
}
