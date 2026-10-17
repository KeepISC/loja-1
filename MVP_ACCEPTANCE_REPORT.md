# MVP Local Acceptance Report

Initial acceptance: 2026-10-16. Final evidence review: 2026-10-17 (Europe/Lisbon). Reviewed `CODE_REVIEW.md`, `PHASE1_FIX_REPORT.md`, `PHASE2_FIX_REPORT.md`, this report and `MVP_FINAL_FIX_REPORT.md`.

## Final recommendation: NOT READY

Purchase, payment, privacy and dummy email delivery **pass automated checks and live HTTP acceptance against the backend started through `npm start`**. The latest completed verification passes both TypeScript projects, all **43 regression tests (29 backend + 14 frontend)** and the backend build.

The frontend development server and production build **remain blocked in this environment** by esbuild `spawn EPERM`. No successful browser acceptance run or subsequent successful frontend build is recorded. Local MVP v1.0 cannot be signed off. **Guest access after a backend restart is now fixed and verified**, using a persistent guest credential checked against SQLite rather than relying on the in-memory role session.

This finalization updates only this report. It reuses the completed verification evidence and does not rerun the full audit, automated suites or known-blocked commands. Application source and database data were not changed. README already documents the corrected guest persistence and startup commands; README and CHANGELOG were not changed because release acceptance remains incomplete.

## Final acceptance gate review

PASS means the specific recorded automated/API verification passed; it does not assert browser acceptance.

| Required criterion | Result | Latest evidence |
| --- | --- | --- |
| All HIGH findings resolved | **PASS — recorded regression evidence** | Original S01–S05 resolved in Phase 1; later V01 (stale compiled backend) resolved in Phase 2. Latest regression log passes ownership, outbox restriction, paid-only delivery, upload restrictions and compiled production/staging refusal. No HIGH finding remains open in these reports. |
| Guest order access survives backend restart | **PASS — real process restart** | Final fix ran `npm start` twice against one isolated SQLite file, stopped the first process and changed the role-session secret. The original guest credential restored owned pending/paid orders, history and paid email. See `MVP_FINAL_FIX_REPORT.md`, sections 1 and 4. |
| Unauthorized access remains blocked | **PASS — automated/API** | Foreign, missing and invalid guest credentials cannot read/confirm another order or read its email; guest ADMIN requests return 403. Individual denied lookups return 404; unauthorized history returns 401. |
| Automated tests | **PASS** | Latest saved run: 29 backend + 14 frontend = 43 passed; zero failed/skipped. |
| Frontend/backend TypeScript | **PASS** | Latest `npm run typecheck` completed both projects, exit 0, as recorded in the final fix report. |
| Backend build | **PASS** | Latest `npm run build` completed backend TypeScript compilation before the frontend failure. |
| Frontend build and startup | **BLOCKED** | Latest frontend build fails with `spawn EPERM`; earlier dev startup has the same blocker. No later successful build/start evidence exists. |
| Browser acceptance completed successfully | **NOT VERIFIED / BLOCKED** | No browser run was performed. Store tests, server rendering and HTTP tests do not replace browser form/navigation/refresh/responsive checks. |
| Local dummy payment and email delivery | **PASS — automated/API** | PENDING → PAID → SENT, purchased-category contacts only; repeated confirmation retains one delivery with attempts=1, including after restart. |
| Supplier contacts protected before payment | **PASS — automated/API** | Public category responses exclude private contacts; unpaid delivery and ADMIN retry return 409 without exposing contact bodies. |

Reviewed saved evidence under `%TEMP%/mvp-final-fix-WcC39R/`: `final-tests.log`, `final-build.log`, `diagnostic.json`, and `handle-probe.json`. Relevant source/test modification times precede the completed verification. Results are reused from those runs, not represented as new executions during finalization.

**Release actions:** no commit or annotated `v1.0.0` tag was created. Acceptance gates do not all pass, and `git status --short` confirms this directory is not a Git repository. No repository initialization, staging, tag replacement, push or publication was performed.

