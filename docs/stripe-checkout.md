# Stripe Checkout

Task 4 adds Stripe-hosted card payments while keeping SQLite as the development
default and preserving the explicit mock workflow. No real Stripe API requests,
charges, credentials, Hostinger connection or deployment were used. Automated
tests inject SDK responses and use Stripe's actual signature-verification code.
Production/staging startup guards remain enabled.

## Architecture and payment correctness

`payment-provider.ts` defines a normalized provider interface and the official
Stripe Node SDK adapter. `payments.ts` owns transactional lifecycle rules;
`payment-schema.ts` performs additive SQLite initialization. Existing order
creation, ownership, database sessions, themes and fulfillment are reused.

All charges belong to the marketplace's Stripe account. There is no Stripe
Connect, destination transfer, application fee, supplier split or payout logic.
This does not remove Stripe's own processing costs. Initially the application
charges EUR using integer cents from the saved order total, with quantity one
for the order summary. Checkout does not accept client prices, amounts, currency
or redirect destinations. Discounts, automatic taxes and adaptive pricing cannot
change the amount. Stripe's eligible card filter permits cards, including eligible
Visa/Mastercard credit/debit cards, and leaves 3D Secure authentication automatic.
The application never collects card numbers/CVC or stores complete webhook bodies.
See [Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create).

| Stored state | Behavior |
| --- | --- |
| `PENDING` | A saved order awaits Checkout/payment confirmation |
| `PROCESSING` | Checkout is complete but payment is not yet confirmed; order remains `PENDING` |
| `PAID` | Verified webhook plus authoritative Stripe Session says complete/paid; fulfillment may run |
| `FAILED` | Failed asynchronous payment or expired session; no fulfillment |
| `CANCELLED` | An owned cancellation successfully expired the provider session; no refund |
| `REFUNDED` | Successful refunds cover the full order total; delivery API access is blocked |

Sessions have a durable attempt ID and a 31-minute expiry. Creation uses
`checkout-<attempt ID>` as Stripe's idempotency key. Competing calls reserve one
attempt while locking the existing Payment row; Stripe calls occur outside DB
transactions. A lost response retries the same parameters/key, never creates a
second paid order. Confirmed expiry/cancellation/failure allows a new attempt on
the existing order. Ambiguous creations older than 23 hours require operator
reconciliation rather than reusing a possibly expired Stripe idempotency key.

`POST /api/payments/stripe/webhook` alone receives a size-limited raw body before
JSON/session/CSRF middleware. Stripe's SDK verifies its signature and timestamp.
The normal host/socket boundary, headers and request limits still apply. Other
writes retain CSRF protection. Connect events and events with the wrong live/test
mode are rejected. Supported event types:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
refund.created
refund.updated
refund.failed
```

Checkout snapshots and freshly retrieved provider objects must match the saved
attempt, order, Payment ID, amount, EUR currency and mode. Fresh retrieval plus
monotonic paid/refunded transitions handles delayed/out-of-order delivery.
Unique event IDs and row locks make processing idempotent under concurrency on
both SQLite and InnoDB. Locks precede consistent reads to avoid stale InnoDB
repeatable-read snapshots. A second distinct paid intent on one payment requires
operator reconciliation rather than silent fulfillment.

Payment transition and processed-event audit commit together. Fulfillment then
uses the existing paid-state-gated, transactional local order outbox. A failed
fulfillment returns an error; replay of the already recorded event retries only
the still-needed fulfillment. Successful delivery remains a single outbox entry.
The existing combined receipt/contact message is preserved; no extra confirmation
email event was introduced. It is still a local preview, not a real order-email
provider. See [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment)
and [webhook verification/retries](https://docs.stripe.com/webhooks).

## HTTP and frontend

| Endpoint | Authorization / result |
| --- | --- |
| `GET /api/payments/config` | Public provider label/mock availability only; no secrets |
| `POST /api/orders/:orderId/checkout` | Owned guest cookie/account or real Admin; empty JSON body; returns validated hosted URL |
| `GET /api/orders/:orderId/payment-status` | Same ownership; stored status/amount/currency/refunded amount; never confirms payment |
| `POST /api/orders/:orderId/cancel-payment` | Same ownership; empty JSON body; expires an open session at Stripe |
| `POST /api/orders/:orderId/retry-delivery` | Same ownership and existing paid-state checks |
| `POST /api/admin/orders/:orderId/refund` | Real authenticated Admin only; empty JSON body |
| `GET /api/admin/orders/:orderId/payment-history` | Real Admin only; audit/refund history |

Checkout/cancellation/refund/retry writes have an additional 20/minute socket-IP
limit. Customers, Suppliers and mock Admin cannot refund or set payment states.
Guest cookies remain separate from account ownership; email matching grants no
access. Mock payment confirmation endpoints reject Stripe orders even when the
mock flag is enabled. The guest-only remote demo disables Stripe checkout writes.

The frontend checks provider availability before offering payment, validates the
hosted `https://checkout.stripe.com` redirect, and keeps the saved checkout/cart
while awaiting confirmation. A matching server-confirmed paid order removes only
its purchased cart items. The success/order page polls stored status for up to
one minute and offers manual refresh afterward. Failed/cancelled/processing/
refunded states are explicit. Returning via either URL never sets `PAID`, cancels
a payment or issues a refund. Cancellation requires the separate explicit action.

