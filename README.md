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

## GitHub Pages demo

The `pages` build targets `https://keepisc.github.io/loja-1/`. It uses `/loja-1/` for assets and hash routes such as `/loja-1/#/categories/tecnologia-demo`, so direct links and refresh do not require server rewrites.

This is a clearly labeled, fictional catalog/cart demo. It makes no backend requests, reads no local customer/cart/checkout storage, and offers no checkout, payments, order history, admin tools or contact/email delivery. Direct visits to those routes show an unavailable notice. Demo carts live only in memory. No supplier contact records, SQLite files, environment variables, uploads or generated outbox files are included; only the curated `frontend/pages-public` assets are copied. This does not change the local Express/SQLite application or complete its outstanding browser acceptance.

Build and preview the demo from the project root:

```powershell
npm run build:pages --workspace frontend
npm run preview:pages --workspace frontend
```

Open `http://127.0.0.1:4173/loja-1/` after a successful build. Use the same `pages` mode when previewing; the ordinary preview command rebuilds the local application instead. If the restricted environment reports esbuild `spawn EPERM`, run these commands in a normal PowerShell window outside that environment. A blocked build is not a successful verification.

The workflow `.github/workflows/pages.yml` runs on pushes to `main` and manual dispatch, checks/tests the frontend, builds in Pages demo mode and uploads only `frontend/dist`. It skips package install hooks because the static demo requires no Prisma generation or backend initialization. No application credentials or repository secrets are needed; GitHub's built-in deployment token is used only by Actions.

Before the first deployment, open repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**, and ensure Actions is enabled. If the `github-pages` environment has branch restrictions or required reviewers, allow `main` and approve its deployment when requested. After you review, commit and push the changes yourself, inspect the workflow result, then verify the target URL. No commit, push or live deployment is performed by preparing these files.

Browser checks still required after deployment: confirm the demo banner, catalog images and details, cart add/remove, refresh a hash detail route, and verify checkout/admin/order/outbox routes remain unavailable. In DevTools, confirm no `/api` or external backend requests occur and no contact data is present.

Verification on 2026-10-17: both TypeScript projects and the Vite configuration type-check passed; 47 automated tests passed (29 backend, 18 frontend, including four Pages regressions), and the backend compiled during testing. The production Pages build was attempted once and blocked before compilation by esbuild `spawn EPERM`. No current Pages artifact, browser run or GitHub Actions deployment is claimed as verified. A permitted local build or successful workflow run and the browser checks above are still required.