## Original acceptance execution and data safety (2026-10-16)

- Environment: Windows PowerShell, Node v24.11.0, npm 11.13.0.
- The project database was inspected read-only first: all seven application tables existed and `PRAGMA quick_check` returned `ok`; category/contact tables and mock-user rows were initially empty.
- The documented seed script was attempted and blocked by tsx/esbuild `spawn EPERM`. The same existing, non-destructive seed implementation was then run through the installed in-process source loader. The project database now contains **six demo categories, twelve fictional contacts and the ADMIN/GUEST mock rows**. No existing data was reset or deleted.
- Purchase acceptance used a separate temporary SQLite database with fictional data, initialized from the existing test schema fixture and seeded using the application seed function. It did not create test purchases in the project database.
- The real `npm start` script built and launched the backend twice against that isolated database on `http://127.0.0.1:56132`. HTTP requests used separate ADMIN, buyer and other-customer cookie jars. This was a real process stop/restart, not merely a second Prisma client or a new Express app instance.
- One image was uploaded through the actual HTTP endpoint into the configured upload directory. Its bytes/URL survived restart. After verification, only that newly created UUID image was removed after checking its path and exact contents; existing upload files were untouched.
- Both acceptance backend processes were stopped and the port was confirmed unreachable. Temporary evidence/data remain under `%TEMP%/mvp-acceptance-acBhMk/`.
- Fingerprints confirmed the inspected application source, configuration, README, lockfile and previous reports were unchanged. Backend output was rebuilt through the existing scripts. The only intended persistent project-data change was adding the missing demo seed records; the only new project document is this report.

## Acceptance results

**PASS below means the stated automated/API check ran successfully. It does not mean a person clicked through the browser UI.**

