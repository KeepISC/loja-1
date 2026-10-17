# Phase 1 Fix Report

Date: 2026-10-16. Basis: the existing `CODE_REVIEW.md`, checked against the current implementation before editing.

## Outcome and scope

**Resolved with source changes and regression evidence: all five HIGH findings (S01–S05), both security MEDIUM findings (S06–S07), and workflow findings F01, F02, F05, F06 and F07.** This is 12 original findings: 5 HIGH and 7 MEDIUM. F03 and F04 remain unresolved.

The React UI, Express/Prisma architecture, SQLite schema and dummy payment/email providers remain. No real authentication, payment integration, external service, dependency installation or database migration was introduced. Existing application records were not modified by verification. `CODE_REVIEW.md`, `.env` and `package-lock.json` are unchanged; the review's SHA-256 remains `D1CFFD0B1D07FFCC3F554354A07139C10E166887778EDAEE5FE02464F31644AF`.

**Final verification: both TypeScript projects PASS; 30 automated tests PASS (22 backend, 8 frontend). Both build scripts were attempted and blocked by environmental restrictions. Browser interaction and mobile rendering remain NOT VERIFIED.**

## Findings resolved

| Original finding | Changes | Verification evidence |
| --- | --- | --- |
| **S01 — HIGH: order/payment ownership** | `backend/src/app.ts:142`, `:332`, `:418`, `:436`: each guest session gets an internal customer UUID; orders attach to that customer rather than the shared guest. Reads/simulation require ownership or ADMIN and use 404 for inaccessible orders. Explicit customer response fields exclude delivery bodies and internal ownership IDs. | Two guest cookie jars have distinct stored owners. Unrelated/anonymous reads and simulation return 404, both pending and paid; owner reads and ADMIN access succeed. Ordinary responses contain no supplier contact bodies. |
| **S02 — HIGH: public outbox** | `backend/src/app.ts:625`: aggregate outbox requires ADMIN. Contact bodies are returned only when delivery is SENT and both order and payment are PAID. Customer/admin order summaries contain delivery status, not bodies. | Public/guest outbox access returns 403. ADMIN can inspect a paid delivery. A seeded legacy unpaid SENT record is redacted. Public category and unauthorized admin/contact APIs do not disclose fixture contacts. |
| **S03 — HIGH: unpaid delivery retry** | `backend/src/app.ts:203`, `:638`: paid-state enforcement lives inside the delivery provider, including the already-SENT case. The retry route uses that same guarded operation. | ADMIN retry of a PENDING order/payment returns 409 without an attempt or body. An unpaid legacy SENT record also cannot bypass the check. |
| **S04 — HIGH: executable uploads** | `backend/src/app.ts:18`, `:43`, `:83`, `:531`: memory uploads have a 2 MiB limit; SVG/HTML are rejected; PNG/JPEG/WebP signatures must match declared MIME; filenames/extensions are server-generated. The target category is checked before persistence. Upload serving validates existing bytes/extensions and forces raster MIME, `nosniff` and sandbox CSP. Arbitrary public-directory serving was removed so legacy active files cannot bypass the upload handler. | Spoofed HTML, SVG, SVG disguised as PNG, MIME mismatch, oversized and unauthorized uploads fail. A valid PNG uploaded with an untrusted HTML filename receives a generated `.png` URL and safe headers. Legacy HTML and HTML disguised as PNG return 404, including an encoded path variant. Missing-category upload creates no file. |
| **S05 — HIGH: production fails open** | `backend/src/config.ts:5`, `:13`; `backend/src/app.ts:70`, `:133`; `backend/src/index.ts:6`; `frontend/vite.config.ts`: root environment loading is explicit; inherited variables win. Startup refuses every NODE_ENV except development. An additional request guard disables an existing app if its environment changes. Both mock confirmation paths require `ALLOW_MOCK_PAYMENT=true`. Runtime servers bind loopback; Vite proxies target IPv4 loopback consistently. The predictable fallback session secret was replaced with a random development-only fallback. | Startup throws in production, staging, test and empty mode. Previously constructed apps return 503 rather than identities/orders/emails after a mode change, including retained ADMIN retry/confirmation. With mock payment disabled, confirmation returns 403 and payment stays PENDING. |
| **S06 — MEDIUM: duplicate/racy delivery** | `backend/src/app.ts:181`, `:203`: existing `EmailDelivery` rows are the persistent local dummy outbox. A transaction claims an unsent paid delivery before building/storing its body and SENT status. No JSON read/append/write or separate send-before-save effect remains. Guest, admin and retry routes share the same operation. Payment timestamps are updated only on the first PENDING transition. | Three concurrent guest/admin confirmations across two app instances succeed with one delivery row and attempts=1. Subsequent guest/admin confirmations and retry do not increment attempts or replace `confirmedAt`. |
| **S07 — MEDIUM: partial states and failed-delivery recovery** | `backend/src/app.ts:181`, `:203`, `:389`, `:426`: nested writes create order/items/payment/delivery atomically. Payment and order transitions share a transaction. A paid replay attempts incomplete delivery instead of returning early. Operational delivery failures record FAILED, attempts and a sanitized error; a later replay retries that same order. A legacy PAID-payment/PENDING-order mismatch is reconciled. Invalid cancelled/failed states are rejected. | SQLite fault triggers demonstrate complete creation rollback, payment rollback when order transition fails, and paid-but-failed delivery recovery. A subsequent retry delivers once, keeps the order ID, clears failure state, and later replays do not resend. Legacy mismatch recovery preserves the original confirmation time. |
| **F01 — MEDIUM: independent/duplicate cart state** | `frontend/src/stores.ts:37`, `frontend/src/App.tsx:96`: header, buttons, cart and checkout subscribe to one store. Functional updates use its current value; persisted inputs are validated and category IDs deduplicated. | Two subscribers see the same additions/removals; A+B+A remains A+B and totals 4,000 cents. Corrupt/blocked storage is handled. Actual header/cart components rendered from the shared snapshot show both categories and a count of two. |
| **F02 — MEDIUM: stale/reversible identity switching** | `frontend/src/stores.ts:52`, `frontend/src/App.tsx:86`, `backend/src/app.ts:119`: auth uses a shared subscribed store, and switching returns the same complete mode/capability payload as auth lookup. | ADMIN→GUEST→ADMIN switching stays enabled and matches server identity. Multiple auth subscribers receive every switch. Header/admin component renders reflect the current shared identity. |
| **F05 — MEDIUM: launch-directory-dependent paths** | `backend/src/config.ts:5`, `backend/src/app.ts:73`, `:96`: environment, assets and default upload paths are resolved from module location, not cwd. A configurable app-construction upload directory isolates test files. | Constructing/running the app from a temporary cwd serves the shipped default category image (200). The default upload path is asserted to be `<project>/backend/public/uploads`. |
| **F06 — MEDIUM: reseeding overwrites changes** | `package.json:9`, `backend/src/seed.ts:83`: startup no longer seeds. Explicit seeding initializes missing categories/contacts together, leaves existing category/contact records untouched and is restricted to development. | Repeated seed execution against temporary data preserves an edited name, deactivated state and changed price; deleted demo contacts remain deleted. |
| **F07 — MEDIUM: crashes/hangs and duplicate checkout retries** | `backend/src/app.ts:39`, `:643`: every async route forwards errors to centralized sanitized handling; expected conflicts/not-found/invalid JSON have controlled responses. `frontend/src/checkout.ts:14` preserves a checkout key/order ID across failures and sessionStorage reloads. Backend creation reuses the session-scoped checkout key and rejects changed payloads. | Duplicate slug returns 409, missing update 404, malformed JSON 400, and unexpected async errors a sanitized 500; health remains available. Lost creation responses and failed simulation retry the same purchase. Concurrent creation replay produces one order. Delivery-pending results do not clear checkout state or report completion. |

