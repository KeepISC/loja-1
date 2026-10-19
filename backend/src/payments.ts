import type { Prisma, PrismaClient } from '@prisma/client';
import { PaymentError, stripeCheckoutUrl, type CheckoutSnapshot, type PaymentConfig, type PaymentProvider, type RefundSnapshot } from './payment-provider.js';
import { retryTransaction } from './transaction-retry.js';
import { paymentSchemaInitializer } from './payment-schema.js';

const active = ['CREATING', 'OPEN', 'PROCESSING', 'CANCELLING'];
type Tx = Prisma.TransactionClient;
export function payments(prisma: PrismaClient, config: PaymentConfig, provider: PaymentProvider) {
  const initialize = paymentSchemaInitializer(prisma);
  const transaction = <T,>(fn: (tx: Tx) => Promise<T>) => retryTransaction(() => prisma.$transaction(fn, { maxWait: 10000, timeout: 10000 }));
  const locked = async (tx: Tx, orderId: string) => {
    const lock = await tx.payment.updateMany({ where: { orderId, provider: 'STRIPE' }, data: { updatedAt: new Date() } });
    if (!lock.count) throw new PaymentError();
    const payment = await tx.payment.findUniqueOrThrow({ where: { orderId }, include: { order: true } });
    if (!['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(payment.status)
      || !['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(payment.order.status)) throw new PaymentError();
    return payment;
  };
  const validSession = (value: CheckoutSnapshot, payment: { id: string; order: { id: string; totalCents: number; currency: string } }, attempt: { id: string; sessionId: string | null; intentId: string | null }) => {
    if (!/^cs_(test_|live_)?[A-Za-z0-9_]{1,240}$/.test(value.id) || value.orderId !== payment.order.id || value.paymentId !== payment.id
      || value.attemptId !== attempt.id || value.amount !== payment.order.totalCents || value.currency !== payment.order.currency || value.live !== config.live
      || attempt.sessionId && attempt.sessionId !== value.id || attempt.intentId && attempt.intentId !== value.intentId
      || value.intentId && !/^pi_[A-Za-z0-9_]{1,240}$/.test(value.intentId)
      || !['open', 'complete', 'expired'].includes(value.status) || !['unpaid', 'paid', 'no_payment_required'].includes(value.paymentStatus)) throw new PaymentError(400, 'Payment details do not match the order.');
  };
  const history = (tx: Tx, paymentId: string, kind: string, status: string, amountCents: number, currency: string, eventId?: string, actorId?: string) =>
    tx.paymentEvent.create({ data: { paymentId, kind, status, amountCents, currency, eventId, actorId } });
  const safeCall = async <T,>(fn: () => Promise<T>) => {
    try { return await fn(); } catch (error) { if (error instanceof PaymentError) throw error; throw new PaymentError(502, 'Payment provider is unavailable. Retry this order.'); }
  };
  const recent = (createdAt: Date) => {
    // Never reuse an ambiguous creation key after Stripe's 24-hour retention window.
    if (Date.now() - createdAt.getTime() >= 23 * 60 * 60000) throw new PaymentError(409, 'This payment needs operator reconciliation before retry.');
  };
  return {
    initialize,
    async checkout(orderId: string) {
      await initialize();
      const attempt = await transaction(async (tx) => {
        const payment = await locked(tx, orderId);
        if (!['PENDING', 'FAILED', 'CANCELLED'].includes(payment.status) || !['PENDING', 'CANCELLED', 'FAILED'].includes(payment.order.status)
          || payment.order.currency !== 'EUR' || !Number.isSafeInteger(payment.order.totalCents) || payment.order.totalCents < 50 || payment.order.totalCents > 99999999) throw new PaymentError();
        const previous = await tx.paymentAttempt.findFirst({ where: { paymentId: payment.id, status: { in: active } }, orderBy: { createdAt: 'desc' } });
        if (previous) {
          if (previous.status === 'CANCELLING' || previous.status === 'PROCESSING') throw new PaymentError();
          if (!previous.sessionId) recent(previous.createdAt);
          return previous;
        }
        const created = await tx.paymentAttempt.create({ data: { paymentId: payment.id, expiresAt: new Date(Date.now() + 31 * 60000) } });
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'PENDING' } });
        await tx.order.update({ where: { id: orderId }, data: { status: 'PENDING' } });
        await history(tx, payment.id, 'CHECKOUT_REQUESTED', 'PENDING', payment.order.totalCents, payment.order.currency);
        return created;
      });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: attempt.paymentId }, include: { order: true } });
      const snapshot = await safeCall(() => attempt.sessionId ? provider.retrieve(attempt.sessionId) : provider.create({ orderId, paymentId: payment.id, attemptId: attempt.id,
        amount: payment.order.totalCents, currency: payment.order.currency, expiresAt: attempt.expiresAt }));
      validSession(snapshot, payment, attempt);
      const url = snapshot.status === 'open' && snapshot.url ? stripeCheckoutUrl(snapshot.url) : null;
      await transaction(async (tx) => {
        const current = await locked(tx, orderId);
        const row = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        validSession(snapshot, current, row);
        // A webhook may have completed/refunded the attempt while creation was in flight.
        if (!['CREATING', 'OPEN'].includes(row.status) || ['PAID', 'REFUNDED'].includes(current.status)) return;
        await tx.paymentAttempt.update({ where: { id: row.id }, data: { sessionId: snapshot.id, intentId: snapshot.intentId,
          status: snapshot.status === 'open' ? 'OPEN' : snapshot.status === 'expired' ? 'EXPIRED' : 'PROCESSING' } });
      });
      const current = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      if (['PAID', 'REFUNDED'].includes(current.status)) return { url: null, orderId };
      if (current.status !== 'PENDING') throw new PaymentError();
      if (!url) throw new PaymentError(409, 'Checkout is closed or awaiting confirmation. Refresh the order before retrying.');
      return { url, orderId };
    },
    async cancel(orderId: string) {
      const attempt = await transaction(async (tx) => {
        const payment = await locked(tx, orderId);
        if (['PAID', 'REFUNDED', 'PROCESSING'].includes(payment.status)) throw new PaymentError();
        const row = await tx.paymentAttempt.findFirst({ where: { paymentId: payment.id, status: { in: active } } });
        if (!row?.sessionId) throw new PaymentError();
        if (!['OPEN', 'CANCELLING'].includes(row.status)) throw new PaymentError();
        return tx.paymentAttempt.update({ where: { id: row.id }, data: { status: 'CANCELLING' } });
      });
      let snapshot: CheckoutSnapshot;
      try { snapshot = await provider.cancel(attempt.sessionId!); }
      catch { snapshot = await safeCall(() => provider.retrieve(attempt.sessionId!)); }
      const result = await transaction(async (tx) => {
        const payment = await locked(tx, orderId);
        validSession(snapshot, payment, attempt);
        if (snapshot.status !== 'expired' || snapshot.paymentStatus !== 'unpaid' || ['PAID', 'REFUNDED', 'PROCESSING'].includes(payment.status)) throw new PaymentError();
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'CANCELLED' } });
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
        await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });
        await history(tx, payment.id, 'CHECKOUT_CANCELLED', 'CANCELLED', payment.order.totalCents, payment.order.currency);
        return { ok: true };
      });
      return result;
    },
    async refund(orderId: string, actorId: string) {
      const row = await transaction(async (tx) => {
        const payment = await locked(tx, orderId);
        const pending = await tx.paymentRefund.findFirst({ where: { paymentId: payment.id, status: { in: ['REQUESTED', 'PENDING', 'SUCCEEDED'] } }, orderBy: { createdAt: 'desc' } });
        if (payment.status === 'REFUNDED' && pending?.status === 'SUCCEEDED') return pending;
        if (payment.status !== 'PAID' || !payment.paymentIntentId) throw new PaymentError();
        if (pending && pending.status !== 'SUCCEEDED') { if (!pending.providerRefundId) recent(pending.createdAt); return pending; }
        const amountCents = payment.order.totalCents - payment.refundedCents;
        if (amountCents <= 0) throw new PaymentError();
        const created = await tx.paymentRefund.create({ data: { paymentId: payment.id, amountCents, actorId } });
        await history(tx, payment.id, 'REFUND_REQUESTED', 'REQUESTED', amountCents, payment.order.currency, undefined, actorId);
        return created;
      });
      if (row.status === 'SUCCEEDED') return { status: row.status };
      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: row.paymentId } });
      const snapshot = await safeCall(() => row.providerRefundId ? provider.retrieveRefund(row.providerRefundId) : provider.refund({ id: row.id, intentId: payment.paymentIntentId!, amount: row.amountCents }));
      await applyRefund(snapshot, row.id);
      return { status: (await prisma.paymentRefund.findUniqueOrThrow({ where: { id: row.id } })).status };
    },
    async webhook(raw: Buffer, signature: string) {
      const notification = provider.notification(raw, signature);
      if (notification.refundId) {
        const snapshot = await safeCall(() => provider.retrieveRefund(notification.refundId!));
        if (snapshot.id !== notification.refundId) throw new PaymentError(400, 'Invalid refund reference.');
        await applyRefund(snapshot, undefined, notification.id, notification.type);
        return undefined;
      }
      if (!notification.session) return undefined;
      const eventSnapshot = notification.session;
      const snapshot = await safeCall(() => provider.retrieve(eventSnapshot.id));
      return transaction(async (tx) => {
        // Lock before any consistent read: InnoDB's default repeatable-read view
        // must be created after competing payment transitions have committed.
        const payment = await locked(tx, snapshot.orderId);
        const attempt = await tx.paymentAttempt.findUnique({ where: { id: snapshot.attemptId } });
        if (!attempt || attempt.paymentId !== payment.id) throw new PaymentError(400, 'Unknown checkout attempt.');
        validSession(eventSnapshot, payment, attempt); validSession(snapshot, payment, attempt);
        if (snapshot.id !== eventSnapshot.id) throw new PaymentError(400, 'Invalid checkout reference.');
        if (await tx.paymentEvent.findUnique({ where: { eventId: notification.id } })) return payment.status === 'PAID' ? payment.orderId : undefined;
        let status = payment.status, attemptStatus = attempt.status;
        const paid = snapshot.status === 'complete' && snapshot.paymentStatus === 'paid';
        if (paid) {
          if (!snapshot.intentId || payment.paymentIntentId && payment.paymentIntentId !== snapshot.intentId) throw new PaymentError(409, 'Payment requires operator reconciliation.');
          if (payment.status !== 'REFUNDED') { status = 'PAID'; attemptStatus = 'PAID'; }
        } else if (!['PAID', 'REFUNDED'].includes(payment.status)) {
          if (snapshot.status === 'expired') { status = attempt.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED'; attemptStatus = attempt.status === 'CANCELLED' ? 'CANCELLED' : 'EXPIRED'; }
          else if (snapshot.status === 'complete') { status = notification.type === 'checkout.session.async_payment_failed' || attempt.status === 'FAILED' ? 'FAILED' : 'PROCESSING'; attemptStatus = status; }
          // A failure on one attempt must never override a newer attempt's state.
          const newer = await tx.paymentAttempt.findFirst({ where: { paymentId: payment.id, id: { not: attempt.id }, status: { in: active } } });
          if (newer) status = payment.status;
        }
        await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { sessionId: snapshot.id, intentId: snapshot.intentId, status: attemptStatus } });
        await tx.payment.update({ where: { id: payment.id }, data: { status, ...(paid ? { paymentIntentId: snapshot.intentId, confirmedAt: payment.confirmedAt ?? new Date() } : {}) } });
        await tx.order.update({ where: { id: payment.orderId }, data: { status: status === 'PROCESSING' ? 'PENDING' : status } });
        await history(tx, payment.id, notification.type, status, payment.order.totalCents, payment.order.currency, notification.id);
        return status === 'PAID' ? payment.orderId : undefined;
      });
    },
  };

  async function applyRefund(snapshot: RefundSnapshot, localId?: string, eventId?: string, kind = 'REFUND_RESPONSE') {
    if (!/^re_[A-Za-z0-9_]{1,240}$/.test(snapshot.id) || !snapshot.intentId || snapshot.live !== config.live
      || !Number.isSafeInteger(snapshot.amount) || snapshot.amount <= 0 || !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(snapshot.status)) throw new PaymentError(400, 'Invalid refund details.');
    const linked = await prisma.payment.findUnique({ where: { paymentIntentId: snapshot.intentId } });
    if (!linked) throw new PaymentError(400, 'Unknown refund payment.');
    return transaction(async (tx) => {
      const payment = await locked(tx, linked.orderId);
      if (payment.paymentIntentId !== snapshot.intentId) throw new PaymentError(400, 'Refund reference mismatch.');
      if (eventId && await tx.paymentEvent.findUnique({ where: { eventId } })) return;
      if (snapshot.currency !== payment.order.currency || snapshot.amount > payment.order.totalCents || !['PAID', 'REFUNDED'].includes(payment.status)) throw new PaymentError(400, 'Refund does not match the payment.');
      let row = localId ? await tx.paymentRefund.findUniqueOrThrow({ where: { id: localId } }) : await tx.paymentRefund.findUnique({ where: { providerRefundId: snapshot.id } });
      // A refund webhook can beat the API response. Match the only reserved full refund.
      row ??= await tx.paymentRefund.findFirst({ where: { paymentId: payment.id, providerRefundId: null, status: 'REQUESTED', amountCents: snapshot.amount } });
      row ??= await tx.paymentRefund.create({ data: { paymentId: payment.id, providerRefundId: snapshot.id, amountCents: snapshot.amount } });
      if (row.paymentId !== payment.id || row.amountCents !== snapshot.amount || row.providerRefundId && row.providerRefundId !== snapshot.id) throw new PaymentError(400, 'Refund reference mismatch.');
      const status = row.status === 'SUCCEEDED' ? 'SUCCEEDED' : snapshot.status === 'succeeded' ? 'SUCCEEDED' : ['failed', 'canceled'].includes(snapshot.status) ? 'FAILED' : 'PENDING';
      const total = payment.refundedCents + (status === 'SUCCEEDED' && row.status !== 'SUCCEEDED' ? snapshot.amount : 0);
      if (total > payment.order.totalCents) throw new PaymentError(409, 'Refund exceeds the remaining amount.');
      await tx.paymentRefund.update({ where: { id: row.id }, data: { providerRefundId: snapshot.id, status } });
      await tx.payment.update({ where: { id: payment.id }, data: { refundedCents: total, ...(total === payment.order.totalCents ? { status: 'REFUNDED' } : {}) } });
      if (total === payment.order.totalCents) await tx.order.update({ where: { id: payment.orderId }, data: { status: 'REFUNDED' } });
      await history(tx, payment.id, kind, status, snapshot.amount, snapshot.currency, eventId, row.actorId ?? undefined);
    });
  }
}