## Refunds

Only full remaining refunds can be initiated by the application's Admin action;
amounts are computed from order total minus successful refunds. A durable refund
reservation precedes the SDK request and uses `refund-<refund ID>` as the provider
idempotency key. Repeating a pending/ambiguous request uses that same reservation;
repeating a completed full refund does not call Stripe again. A confirmed failed
refund permits a new reservation. Ambiguous requests past 23 hours require an
operator to reconcile provider state before retrying.

Refund IDs, amounts, state, request actor and transition history are persisted.
Canonical refund retrieval reconciles `pending`, `requires_action`, `succeeded`,
`failed` and `canceled` results. Success is never rolled back by stale events.
Provider-side partial refunds can be recorded, but the application offers no
partial-amount control. Access remains paid until the entire order is refunded.
Stripe-only refunded purchases lose API delivery access; contact information
already viewed/copied cannot be recalled. A refund initiated elsewhere before its
payment webhook is known is rejected/retried until the payment can be associated.
See [Stripe refunds](https://docs.stripe.com/refunds).

## Environment and local mock testing

No keys are needed for automated tests or the existing mock flow. Keep:

```dotenv
NODE_ENV=development
PAYMENT_PROVIDER=mock
ALLOW_MOCK_PAYMENT=true
```

Run `npm run dev`, create a guest or authenticated order and use **Simular
pagamento**. SQLite remains the default. Mock mode is rejected outside development,
and an explicitly selected but incomplete Stripe configuration fails closed.
There is no automatic fallback from Stripe to mock.

For an operator's later Stripe **test-mode** browser check, create the Git-ignored
`.env.stripe.local` at the repository root and confirm it is ignored first:

```powershell
git check-ignore -v .env.stripe.local
```

| Variable | Required configuration |
| --- | --- |
| `PAYMENT_PROVIDER` | `stripe` explicitly enables the SDK adapter |
| `PAYMENT_APP_ORIGIN` | Trusted root origin for success/cancel links; local test example `http://localhost:5173`; HTTPS required away from loopback |
| `STRIPE_SECRET_KEY` | Private `sk_test_...` for local testing; never a frontend/Vite variable |
| `STRIPE_WEBHOOK_SECRET` | Private `whsec_...` signing secret for the selected listener/endpoint |

Enter keys locally without sharing them in chat, shell command arguments, logs or
source control. Existing process variables take precedence, then `.env.auth.local`,
`.env.auth-email.local`, `.env.stripe.local` and `.env`. Leave the SQLite datasource
and authentication email preview settings intact. Do not introduce production mode.
Live keys are rejected in development. Test/live credentials and endpoint secrets
must be isolated per deployment environment; a listener secret is not a Dashboard
endpoint secret. No publishable key or Stripe.js dependency is needed for this
server-created hosted redirect integration.

## Stripe test mode, CLI, international cards and refunds

These are operator instructions, not commands executed during implementation.
Use a Stripe sandbox/test account with test cards only; no real charges.

1. Install the official [Stripe CLI](https://docs.stripe.com/stripe-cli), authenticate
   with `stripe login`, and privately obtain the test secret key.
2. Start a snapshot-event listener in a normal terminal:

   ```powershell
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,refund.created,refund.updated,refund.failed --forward-to localhost:3001/api/payments/stripe/webhook
   ```

   The CLI displays its signing secret: put it only in the ignored environment
   file. Do not paste listener output into chat or shared logs. Configure a
   snapshot endpoint matching the installed SDK's API version
   `2026-09-30.endive` (Stripe Node 23.0.0); the integration uses that SDK's default.
3. Restart the local backend with `NODE_ENV=development`, start the frontend and
   place an actual application test order. **Pagar com cartão no Stripe** opens
   hosted Checkout. Bare `stripe trigger checkout.session.completed` fixtures
   lack the application's saved order/attempt metadata and must not fulfill an
   arbitrary order. Use events generated by this application's sessions.
4. Use [Stripe's official test card catalog](https://docs.stripe.com/testing) to
   cover Visa/Mastercard credit and debit, international issuer countries, 3DS
   challenge success/cancel/failure and declined cards. Enter card data only on
   Stripe's hosted page. The application should remain pending until its verified
   webhook arrives, including when the browser returns first.
5. Test closing the browser, following Cancel, explicit cancellation, expiry,
   repeated checkout clicks, delayed webhook delivery and duplicate delivery.
   Check that only the owner can inspect the order or its paid delivery.
6. Sign in as a real Admin and open the paid order. **Reembolsar valor restante**
   requests the full remaining refund. Verify pending/failure/success events,
   retries and `payment-history`; Customer/Supplier/mock Admin requests must fail.
   For a known test event, CLI replay can use
   `stripe events resend <event_id> --webhook-endpoint=<registered_endpoint_id>`
   after a test endpoint exists. Do not point replay at live infrastructure.

Actual international acceptance depends on the Stripe account's country/settings,
eligible card networks and issuer authentication. Mock tests do not prove live
card acceptance or browser/redirect UX. CLI/dashboard secret handling and browser
acceptance are intentionally not claimed as verified.

## Database migration and rollback

`202610190003_stripe_checkout` adds `Order.currency` (EUR), nullable unique
`Payment.paymentIntentId`, `Payment.refundedCents` and three related tables:
`PaymentAttempt`, `PaymentEvent`, `PaymentRefund`. Session/intent/event/refund
references are unique, histories are indexed by Payment/creation time, and the
three new foreign keys cascade on Payment deletion. Existing DUMMY orders remain
unchanged. Production administrative deletion/retention policy must preserve
payment audits; the app has no order-deletion API.

SQLite initialization adds columns/tables/indexes without rebuilding tables or
rewriting existing orders. A legacy-data preservation test runs it twice. Existing
`database/dev.db` was not opened or overwritten during this task; its additive
upgrade runs when the updated application is next started. Back up that file
before the first start, with the backend stopped. Do not use a schema reset.

For MySQL, see [mysql-migration.md](mysql-migration.md). Guarded commands:

```powershell
npm run mysql:inspect --workspace backend
npm run mysql:migrate --workspace backend
```

Only `localhost:3306/loja1_test` as `loja1_test_app` is permitted. The task inspected
the existing empty fixture database and applied one additive migration using
`backend/scripts/mysql-migrate-local.ps1`, the installed Prisma engine fallback
for the existing `spawn EPERM` restriction. All tables use InnoDB and binary
utf8mb4 collation. Both Prisma clients were regenerated separately using the
existing ignored in-process helper because normal generation is blocked here.

Rollback: stop the app/listeners, retain audit records and a verified database
backup, and select explicit mock mode for local testing. Do not delete Stripe
history or change existing orders' providers to make old orders mock-payable.
Returning to the previous code can retain these additive columns/tables. If schema
rollback is essential, preserve new payment records first and restore a verified
pre-migration backup; there is no automatic destructive down migration. MySQL DDL
may partially commit on failure: inspect history before retrying, never reset it.

## Automated checks and release blockers

Run from the repository root:

```powershell
npm run typecheck
npm test
npm run test:stripe --workspace backend
npm run test:stripe:mysql --workspace backend
npm run test:auth --workspace backend
npm run test:database --workspace backend
npm run test:auth:mysql --workspace backend
npm run test:mysql --workspace backend
npm run build
```

MySQL suites run sequentially, verify the local target, use fictional fixtures and
clean only their recorded IDs. General suites force mock payment/preview email;
Stripe suites explicitly inject mocked SDK calls. No real keys are required.

Hostinger deployment is not configured. Before deployment, verify supported Node
runtime, HTTPS/reverse-proxy and raw webhook-body preservation, precise public
webhook routing, secret injection, database backups/migrations, process monitoring,
event retry/reconciliation procedures and separate test/live Stripe accounts.
Do not weaken the app's existing socket/Host/Origin or production guards to expose
the local development app. A production profile remains a separate reviewed task.

Remaining blockers: browser and sandbox Stripe acceptance, production runtime/proxy
configuration, live webhook registration/monitoring, real order-email delivery,
and the existing frontend build `spawn EPERM`. Authentication SMTP also remains
validated with mocks only. There is no automated operator reconciliation for
ambiguous requests older than 23 hours; review Stripe and local history before any
manual repair. No supplier payouts, partial-refund UI or dispute workflow is added.

## Task 4 file manifest and results (2026-10-19)

Created:

- `backend/src/payment-provider.ts`, `backend/src/payments.ts`,
  `backend/src/payment-schema.ts`.
- `backend/test/stripe.test.mjs`, `backend/test/stripe.integration.mjs`.
- `frontend/src/payments.ts`, `frontend/test/payments.test.mjs`.
- `prisma/mysql/migrations/202610190003_stripe_checkout/migration.sql` and this document.

Updated:

- `.env.example`, `README.md`, `backend/package.json`, `package-lock.json`.
- `backend/src/app.ts`, `backend/src/config.ts`.
- `backend/scripts/mysql-env.mjs`, `backend/scripts/mysql-local.mjs`.
- `backend/test/schema.sql`, `backend/test/marketplace.test.mjs`,
  `backend/test/database.integration.mjs`, `backend/test/auth.integration.mjs`.
- `frontend/src/App.tsx`, `frontend/src/MarketplacePages.tsx`,
  `frontend/src/checkout.ts`, `frontend/src/orders.ts`.
- `prisma/schema.prisma`, `prisma/mysql/schema.prisma`, `docs/mysql-migration.md`.

| Executed check | Result |
| --- | --- |
| Backend general suite, including four new Stripe unit/migration checks | PASS: 87/87 |
| Frontend general suite, including two new payment-flow checks | PASS: 58/58 |
| SQLite Stripe integration | PASS: 9/9 |
| Local MySQL Stripe integration | PASS: 9/9 |
| Authentication/RBAC on SQLite and local MySQL | PASS: 11/11 each |
| Database/marketplace on SQLite and local MySQL | PASS: 10/10 each |
| Existing/new MySQL migration history, checksums, InnoDB, FKs and indexes | PASS |
| Both TypeScript projects and backend build | PASS |
| Frontend Vite build | BLOCKED: esbuild `spawn EPERM` |
| Real Stripe sandbox/CLI/browser/international-card acceptance | NOT VERIFIED |

Exactly one new MySQL migration was applied to the guarded local test database.
SQLite upgrades ran only on temporary fixtures. No commit, push or deployment was made.

Next task: run `npm run build --workspace frontend` in a normal permitted
PowerShell, then complete the Stripe **test-mode** browser acceptance matrix above
with test credentials kept locally. Keep production disabled throughout.
