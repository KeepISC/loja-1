import Stripe from 'stripe';

export class PaymentError extends Error {
  constructor(public status = 409, message = 'Payment cannot be changed in its current state.') { super(message); }
}
export type PaymentConfig = { provider: 'DUMMY' | 'STRIPE'; origin: string; key?: string; webhookSecret?: string; live: boolean };
export function paymentConfig(env: NodeJS.ProcessEnv = process.env): PaymentConfig {
  try {
    const selected = env.PAYMENT_PROVIDER ?? (env.NODE_ENV === 'development' ? 'mock' : '');
    if (!['mock', 'stripe'].includes(selected) || selected === 'mock' && env.NODE_ENV !== 'development') throw Error();
    const raw = env.PAYMENT_APP_ORIGIN ?? (selected === 'mock' ? 'http://localhost:5173' : '');
    if (!raw || /[\s\\]/.test(raw)) throw Error();
    const origin = new URL(raw), local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || origin.protocol !== 'https:' && !(env.NODE_ENV === 'development' && local && origin.protocol === 'http:')) throw Error();
    if (selected === 'mock') return { provider: 'DUMMY', origin: origin.origin, live: false };
    const key = env.STRIPE_SECRET_KEY ?? '', webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? '';
    if (!/^sk_(test|live)_[A-Za-z0-9]{12,}$/.test(key) || !/^whsec_[A-Za-z0-9_]{12,}$/.test(webhookSecret)) throw Error();
    const live = key.startsWith('sk_live_');
    if (live && (env.NODE_ENV !== 'production' || origin.protocol !== 'https:' || local)) throw Error();
    return { provider: 'STRIPE', origin: origin.origin, key, webhookSecret, live };
  } catch { throw new PaymentError(503, 'Payment configuration is missing or invalid.'); }
}

export type CheckoutSnapshot = { id: string; intentId: string | null; orderId: string; paymentId: string; attemptId: string;
  amount: number; currency: string; status: string; paymentStatus: string; live: boolean; url: string | null };
export type RefundSnapshot = { id: string; intentId: string; amount: number; currency: string; status: string; live: boolean };
export type PaymentNotification = { id: string; type: string; live: boolean; session?: CheckoutSnapshot; refundId?: string };
export interface PaymentProvider {
  create(input: { orderId: string; paymentId: string; attemptId: string; amount: number; currency: string; expiresAt: Date }): Promise<CheckoutSnapshot>;
  retrieve(id: string): Promise<CheckoutSnapshot>;
  cancel(id: string): Promise<CheckoutSnapshot>;
  refund(input: { id: string; intentId: string; amount: number }): Promise<RefundSnapshot>;
  retrieveRefund(id: string): Promise<RefundSnapshot>;
  notification(raw: Buffer, signature: string): PaymentNotification;
}
export type StripeClient = Pick<Stripe, 'checkout' | 'refunds' | 'webhooks'>;
const reference = (value: string | { id: string } | null) => typeof value === 'string' ? value : value?.id ?? null;
export function stripeCheckoutUrl(value: string) {
  try { const url = new URL(value); if (url.origin === 'https://checkout.stripe.com' && !url.username && !url.password) return url.href; } catch { /* Reject redirects outside hosted Stripe Checkout. */ }
  throw new PaymentError(502, 'Payment provider is unavailable. Retry this order.');
}
export function stripeProvider(config: PaymentConfig, client?: StripeClient): PaymentProvider {
  const sdk = client ?? new Stripe(config.key!, { timeout: 10000, maxNetworkRetries: 2, telemetry: false });
  const session = (value: Stripe.Checkout.Session): CheckoutSnapshot => {
    if (value.mode !== 'payment') throw new PaymentError(400, 'Unsupported checkout mode.');
    return { id: value.id, intentId: reference(value.payment_intent),
    orderId: value.client_reference_id ?? '', paymentId: value.metadata?.paymentId ?? '', attemptId: value.metadata?.attemptId ?? '',
    amount: value.amount_total ?? -1, currency: value.currency?.toUpperCase() ?? '', status: value.status ?? '',
    paymentStatus: value.payment_status, live: value.livemode, url: value.url };
  };
  const refund = (value: Stripe.Refund): RefundSnapshot => ({ id: value.id, intentId: reference(value.payment_intent) ?? '',
    amount: value.amount, currency: value.currency.toUpperCase(), status: value.status ?? 'pending', live: config.live });
  return {
    async create(input) {
      return session(await sdk.checkout.sessions.create({ mode: 'payment', allowed_payment_method_types: ['card'],
        adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false },
        payment_method_options: { card: { request_three_d_secure: 'automatic' } },
        client_reference_id: input.orderId, metadata: { paymentId: input.paymentId, attemptId: input.attemptId },
        payment_intent_data: { metadata: { orderId: input.orderId, paymentId: input.paymentId } },
        line_items: [{ price_data: { currency: input.currency.toLowerCase(), unit_amount: input.amount, product_data: { name: 'Supplier Market — pedido' } }, quantity: 1 }],
        success_url: `${config.origin}/success?orderId=${encodeURIComponent(input.orderId)}`,
        cancel_url: `${config.origin}/orders/${encodeURIComponent(input.orderId)}?checkout=cancelled`,
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      }, { idempotencyKey: `checkout-${input.attemptId}` }));
    },
    async retrieve(id) { return session(await sdk.checkout.sessions.retrieve(id)); },
    async cancel(id) { return session(await sdk.checkout.sessions.expire(id)); },
    async refund(input) { return refund(await sdk.refunds.create({ payment_intent: input.intentId, amount: input.amount }, { idempotencyKey: `refund-${input.id}` })); },
    async retrieveRefund(id) { return refund(await sdk.refunds.retrieve(id)); },
    notification(raw, signature) {
      let event: Stripe.Event;
      try { event = sdk.webhooks.constructEvent(raw, signature, config.webhookSecret!); }
      catch { throw new PaymentError(400, 'Invalid payment webhook signature or payload.'); }
      if (!/^evt_[A-Za-z0-9_]{1,240}$/.test(event.id) || event.account || event.livemode !== config.live) throw new PaymentError(400, 'Invalid payment webhook.');
      const value: PaymentNotification = { id: event.id, type: event.type, live: event.livemode };
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type)) value.session = session(event.data.object as Stripe.Checkout.Session);
      if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) value.refundId = (event.data.object as Stripe.Refund).id;
      return value;
    },
  };
}