Upload validation is deliberately limited to raster signatures/container markers and safe serving; it is not a full image decoder/re-encoder. The executable-document issue is addressed by rejecting active formats, controlling filenames/MIME, validating legacy serving and applying browser security headers. Pixel decoding/visual rendering was not claimed as verified.

The dummy email provider now treats committing a local SQLite outbox entry as delivery. Exactly-once behavior here relies on that local transactional side effect; this is not a claim about any future external email provider.

## Files modified or added

| Files | Purpose |
| --- | --- |
| `backend/src/app.ts` | Ownership, response filtering, payment/delivery transactions, restricted outbox/uploads, consistent auth payload and async error handling. |
| `backend/src/config.ts` **(new)** | Module-relative paths, root environment loading and development-only startup validation. |
| `backend/src/index.ts` | Loopback binding; configuration is loaded by the app. |
| `backend/src/seed.ts` | Non-destructive, development-only, directly testable seeding. |
| `backend/package.json`, `backend/tsconfig.json` | Safe test/typecheck scripts, app runtime environment handling, source-only compilation scope. |
| `backend/test/marketplace.test.mjs` **(new)** | 22 isolated API/persistence/security/failure-recovery regressions. |
| `backend/test/schema.sql` **(new)** | Temporary test schema matching the unchanged Prisma schema; never applied to development data. |
| `backend/test/source-loader.mjs` **(new)** | In-process source transpilation with the already-installed TypeScript package, avoiding esbuild subprocesses in tests. |
| `frontend/src/App.tsx` | Shared cart/auth subscriptions and use of recoverable checkout; existing page layout/UI preserved. |
| `frontend/src/stores.ts` **(new)** | Shared observable cart/auth state and validated cart persistence. |
| `frontend/src/checkout.ts` **(new)** | Same-order checkout retry and completion-state validation. |
| `frontend/test/workflow.test.mjs` **(new)** | Eight store, rendered-component and checkout-recovery regressions. |
| `frontend/package.json`, `frontend/vite.config.ts` | Test/typecheck scripts and consistent loopback development networking. |
| `package.json` | Consolidated tests/type checking and removal of automatic seeding. |
| `README.md` | Accurate setup, modes, storage, session limits, upload restrictions and verification instructions. |
| `PHASE1_FIX_REPORT.md` **(new)** | This report. |

