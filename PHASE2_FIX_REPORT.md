# Phase 2 Fix Report

Date: 2026-10-16.

## Outcome

Implemented the remaining confirmed findings: **V01 (HIGH), F03/V02 (MEDIUM), and F04/V03 (LOW)**. Existing Phase 1 security/workflow regressions still pass. SQLite, its schema, both dummy providers, the development-only boundary and the existing visual style remain. No dependencies or external services were added; no real authentication/payment integrations or data migrations were introduced.

**Final results: 39 tests PASS, both TypeScript projects PASS, backend build PASS. Frontend build BLOCKED by esbuild `spawn EPERM`.** The compiled backend and its real start command now enforce the fixes. Browser/mobile interaction remains unverified.

The reported code findings are addressed with targeted test evidence. **Full manual acceptance remains blocked in this execution environment by the frontend toolchain restriction.** The backend/API workflow is ready for local testing; browser acceptance can begin on a machine where Vite/esbuild executes. No browser acceptance pass is claimed.

## Resolved findings

| Finding | Fix | Evidence |
| --- | --- | --- |
| **V01 — HIGH: stale compiled backend selected by start** | `backend/package.json` now rebuilds before `start`; a failed compilation prevents launch. Compilation uses the installed Prisma client, with client generation retained as an explicit setup/schema-change command rather than an unconditional network-dependent build step. Backend tests also build first. `backend/dist` was regenerated from current source. Frontend preview similarly builds first instead of silently serving old UI artifacts. | Backend compilation passed. Tests against the actual compiled app reject production/staging startup and enforce ownership/delivery privacy. The actual root `npm start` with NODE_ENV=production rebuilt successfully, then exited 1 with the intended development-only guard before listening. The previously demonstrated production DUMMY checkout/contact leak is no longer reachable through that start path. |
| **F03 / V02 — MEDIUM: missing administration/order/email screens** | Added category create/edit/deactivate controls, price/active state, raster image upload, and supplier-contact create/edit/delete controls within the existing admin dashboard. Added `/orders`, `/orders/:id`, and `/dev/email-outbox` screens. Guest history is scoped server-side to the current session customer; delivery preview requires ownership/ADMIN, order/payment PAID and delivery SENT. The aggregate outbox remains ADMIN-only. Pending orders can simulate payment from their detail screen; failed paid deliveries can retry. Upload requests preserve the browser's multipart boundary. | API regressions verify scoped history, unpaid delivery 409, another session's delivery 404, metadata-only ordinary responses and production blocking. Compiled-backend integration exercises category/contact CRUD, checkout, paid email preview and idempotent replays. Frontend tests cover routes, restricted viewer, category forms, multipart headers and escaped email contents. Browser clicks/effects remain for manual acceptance. |
| **F04 / V03 — LOW: incorrect/unverified success display** | Success and order detail share a server-backed order screen. It reads the router location's order ID or the refresh-safe `?orderId=` URL; router-supplied payment status is never trusted. Until the owned-order request succeeds, it shows verification/loading/error text. Missing, pending, paid-but-undelivered, unavailable and delivered states have distinct output. Checkout now navigates with the persisted order ID in its URL. | Tests prove direct/forged success visits do not assert confirmation, missing IDs do not fetch, request IDs are encoded, authorization errors propagate, and only a verified PAID payment/order with SENT delivery gets completed-delivery text. Pending/failed delivery states remain distinct. |

The other original findings were already fixed in Phase 1; their existing tests were retained and passed. All ordinary order responses still omit contact bodies. The new paid delivery endpoint is intentionally separate from order metadata and authorizes every request.

## Files changed

| File | Change |
| --- | --- |
| `backend/package.json` | TypeScript-only compilation, build-before-start and build-before-test lifecycle hooks. |
| `backend/src/app.ts` | Session-scoped order history and authorized, paid/SENT delivery preview endpoints. |
| `backend/test/marketplace.test.mjs` | Three new regressions: scoped history/delivery; compiled production guards; compiled purchase/administration/privacy/idempotency workflow. |
| `backend/test/source-loader.mjs` | Resolve extensionless `.tsx` imports for source component tests. |
| `backend/dist/app.js`, `backend/dist/config.js`, `backend/dist/index.js`, `backend/dist/seed.js` | Current generated backend output from successful compilation. |
| `frontend/src/App.tsx` | Integrate new screens/admin controls, accessible navigation links and refresh-safe success URL; remove incorrect success component and reuse API/order modules. |
| `frontend/src/MarketplacePages.tsx` **(new)** | Admin category/contact/image management, guest orders/detail, paid email preview and restricted outbox pages using existing styling. |
| `frontend/src/orders.ts` **(new)** | Shared order type, owned-order loading and payment/delivery status classification. |
| `frontend/src/api.ts` **(new)** | Existing fetch behavior shared by the new pages; distinguish JSON and multipart requests. |
| `frontend/test/workflow.test.mjs` | Six new regressions for management forms, routes, multipart requests, success verification/states and text-safe email rendering. |
| `frontend/package.json` | Build-before-preview lifecycle guard. |
| `README.md` | Setup/client generation, new routes/features, safe startup and storage/privacy instructions. |
| `PHASE2_FIX_REPORT.md` **(new)** | This report. |

Earlier reports, `.env`, `package-lock.json`, the Prisma schema and existing development data were preserved. There is no Git repository in the supplied directory, so working-tree/staging inspection was unavailable. No commit, deployment, remote change or destructive database operation was performed.

## Consolidated verification

