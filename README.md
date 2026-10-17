# Digital Supplier Contacts Marketplace

This project is a local MVP for a marketplace that sells access to private supplier contacts. It includes a storefront, cart, checkout flow, mock payment flow, local delivery emails, and an admin dashboard.

Acceptance status: **NOT READY for v1.0 sign-off**. The recorded verification passes 43 tests, both TypeScript checks and the backend build. The frontend build is blocked by the local execution environment's `spawn EPERM`, and browser acceptance has not been completed. See [MVP_ACCEPTANCE_REPORT.md](MVP_ACCEPTANCE_REPORT.md) and [MVP_FINAL_FIX_REPORT.md](MVP_FINAL_FIX_REPORT.md) for evidence and the remaining checks. Earlier phase reports describe historical results superseded by those reports.

Only fictional development fixtures belong in this repository. Local environment files, SQLite databases, uploaded files and generated outbox data are excluded from version control; preserve them locally and initialize demo data separately on another computer.

## Stack

- Frontend: React + TypeScript + Vite + Tailwind CSS
- Backend: Node.js + Express + TypeScript
- Database: SQLite + Prisma ORM
- Mock providers: payment and email are local-only

## Local setup

Use Node.js 24 (the regression tests use the built-in SQLite API and module hooks).

1. Install dependencies:
   npm install
2. Create the environment file if it does not already exist (PowerShell):
   if (!(Test-Path .env)) { Copy-Item .env.example .env }
3. On a fresh installation, generate the Prisma client:
   npm run db:generate --workspace backend
4. Start the full project:
   npm run dev

The command automatically runs Prisma DB push. To initialize demo data explicitly, run `npm run db:push --workspace backend` and `npm run seed --workspace backend` before starting. Seeding creates missing demo categories and preserves existing category/contact edits and deletions. Normal startup does not seed data.

## Local URLs

- Storefront: http://localhost:5173
- Admin panel: http://localhost:5173/admin
- Guest order history: http://localhost:5173/orders
- API: http://localhost:3001
- Development email viewer (ADMIN): http://localhost:5173/dev/email-outbox
- Email outbox contents API (ADMIN session required): http://localhost:3001/api/dev/email-outbox

## Mock accounts

The project ships with two mock identities for local development only.

- ADMIN: admin@local.test
- GUEST: guest@local.test

The backend requires `NODE_ENV=development` and refuses to start in production, staging or other modes while only dummy providers exist. It loads `.env` from the project root, respects inherited environment variables, and binds to loopback. Mock payment confirmation additionally requires `ALLOW_MOCK_PAYMENT=true`.

The backend enforces admin roles and guest order ownership server-side. Each browser receives a separate anonymous guest identity through a seven-day HttpOnly cookie. Its high-entropy credential is stored only as a hash in SQLite, so guest order access survives backend restarts even when the in-memory mock role session is lost. ADMIN must switch roles again after a restart. Clearing or expiring the guest cookie loses access; explicitly clearing the development session also revokes that credential. Delivery email addresses and order IDs cannot recover access.

Live private guest sessions from the earlier version are upgraded when they next initialize their identity. Previously lost sessions and orders using the former shared guest remain accessible only to ADMIN; data is not reassigned to arbitrary visitors.

## Simulating a purchase

1. Switch to GUEST in the account switcher.
2. Browse a category and add it to the cart.
3. Go to checkout and enter a delivery email.
4. Click "Simular pagamento".
5. The order moves to `PAID`, and the generated delivery email appears in the email outbox.

ADMIN can create/edit/deactivate categories, upload raster images, and add/edit/delete supplier contacts from `/admin`. After saving or selecting a category, its contact form is shown below it. Switch to GUEST to purchase it, then open `/orders` to inspect the order or its paid delivery email. Pending orders can simulate payment from their detail screen; paid orders with failed delivery can retry. `/success?orderId=<id>` reloads the owned order and shows its actual payment/delivery state, including after refresh. A direct success-page visit without an order does not assert payment.

## Email delivery outbox

Generated emails are saved in SQLite's existing `EmailDelivery` table, which is the local dummy provider's persistent outbox. Paid-state checks, the delivery claim, body and SENT status are recorded transactionally. No real messages are sent. Retries reuse the same row and do not resend a SENT delivery. The ADMIN-only development outbox API exposes bodies only for paid orders with paid payments and SENT deliveries; ordinary order/payment responses contain metadata only.

Guests can read `/api/orders` for their own order history and `/api/orders/:id/delivery` for their own successfully delivered paid email. History requests without a valid guest credential receive 401. Other sessions receive 404 for individual order/delivery lookup; unpaid/undelivered orders receive 409. The aggregate viewer at `/dev/email-outbox` remains ADMIN-only. Email contents are rendered as text, not HTML.

Historical JSON outbox files are left untouched and are no longer written or used by the application. No database migration is required for Phase 1 or Phase 2.

## Replace the mock providers

The dummy provider classes remain in `backend/src/app.ts`. Real authentication/payment/email integration is outside this MVP. Production must remain disabled until those integrations and their verification/idempotency contracts are implemented; changing constructors alone is insufficient.

## Tests

Run:

npm test

The regression suites cover ownership/privacy, payment gating, concurrent/idempotent delivery, rollback/retry behavior, uploads and shared frontend state. Tests use temporary SQLite databases and uploads and never push schema changes to `database/dev.db`. The test loader uses the installed TypeScript compiler in-process; `--test-isolation=none` avoids test subprocesses while each backend run has its own temporary data directory.

Run `npm run typecheck` for both TypeScript projects and `npm run build` for both builds. Frontend tests include server-rendered component checks and are not a substitute for browser/mobile acceptance testing.

Backend compilation (`npm run build --workspace backend`) uses the installed Prisma client and TypeScript; generation is the separate setup command above and is needed again if the Prisma schema changes. `npm start` rebuilds the backend before launching it, so an old `dist` cannot silently bypass source fixes. Backend tests also build first and exercise the actual compiled app as well as the source. `npm start` serves the API only; run `npm run dev --workspace frontend` in a second terminal for the browser UI. No command enables production use: a production/staging backend start must fail closed.

## Notes

- Supplier contacts are private and excluded from public category responses.
- Prices are always recalculated on the backend from database values.
- Uploaded category images are stored under the app's local upload directory.
- Uploads accept PNG, JPEG and WebP signatures with matching MIME types, use server-generated filenames and safe serving headers, and reject SVG/HTML. Existing active uploads are not served. Raster images are not decoded/re-encoded by this dependency-free validation.