References: [Vite GitHub Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages), [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## Appearance / Themes

The local marketplace has three shared designs: **Modern Minimal**, **Dark Premium**, and **Vibrant Commerce**. Color, typography, border, shadow, radius, focus and hover tokens live in separate `frontend/src/themes/*.css` files with shared component styles. No external fonts or new dependencies are required.

Select ADMIN, open `/admin`, and use **Aparência / Temas**:

1. **Pré-visualizar** changes the entire marketplace immediately, without saving. Navigate to category, cart and checkout pages to compare the result; the preview notice remains available.
2. **Cancelar pré-visualização** returns to the latest saved theme. Switching away from ADMIN also ends the preview.
3. **Aplicar tema** saves the choice for every visitor. New visits/reloads read it from the backend; already-open pages refresh it on window focus and every 30 seconds. Preview state is never saved to browser storage or shared with other visitors.

`GET /api/appearance` returns only the active theme ID. `PUT /api/admin/appearance` requires the existing mock ADMIN session and accepts only the three built-in IDs. Arbitrary CSS and unknown properties are rejected. The active ID persists in SQLite's `SiteSetting` table. Existing databases gain that table additively on the first appearance request; no database reset, destructive migration or Prisma client regeneration is needed. The Prisma schema also declares the table for future setup commands. Other application data is preserved.

The GitHub Pages demo remains read-only and uses Modern Minimal for all visitors. Its in-memory appearance response exposes no backend configuration, and ADMIN theme changes remain unavailable there. A static Pages deployment cannot read or update the local SQLite setting; changing its shared theme would require a new static build. Local administration and persistence require the Express backend.

Theme verification on 2026-10-17: **31 backend + 25 frontend tests pass (56 total)**, including ADMIN-only updates, rejection of invalid IDs, new-client/database persistence, additive initialization, preview/cancellation, stale-response protection, Pages restrictions, token contrast ratios and CSS/Tailwind compilation. Both TypeScript projects and the Vite config type-check pass; backend compilation passes. Existing purchase/privacy/payment/delivery regressions remain green.

The frontend production build was attempted and remains **BLOCKED by esbuild `spawn EPERM`** before compilation. A headless static Chrome preview was also blocked by Windows IPC/crashpad `Access is denied`; no browser screenshots, clicks or visual acceptance checks passed. In a permitted local environment, run `npm run build --workspace frontend` and the Pages build commands above, then manually compare all themes at desktop/mobile widths, keyboard focus, contact forms, order/delivery screens and checkout. Use a second GUEST browser to verify shared application and denied theme updates; restart the backend with cookies retained to verify the saved selection. Tests used temporary SQLite files and did not change the project database.

## Add-to-cart feedback

Catalog and category-detail buttons confirm the existing shared cart update before showing feedback. A decorative 56px image follows a curved, transform/opacity-only 620ms flight to the visible cart icon (the header on desktop or the floating shortcut on mobile), which then bounces as its displayed counter updates. The cart data itself updates immediately, so navigation and checkout never wait for animation. Categories still have one entry each: rapid repeated clicks and already-added categories do not increase quantity.

A short, non-interactive `aria-live="polite"` success notice confirms the addition without moving focus. All visuals use the active theme tokens. Reduced-motion users receive an immediate counter/message without flying, scaling or bouncing. Missing/unloaded images, unavailable/offscreen cart icons and unsupported animation APIs use a small button pulse instead; reduced motion also disables that pulse. Scrolling, resizing or changing the motion preference safely cleans up an in-progress flight. Removing an item before arrival does not generate another success confirmation.

Verification on 2026-10-17: **34 frontend tests pass**, including nine animation regressions, existing theme/Pages safeguards and checkout helper checks; the frontend TypeScript check passes. The production frontend build was attempted once and remains **BLOCKED by esbuild `spawn EPERM` while loading Vite config**, before compilation. No production artifact or manual browser-animation pass is claimed. No dependencies, backend/payment/authentication logic or Pages restrictions were changed.

Manual verification still required in a permitted local environment: run `npm run build --workspace frontend`, start the existing app, and compare additions on desktop/mobile in each theme, from both the catalog and a category detail. Try rapid clicks, two different products, navigation during a flight, a missing image or offscreen header, and DevTools reduced-motion emulation. Confirm one cart entry per category, no duplicate success messages, no overlay blocking navigation, and unchanged disabled checkout in the Pages demo.

### Navigation while scrolling

The header stays in the normal page flow and sticks to the viewport top, adding a subtle shadow after scrolling. Its measured height sets the document's anchor/focus scroll clearance, including after resizing or expanding the compact mobile menu. The menu supports keyboard activation, `aria-expanded` and Escape to close and restore focus.

There is one cart icon and counter backed by the existing cart/animation stores. Below 768px, it floats at bottom-right on catalog/category screens with safe-area spacing; on cart, checkout and account/admin screens it remains in the compact sticky header to keep purchase controls clear. Mobile success feedback sits above the shortcut, and bottom padding lets the final controls/footer scroll clear. Colors, focus indicators and reduced-motion behavior use the shared theme styles. Backend, authentication and Pages restrictions are unchanged.

Verification on 2026-10-17: **41 frontend tests pass**, including scroll/resize observer cleanup, shared count additions/removals, shopping versus transaction placement, mobile animation arrival and existing theme/demo/checkout regressions. The frontend TypeScript check and in-process Tailwind/CSS compilation pass. The production frontend build is **BLOCKED by Vite/esbuild `spawn EPERM` while loading configuration**. Desktop/mobile browser, touch and keyboard interactions have **not been executed** in this restricted environment.

Manual checks: in normal PowerShell run `npm run build --workspace frontend` and `npm run dev`. Compare all three themes at desktop width and mobile widths of 390px and 320px. Scroll a long catalog, open/close Menu with keyboard and Escape, add/remove items, follow the cart shortcut, and confirm the flight reaches the visible icon with one updated badge. Check the scrolled shadow, focused controls/anchors below the header, narrow/landscape safe areas, no success-notice overlap, unobstructed checkout controls and reduced-motion emulation. Repeat catalog/cart navigation in the Pages preview; checkout must remain disabled.

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

Guests can read `/api/orders` for their own order history and `/api/orders/:id/delivery` for their own successfully delivered paid email. History requests without a valid guest credential receive 401. Other sessions receive 404 for individual order/delivery lookup; unpaid/undelivered orders receive 409. The aggregate viewer at `/dev/email-outbox` remains ADMIN-only. Email previews initially show plain text; **Ver versão HTML** opens the designed email in a sandboxed frame with scripts and remote resources blocked. **Ver texto simples** restores the text alternative. Historical text-only entries remain readable.

### Preview the email designs

Run this command from the project root (no running application or database required):

```powershell
npm run preview:emails --workspace backend
```

It builds the backend and prints paths to three fictional HTML previews and their `.txt` alternatives in a new temporary directory: purchase confirmation, supplier-contact delivery, and payment-pending confirmation. Open the printed `.html` files in your browser. All preview data uses reserved example domains; no customer records are read, modified or sent. The example HTTPS buttons demonstrate styling and do not point to a working marketplace.

For actual local deliveries, start the application with `npm run dev`, complete a dummy purchase, switch to ADMIN and visit http://localhost:5173/dev/email-outbox. Choose **Ver versão HTML** on its email, or open the paid delivery from the guest's own order detail page. Preview the HTML at desktop and narrow mobile widths; also check the plain-text view. The table layout uses inline CSS, system fonts, text branding and an Outlook conditional wrapper, without external images or styles. Actual Gmail, Outlook and Apple Mail rendering must still be checked manually; browser previews and automated rendering tests do not certify mail-client compatibility.

The existing workflow still creates one email after verified payment, combining the purchase summary with the purchased contacts. The separate confirmation renderer is contact-free, including pending/failed/unverified states; it adds no new send event. New deliveries store both representations together in the existing `EmailDelivery.body` field using a versioned envelope. APIs preserve the plain-text `body` and include optional `html` only behind the existing paid-order/ADMIN guards. No schema migration or rewrite of historical emails is needed.

Order buttons are omitted by default for local HTTP and GitHub Pages demos. Optionally set `EMAIL_APP_URL=https://your-marketplace.example` in the local `.env` for a full HTTPS marketplace; restart the backend afterward. The configured base path is preserved, and only absolute HTTPS URLs without embedded credentials are linked. Order links still require an authorized session and grant no access by themselves. Unsafe or non-HTTPS supplier website values are displayed as escaped text without a clickable link.

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