`prisma/schema.prisma` and development database data were not changed. No dependency versions or lockfile changes were required. The supplied directory has no Git repository, so a Git working-tree diff was unavailable; existing generated `dist` directories were preserved by targeting temporary build outputs.

## Tests and consolidated verification

Environment: Windows PowerShell, Node v24.11.0, npm 11.13.0. The installed Prisma query runtime works. Tests use separate temporary SQLite databases and upload directories, verified before recursive cleanup. They never run `db:push`, generation, seed or mutation against `database/dev.db`.

Focused tests were run during implementation. The first Node test run encountered subprocess `spawn EPERM`; test scripts now use `--test-isolation=none` and the in-process source loader. SQLite data isolation remains explicit per backend run. Two initial fault-test assertions expected 500, but Prisma classified the injected SQLite abort as a constraint error (mapped to 400); the assertions were corrected and rollback/recovery was then verified. Frontend component checks use StaticRouter/server rendering, not browser automation.

One final consolidated verification ran after the application/test changes:

| Command/check | Result |
| --- | --- |
| `npm run typecheck` | **PASS** — backend and frontend TypeScript checks both exit 0. |
| `npm test` | **PASS** — 22 backend + 8 frontend tests; 30 passed, 0 failed, 0 skipped. Node emits its built-in SQLite experimental warning. |
| `npm run build --workspace backend -- --outDir <temporary>/backend-dist` | **BLOCKED**, exit 1 before compilation. Prisma generation requests `https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/windows/schema-engine.exe.gz.sha256`; restricted networking returns `connect ECONNREFUSED 127.0.0.1:9`. |
| `npm run build --workspace frontend -- --outDir <temporary>/frontend-dist` | **BLOCKED**, exit 1 loading `vite.config.ts`. Vite's installed esbuild service cannot start: `Error: spawn EPERM` at `ensureServiceIsRunning`. |
| Browser/mobile interaction and full `npm run dev` launch | **NOT VERIFIED** — no browser automation dependencies were added, and native subprocess restrictions prevent normal toolchain execution here. |

Build outputs targeted `%TEMP%/marketplace-phase1-build-24b486a9742e40929033f64ab8689c9a/`. Neither blocked build is reported as successful or as a proven application compilation defect. The successful type checks do not substitute for successful production artifact generation. Builds were not repeatedly retried after the known blockers.

## Remaining findings and data considerations

- **F03 — MEDIUM, unresolved:** category/contact/image administration forms, guest order-history/detail screens and a dedicated email-body viewer screen are still absent. Phase 1 repairs the existing APIs and purchase/delivery behavior; it adds no new screens. ADMIN can inspect delivery bodies using the restricted outbox API, while the existing dashboard still shows metadata.
- **F04 — LOW, unresolved:** SuccessPage still reads `window.location.state` instead of React Router state and shows unconditional success text on a direct visit. The corrected checkout helper itself requires PAID/SENT before navigating, but direct success-page visits remain misleading and order details remain missing.
- No HIGH findings remain open in the implemented source under the regression scenarios above. New build artifacts, full browser behavior and dependency vulnerability status are not certified by these tests.
- Existing shared-guest orders are preserved and available to ADMIN; they are not assigned to a new anonymous visitor. Session ownership uses the existing in-memory development session store, so a backend restart/cookie reset loses guest access to old orders. This is documented rather than introducing real authentication or a session-store migration.
- Historical JSON outbox files remain untouched and are no longer application inputs/outputs. Existing delivery rows remain the outbox, preventing replay of already-SENT records. Ambiguous historical records with missing payment/delivery rows are not guessed/recreated as paid; inspect them manually before any corrective data work.
- Existing upload files remain on disk; active/invalid ones are rejected when served. If an earlier launch wrote files into the erroneous nested `backend/backend/...` location, inspect those files manually before any deliberate relocation. No automatic file moves/deletions were performed.

## Manual verification required

1. In an environment permitting Prisma/esbuild execution, run the two workspace builds and start the development application with the root `.env`, `NODE_ENV=development` and `ALLOW_MOCK_PAYMENT=true`.
2. In a browser, add different categories, confirm a shared badge and deduplicated cart, switch ADMIN/GUEST both ways, and complete checkout. Inspect the paid delivery through the ADMIN outbox API and confirm only purchased contacts appear. Use a separate browser profile to confirm order/outbox denial.
3. Check retry after a transient checkout/delivery failure without creating a second order, and inspect uploaded raster rendering/mobile layouts. Server-rendered tests do not exercise clicks, effects, network proxies or visual responsiveness.
4. Verify a fresh production/staging process refuses startup. Keep real data and production usage out of scope while only dummy providers exist.

**Readiness:** the Phase 1 purchase/privacy/delivery source paths are validated for isolated local testing with fictional data. **The complete MVP is not yet ready for full local acceptance sign-off:** successful builds/browser checks remain outstanding, and F03/F04 remain unresolved.