Environment: Windows PowerShell, Node v24.11.0, npm 11.13.0. Focused regressions were run while implementing. After all application/test changes, one consolidated sequence ran:

| Check | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — backend and frontend exit 0. |
| `npm run build` — backend stage | **PASS** — `tsc -p tsconfig.json` regenerated the actual backend runtime artifacts. |
| `npm run build` — frontend stage | **BLOCKED** — Vite fails loading `frontend/vite.config.ts`; installed esbuild cannot spawn its service (`Error: spawn EPERM` at `ensureServiceIsRunning`). Root build consequently exits 1. No frontend build success is inferred. |
| `npm test` | **PASS** — 25 backend + 14 frontend tests, 39 passed, 0 failed/skipped. This includes the previous 30 tests and nine added tests. Backend pretest performs its required compilation; Node emits its built-in SQLite experimental warning. |
| Actual `$env:NODE_ENV = 'production'; npm start` | **PASS: refused as required** — prestart builds, then compiled startup exits 1 with `This MVP requires NODE_ENV=development. Real providers are required outside development.` No server is started. |
| Compiled-backend end-to-end API/helper purchase | **PASS** — detailed sequence below. |
| Browser/mobile interactions and visual rendering | **NOT VERIFIED** — no browser automation was installed; frontend execution/build is blocked in this environment. Server rendering does not verify client effects or clicks. |

No Prisma generation/schema push was necessary for the unchanged schema. The existing generated client and query runtime were used. Fresh installation/client generation was not reverified; it remains a setup operation that needs the appropriate native binaries. No build/test command here changes the development schema.

### Purchase and privacy evidence

The new integration test uses the **compiled backend**, the actual frontend checkout helper, managed loopback servers and a temporary SQLite database/upload directory. It does not use real customer/supplier data or an existing user-running server.

1. ADMIN creates and edits a category, adds/edits a supplier, deletes a second contact, and reads the remaining contact list.
2. GUEST browses public list/detail without seeing the private email.
3. Checkout receives a PENDING order/payment and NOT_SENT delivery; the server charges the stored 1,950 cents despite a client cart price of 1 cent.
4. Unpaid delivery retry returns 409; another session's order returns 404; the guest aggregate outbox returns 403.
5. Dummy confirmation changes the order to PAID and the local SQLite dummy email to SENT. The guest's owned preview has the requested recipient and purchased supplier, with neither the removed contact nor an unpurchased category's contact.
6. Another session's paid delivery remains 404. Guest history contains the owned order; ADMIN can inspect the aggregate outbox.
7. Concurrent guest/admin confirmations and retry all return 200 while retaining one delivery row with attempts=1.
8. Category deactivation removes it from the public catalog. Separate regressions retain rollback, failed-delivery recovery, upload restrictions, forged-status/price protection and production guards.

## Remaining limitations and acceptance readiness

- **No confirmed original code findings remain open under the tested scenarios.** The outstanding blocker is environmental: frontend build/start needs permission for the installed esbuild process to execute. Existing frontend `dist` is not certified as current; `npm run preview --workspace frontend` now builds first and will stop on the blocker rather than serve stale assets.
- Full browser testing is still required for form submission, contact editing, image selection/rendering, identity switching, checkout navigation/refresh, paid email display and mobile layouts. These are acceptance tasks, not reported as automated browser passes.
- The existing development-only in-memory sessions remain: clearing cookies or restarting the backend loses guest access to earlier orders; ADMIN retains access. Existing shared-guest historical orders are not reassigned to arbitrary visitors.
- Dummy email delivery means committing a local SQLite outbox record, not sending real email. Upload validation retains the Phase 1 raster-signature/safe-serving approach rather than a complete image decoder. Production remains intentionally disabled.

**Readiness:** backend/API and the implemented UI source are ready for targeted manual acceptance with fictional data on a machine where Vite can run. Complete acceptance cannot be performed or signed off in this restricted environment until frontend execution and browser checks succeed.

## Exact local commands and URLs

For this existing workspace (dependencies, generated Prisma client and database already present), use PowerShell from `C:\Projects\Projeto 50k`.

Terminal 1 — backend; the start hook recompiles current source:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
$env:ALLOW_MOCK_PAYMENT = 'true'
$env:PORT = '3001'
npm start
```

Terminal 2 — frontend, in an environment permitting Vite/esbuild:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
npm run dev --workspace frontend
```

Verification commands:

```powershell
npm run typecheck
npm test
npm run build
```

For a fresh checkout only, follow README setup (`npm install`, create `.env` without overwriting an existing file, `npm run db:generate --workspace backend`, `npm run db:push --workspace backend`). Optional demo initialization is `npm run seed --workspace backend`; normal startup does not seed or reset data.

| Purpose | URL |
| --- | --- |
| Storefront/cart/checkout | `http://localhost:5173/`, `/cart`, `/checkout` |
| ADMIN category/contact/image management | `http://localhost:5173/admin` |
| Owned order history | `http://localhost:5173/orders` |
| Owned order / verified success | `http://localhost:5173/orders/<id>`, `http://localhost:5173/success?orderId=<id>` |
| ADMIN development email viewer | `http://localhost:5173/dev/email-outbox` |
| API health | `http://127.0.0.1:3001/api/health` |

Use ADMIN to create a category/contact, switch to GUEST, purchase it, inspect `/orders` and its paid email, then use ADMIN's outbox viewer. Use a separate browser profile to check order/delivery denial. A direct `/success` visit must request an order rather than claim payment. These URLs assume the default frontend port 5173 and backend port 3001; existing orders remain private to their original session/ADMIN.