| Verification | Result | Evidence |
| --- | --- | --- |
| Backend startup using project script | **PASS** | `npm start` rebuilt the current backend, listened on the selected loopback port and served `/api/health` with 200. Repeated successfully after stopping the process. |
| Frontend startup using project script | **BLOCKED** | `npm run dev --workspace frontend` exited 1 loading Vite config; esbuild `spawn EPERM`. No frontend acceptance server was available. |
| Existing SQLite schema/integrity | **PASS** | Seven application tables found; integrity check `ok` before and after demo initialization. Prisma queries and writes worked during live HTTP acceptance. |
| Fresh SQLite initialization through Prisma CLI | **BLOCKED** | Safe diagnostic against a temporary database: `prisma db push --skip-generate` could not spawn `schema-engine-windows.exe` (`EPERM`). The existing project schema was not pushed/reset. Fresh installation is not certified by the fixture-based tests. |
| Demo data availability | **PASS — fallback seed runner** | Existing application seed produced six categories, twelve contacts and both mock users. Standard npm seed command itself remains blocked in this environment. |
| Switch to ADMIN/GUEST | **PASS — automated/API** | Live ADMIN switching returned 200; the buyer resolved as GUEST. Regression tests also verify reversible ADMIN/GUEST switching and shared identity state. |
| ADMIN category create/edit | **PASS — live HTTP** | Created two fictional categories; edited A's name and price; responses 201/200 and subsequent reads matched. |
| ADMIN contact add/edit/remove | **PASS — live HTTP** | Added and edited the purchased supplier, created/deleted another contact, and verified the remaining list contained exactly one contact. |
| ADMIN image upload | **PASS — live HTTP** | PNG upload returned 200 with a generated URL. Retrieval returned exact bytes and image MIME/`nosniff`. Visual image decoding/rendering is not verified. |
| ADMIN orders/payment status inspection | **PASS — live HTTP** | ADMIN order list exposed the expected PENDING and PAID orders; paid order metadata matched the stored total and delivery state. Dashboard clicks were not tested. |
| GUEST category list/detail privacy | **PASS — live HTTP** | Public endpoints returned 200 without either acceptance supplier's private email. |
| Cart add/remove | **PASS — automated store check** | Actual frontend cart store went from two categories to one after removal. Existing component/store tests also passed. No browser cart clicks were performed. |
| Checkout and server-side pricing | **PASS — live HTTP + real checkout helper** | Actual frontend checkout helper called the running backend. Order total was the stored 1,750 cents. Regression tests additionally passed forged total/price/role/status inputs. |
| Order before payment | **PASS — live HTTP** | Order/payment=PENDING, delivery=NOT_SENT, body empty and attempts=0 before confirmation. |
| Successful dummy payment/email | **PASS — live HTTP** | Simulation produced order PAID and email SENT. The owned preview and ADMIN outbox agreed. No real external email was sent. |
| Email contains purchased contacts only | **PASS — live HTTP** | Purchased category A's edited supplier appeared; unpurchased category B and the removed supplier were absent. Recipient matched the submitted delivery email. |
| Unpaid orders cannot deliver | **PASS — live HTTP** | Unpaid guest preview and ADMIN retry returned 409. The delivery intent had no body or send attempt. A NOT_SENT placeholder is not a generated contact email. |
| Guest denied ADMIN APIs | **PASS — live HTTP** | Category, contact, dashboard and order administration returned 403 to GUEST. Guest aggregate outbox also returned 403. |
| Other customer's order/delivery denied | **PASS — live HTTP** | Separate cookie jar received 404 for order read, confirmation and paid delivery preview. Buyer likewise could not read the other customer's order. |
| Duplicate confirmation/delivery | **PASS — live HTTP** | Concurrent buyer confirmation, ADMIN confirmation and retry returned 200 but retained one delivery row with attempts=1. Reconfirmation after restart also retained attempts=1. |
| Invalid uploads | **PASS — live HTTP + regressions** | HTML disguised as PNG and active SVG returned 400. Existing tests also passed size-limit, MIME mismatch and unauthorized-upload checks. |
| Invalid checkout requests | **PASS — live HTTP** | Invalid email, empty items, unavailable category and malformed JSON returned 400; ADMIN order count did not increase. Backend remained responsive. |
| Persisted business data after restart | **PASS — actual process restart** | Edited category/price/contact, paid order/items/payment, exact email body and uploaded image persisted. ADMIN could inspect them in a new session. |
| Existing guest access after restart | **PASS — fixed; actual process restart** | The initial acceptance failure is superseded by `MVP_FINAL_FIX_REPORT.md`: the durable HttpOnly guest credential restores owned orders/history/email after an actual stop/restart, even with a different role-session secret. Foreign/missing/invalid credentials remain denied. |
| Production fail-closed startup | **PASS** | Actual production-mode `npm start` rebuilt, then exited 1 with the intended development-only guard before listening. Regression tests also passed staging/retained-app guards. |
| Manual browser ADMIN/GUEST journey, navigation, refresh and mobile layout | **BLOCKED** | No browser automation connector or installed Playwright/Puppeteer was available; frontend runtime was also blocked. No manual/browser check is reported as passed. |

## Final checks and builds

Latest completed verification is from the final guest-persistence fix on 2026-10-17; the original acceptance run had 39 tests. The updated results below reuse that later evidence. No new tests, builds or application runs were performed during this document finalization. The production-start refusal below is retained from the original acceptance run and is also covered by the latest compiled-app regressions.

| Command | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — backend and frontend, exit 0. |
| `npm test` | **PASS** — 29 backend + 14 frontend tests; 43 passed, 0 failed, 0 skipped. Includes four guest-credential regressions. Node's built-in SQLite experimental warning was emitted. |
| `npm run build` — backend stage | **PASS** — TypeScript compiled current backend artifacts. |
| `npm run build` — frontend stage | **BLOCKED** — Vite/esbuild `spawn EPERM` at `ensureServiceIsRunning` while loading `frontend/vite.config.ts`. Root build exited 1. No frontend artifact success is inferred. |
| `$env:NODE_ENV = 'production'; npm start` | **PASS: expected refusal** — rebuild completed; compiled configuration threw `This MVP requires NODE_ENV=development. Real providers are required outside development.` Exit 1, no server. |

