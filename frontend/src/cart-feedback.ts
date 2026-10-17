import { cartStore, type CartItem } from './stores';
import { bounceCart, flyToCart, pulseCartButton } from './cart-animation';

type Cart = Pick<typeof cartStore, 'getSnapshot' | 'set'>;
type Effects = {
  fly: (button: HTMLButtonElement, landed: (arrived: boolean) => void) => boolean;
  pulse: (button: HTMLButtonElement) => void;
  bounce: (button: HTMLButtonElement) => void;
};
type Feedback = { pendingIds: string[]; message: string; lastAddedId: string | null; sequence: number };

export const cartCountForDisplay = (items: CartItem[], pendingIds: string[]) => items.filter((item) => !pendingIds.includes(item.categoryId)).length;

export function createCartFeedback(cart: Cart, effects: Effects) {
  let state: Feedback = { pendingIds: [], message: '', lastAddedId: null, sequence: 0 };
  const pending = new Set<string>();
  const listeners = new Set<() => void>();
  const publish = (update: Partial<Feedback> = {}) => {
    state = { ...state, ...update, pendingIds: [...pending] };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clearMessage() { publish({ message: '', lastAddedId: null }); },
    add(item: CartItem, button: HTMLButtonElement): boolean {
      if (pending.has(item.categoryId) || cart.getSnapshot().some((entry) => entry.categoryId === item.categoryId)) return false;
      try { cart.set((current) => [...current, item]); } catch { return false; }
      if (!cart.getSnapshot().some((entry) => entry.categoryId === item.categoryId)) return false;

      pending.add(item.categoryId);
      publish();
      let settled = false;
      const complete = (arrived: boolean) => {
        if (settled) return;
        settled = true;
        pending.delete(item.categoryId);
        const stillInCart = cart.getSnapshot().some((entry) => entry.categoryId === item.categoryId);
        publish(stillInCart ? { message: `${item.name} adicionado ao carrinho.`, lastAddedId: item.categoryId, sequence: state.sequence + 1 } : {});
        if (stillInCart) {
          try { if (arrived) effects.bounce(button); else effects.pulse(button); } catch { /* Keep the confirmed state and accessible message. */ }
        }
      };
      try { if (!effects.fly(button, complete)) complete(false); } catch { complete(false); }
      return true;
    },
  };
}

export const cartFeedback = createCartFeedback(cartStore, { fly: flyToCart, pulse: pulseCartButton, bounce: bounceCart });