Supplemental initialization attempts from the original acceptance run, not repeated during finalization:

- `npm run seed --workspace backend`: **BLOCKED**, tsx `TransformError: spawn EPERM` from esbuild.
- `node --import ./backend/test/source-loader.mjs backend/src/seed.ts`: **PASS**, same existing seed code, no source changes or dependency installation.
- Installed Prisma CLI `db push --schema prisma/schema.prisma --skip-generate` with DATABASE_URL pointing to a temporary file: **BLOCKED**, native schema-engine `spawn EPERM`.

## Remaining defects, limitations and acceptance gates

1. **Frontend runtime/build blocker — unresolved environmental restriction.** `frontend/package.json:7`, `:8` invoke Vite, whose esbuild piped subprocess fails with `spawn EPERM`. The final fix diagnostics show the matching installed esbuild 0.21.5 binary runs directly and with inherited handles; plain Node with piped subprocess handles fails independently of Vite, and a configuration-free esbuild transform fails too. This is not evidence of an application configuration or missing-binary defect. An outside-Codex comparison is still required to distinguish the execution sandbox from host Windows process/pipe policy. Run the existing frontend build/start in a permitted local PowerShell window and retain the successful results. Exact probes and commands are in `MVP_FINAL_FIX_REPORT.md`, section 5. Existing frontend `dist` is not accepted as a current verified build.
2. **Fresh initialization/standard seed blocker — unresolved in this environment.** Prisma's schema engine and tsx/esbuild subprocesses are blocked. Existing schema/query runtime and the seed implementation worked, but this does not prove the normal fresh-install path. Relevant scripts: `backend/package.json:11`, `:12`, `:13`.
3. **Browser acceptance outstanding.** Server rendering and store/API/helper tests do not validate form clicks, effects, file-picker interaction, visual rendering, browser storage, refresh behavior or responsive layouts. No evidence supports marking these checks passed.

**Resolved blocker / retained credential limits:** guest restart continuity is no longer an open defect. `backend/src/guest-access.ts:17` resolves a high-entropy, expiring cookie through its SQLite digest; `backend/src/app.ts:149` authorizes orders using that resolved owner. Clearing/expiring/revoking the guest cookie intentionally removes access without deleting orders. Lost credentials from the previous version and former shared-guest purchases cannot safely be recovered by email/order ID and remain ADMIN-accessible. ADMIN role sessions remain in memory and require switching again after restart. These limits are documented in README.

No additional purchase/payment/contact-leakage defect was reproduced in the current backend. That result is limited to the checks performed; the unavailable browser path remains unverified.

## Exact startup commands

The project database now has demo data. Existing dependencies and generated Prisma client are present. Use two PowerShell terminals from the project root; no reset or reseeding is necessary.

Terminal 1 — backend:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
$env:ALLOW_MOCK_PAYMENT = 'true'
$env:PORT = '3001'
npm start
```

Terminal 2 — frontend, in a normal PowerShell window outside the restricted execution context. Retain a successful build before starting:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
npm run build --workspace frontend
npm run dev --workspace frontend
```

Expected URLs:

- Storefront: `http://localhost:5173/`
- ADMIN: `http://localhost:5173/admin`
- Cart/checkout: `http://localhost:5173/cart`, `http://localhost:5173/checkout`
- Guest orders: `http://localhost:5173/orders`
- Order detail: `http://localhost:5173/orders/<order-id>`
- Verified success: `http://localhost:5173/success?orderId=<order-id>`
- ADMIN email outbox: `http://localhost:5173/dev/email-outbox`
- API health: `http://127.0.0.1:3001/api/health`

For an optional explicit non-destructive seed rerun in this restricted environment:

```powershell
$env:NODE_ENV = 'development'
node --import ./backend/test/source-loader.mjs backend/src/seed.ts
```

The normal environment's documented seed command remains `npm run seed --workspace backend`. Do not reset/delete the database to address an engine/process-permission error. Fresh-install generation/schema commands are in README and still need verification where those engines can run.

## Required manual browser checklist

All steps below are **NOT PERFORMED / BLOCKED here**. Use fictional supplier and delivery data. Preserve existing records.

1. Start both services above; confirm health, then open the storefront at desktop and narrow/mobile widths. Confirm six demo categories appear and category images render.
2. Select **ADMIN**, open `/admin`, create two uniquely named acceptance categories A/B with different prices. Edit A's name/price, save and verify the values. Select A and add supplier A; edit its name/email; add a second disposable supplier and delete only that newly created record. Give B a distinct supplier B. Upload a known valid PNG/JPEG/WebP and verify it actually renders; try SVG/HTML and confirm rejection.
3. Select **GUEST**. Inspect list/detail responses in browser DevTools: no supplier emails/phones/notes should be present. Add A/B to the cart, remove B, check the badge and total, navigate away/back and refresh. Only A should remain.
4. Open checkout with `acceptance@example.test`, click **Simular pagamento**, and verify the server-verified success state and charged total. Refresh the success URL. Open `/orders`, choose the paid order and **Ver email de entrega**. Confirm A's edited contact appears, while B and the removed contact do not.
5. Switch to **ADMIN**, open `/dev/email-outbox` and inspect the same delivery/recipient. Confirm only one SENT row/attempt for this new order. Inspect dashboard/order statuses. Return to GUEST and verify `/admin` and the aggregate outbox show restricted access.
6. With GUEST selected, DevTools `await fetch('/api/admin/orders', {credentials:'include'}).then(r => r.status)` must return **403**. Copy the new order ID; a separate private/incognito browser session must receive **404** for `/api/orders/<id>` and `/api/orders/<id>/delivery` and must not see the order in `/orders`.
7. To inspect a deliberately paused order, create one in the GUEST DevTools console (replace the category ID):

   ```javascript
   var acceptanceOrder = await fetch('/api/orders', {
     method: 'POST', credentials: 'include',
     headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({customerEmail: 'acceptance@example.test', items: [{categoryId: 'COPY_CATEGORY_ID'}]})
   }).then(r => r.json());
   acceptanceOrder.order;
   ```

   Verify PENDING order/payment and NOT_SENT delivery in `/orders/<id>`. Its delivery endpoint must return **409**. In ADMIN, retrying that unpaid order via `/api/dev/email-outbox/retry/<id>` must also return **409** and expose no body. Return to the owning GUEST session/detail and simulate payment; verify PAID/SENT and the correct contacts.
8. Repeat `POST /api/dev/payments/<paid-order-id>/simulate` twice/concurrently in the owning GUEST session. Both should succeed without adding a second email or increasing successful delivery attempts. Try checkout payloads with invalid email, empty items or nonexistent category; expect **400**, no added order and a responsive application.
9. Keep the owning browser's cookies and stop/restart only the backend. Refresh `/orders` and the previous order/delivery: the same GUEST must retain access without ADMIN switching. A separate GUEST session must remain denied. Then select ADMIN again and confirm category/contact/image and paid/email data persist. Do not clear cookies while testing restart continuity.
10. Run `npm run typecheck`, `npm test`, `npm run build` in the permitted environment and retain successful frontend build/browser results. Production-mode backend startup must continue to refuse service.

**Release decision remains NOT READY for local MVP v1.0.** Guest restart continuity and the reported HIGH findings are resolved under the recorded automated/API checks. Successful frontend build/start and actual browser acceptance remain required; no release commit, changelog or tag is created until every required gate passes.
