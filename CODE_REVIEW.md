# Digital Supplier Contacts Marketplace — Code Review

Review date: 2026-10-16. Scope: existing source, configuration, SQLite schema, documentation, installed verification tools and isolated API checks. Application source was not changed. No dependencies were installed; no commits, deployments or remote infrastructure changes were made.

## 1. Executive summary

**The MVP is not ready for local acceptance testing as a complete marketplace.** It can support isolated developer debugging, but privacy, payment gating, delivery idempotency and several required user flows need correction first. It is not suitable for real supplier/customer data or production.

**Findings: 0 CRITICAL, 5 HIGH, 8 MEDIUM, 1 LOW — 14 total.** Security findings S01–S07 account for 5 HIGH and 2 MEDIUM; functional findings F01–F07 account for 6 MEDIUM and 1 LOW. Repeated references below do not count as additional findings.

Verified positives include React/TypeScript and Node/Express, persistent local SQLite, server-calculated prices, public category contact redaction, server-side admin role guards, and a successful isolated API purchase with an email containing only the purchased category's contacts. However, unauthenticated callers can enumerate the outbox and read other customers' contacts; order lookup and payment simulation have no ownership enforcement. An admin retry sends contacts for unpaid orders. Upload validation permits executable HTML. Production accepts checkout with dummy providers rather than failing closed.

Both frontend and backend TypeScript checks passed. Build attempts were blocked by this environment's process/network restrictions. The configured test runner discovered **zero tests**. Browser interaction and mobile rendering were not verified.

### Review method and boundaries

- Inspected all application source files, README, workspace scripts, TypeScript/Vite/Tailwind configuration, environment example, Prisma schema and existing SQLite table definitions. No repository `AGENTS.md` or test files were found in the supplied tree; the instructions supplied in chat were followed.
- `git status --short` reported that the workspace is not a Git repository. Existing work could not be assessed through a Git diff.
- Read the existing database schema with Node's SQLite API in read-only mode. API mutations used fictional fixtures in a separate temporary SQLite file, with temporary working directories for uploads and email files. Existing customer/order data was not used for tests.
- Used the installed Prisma client, native Node TypeScript support and Supertest. No running user application was targeted. Fault-injection checks changed only the temporary test process and temporary outbox, never application files.
- “Confirmed” means demonstrated by runtime checks or directly established by the cited source. Browser execution, concurrency outcomes and failure modes that were not reproduced are explicitly qualified. There was no third-party dependency advisory audit or browser automation dependency installation.

## 2. Requirements compliance checklist

| Requirement | Result | Evidence and limits |
| --- | --- | --- |
| React + TypeScript frontend and Node.js backend | PASS | `frontend/package.json:11`, `frontend/src/main.tsx:1`, `backend/package.json:15`, `backend/src/index.ts:1`; both TypeScript checks passed. |
| Local SQLite with persistent data | PASS | `prisma/schema.prisma:5`; existing file has all seven application tables. An independent Prisma client read the isolated persisted orders/categories. Demo edits are overwritten by reseeding: F06. |
| No external services required at runtime | PASS | Payment and email operate locally in `backend/src/app.ts:141` and `:178`. This does not mean offline installation/build is verified: Prisma generation attempted an external engine download. |
| Responsive category catalog, cart, checkout and admin dashboard | PARTIAL | Pages and responsive grid classes exist in `frontend/src/App.tsx:185`, `:332`, `:396`, `:512`. Cart state is broken (F01); admin functions are incomplete (F03). Mobile/browser rendering NOT VERIFIED. |
| Two passwordless mock identities, ADMIN and GUEST | PARTIAL | Session switching works through `backend/src/app.ts:279`; frontend state loses switching controls and stays stale (F02). All checkouts attach to one shared guest DB user (`:363`). |
| Admin can create/edit categories and manage supplier contacts | PARTIAL | Backend category/contact CRUD routes exist (`backend/src/app.ts:520`, `:540`, `:608`, `:634`, `:655`). API category create/edit and contact create passed. Required frontend management screens are absent (F03); contact edit/delete were inspected, not exercised. |
| Guest can browse, purchase categories and view orders | PARTIAL | Browse/checkout APIs passed. No guest order-history/detail screen or scoped list endpoint exists (F03). Direct order API exposes other customers' orders (S01). |
| Contacts remain private until payment confirmation | FAIL | Unpaid delivery retry bypass (S03); globally accessible paid contacts through order/outbox APIs (S01, S02). Public category list/detail themselves passed contact-redaction checks. |
| Checkout uses a dummy payment provider | PASS | Isolated checkout produced a DUMMY/PENDING payment and simulated confirmation produced PAID (`backend/src/app.ts:385`, `:425`). Production restrictions fail separately (S05). |
| Dummy email provider and local outbox | PARTIAL | A local JSON outbox and database delivery record were created (`backend/src/app.ts:178`, `:239`). No dedicated email-body viewer route exists; reliability/privacy defects remain (S02, S06, S07, F03). |
| Emails contain only contacts from purchased categories | PASS | Category IDs are derived from stored order items (`backend/src/app.ts:193`). A purchase of fixture A included A's contact and excluded fixture B's. Payment gating and recipient ownership are separate failures. |
| Payment confirmation and email delivery are idempotent | FAIL | Sequential guest repeats skipped delivery, but repeated admin confirmations increased attempts from 1 to 3; two concurrent guest confirmations produced two delivery attempts (S06). |
| Mock auth, payments and email viewer are development-only | FAIL | Main mock login/simulation/outbox GET return 403 in production, but retry lacks an environment guard, mock identity still resolves in production, and `staging` enables mock admin login (S05). |
| Production fails closed without real providers | FAIL | With `NODE_ENV=production`, app initialization and unauthenticated checkout succeeded; the created payment provider was DUMMY (S05). |

## 3. Security findings

### S01 — HIGH — Order and payment endpoints lack customer ownership checks

- **Locations:** `backend/src/app.ts:363`, `:412`, `:425`, `:430`, `:460`; `prisma/schema.prisma:48`.
- **Status:** Confirmed by isolated API requests and source inspection.
- **Description:** `GET /api/orders/:id` returns the complete order, customer email, payment and `emailDelivery.body` without authenticating or checking ownership. An unrelated session can also simulate payment for the order and receive the delivered contacts in the response. Every checkout connects to the same `guest@local.test` user, so comparing that shared user ID alone would not isolate customers.
- **Evidence:** A second cookie jar read another session's pending order (200), simulated its payment (200), and read its paid contact body (200). Paid-order disclosure also returned 200 under production. This attack requires an order ID; S02 supplies enumerable order IDs in development.
- **Impact:** Cross-customer order/contact disclosure and unauthorized order state changes. Owning a different order, or making no purchase, does not limit access.
- **Recommended fix:** Bind each guest order to a distinct server-managed customer/session identity or a scoped, unguessable access token. Enforce that ownership on every order read, confirmation and delivery response, with a separate authorized admin path. Return explicit response fields rather than entire delivery records.

### S02 — HIGH — Development outbox exposes all customers' deliveries without authentication

- **Locations:** `backend/src/app.ts:668`, `:673`, `:678`, `:683`.
- **Status:** Confirmed by isolated API requests.
- **Description:** An absent session defaults to GUEST and is allowed to list every `EmailDelivery`, including the complete contact body, recipient and related order. There is no customer filter or admin restriction.
- **Evidence:** An anonymous cookie jar received 200 and the contact purchased by a different session. This is an enumerable list and requires no known order ID.
- **Impact:** Any caller reaching the development server can collect previously delivered contacts and customer/order information without purchasing. It also defeats category scoping for the caller, even though each individual generated email is correctly category-scoped.
- **Recommended fix:** Restrict the aggregate development outbox to ADMIN and enforce the development boundary. If guest delivery previews are necessary, expose only that guest's paid orders after S01 is fixed.

### S03 — HIGH — Email retry delivers contacts for unpaid orders

- **Locations:** `backend/src/app.ts:193`, `:199`, `:686`, `:692`, `:696`, `:701`.
- **Status:** Confirmed by isolated API requests.
- **Description:** The admin retry route only checks whether delivery is already SENT. Neither the route nor `sendOrderDeliveryEmail` verifies PAID payment/order state before loading and sending supplier contacts.
- **Evidence:** Created a PENDING order with a PENDING payment and NOT_SENT delivery. Retrying returned 200, changed delivery to SENT and included its supplier contact while both payment and order remained PENDING.
- **Impact:** A routine admin retry bypasses the central pay-before-delivery rule. Reusing the email provider from another route would inherit the same missing invariant. Admin role authorization does not establish payment confirmation.
- **Recommended fix:** Require a verified paid payment and valid paid order state inside the delivery service, with a guarded, transactional delivery claim. Reject unpaid retries without loading or returning contacts.

### S04 — HIGH — Image upload accepts executable HTML and active SVG

- **Locations:** `backend/src/app.ts:26`, `:34`, `:38`, `:53`, `:574`, `:585`.
- **Status:** HTML upload and serving confirmed; actual JavaScript execution in a browser was not tested. Unsanitized SVG is a source-confirmed additional risk.
- **Description:** The upload filter trusts the client-supplied MIME type, preserves the filename extension, and accepts SVG without sanitization. Uploaded files are served as public files on the application origin.
- **Evidence:** An authenticated admin uploaded a `.html` file containing a script with multipart MIME `image/png`. Upload and anonymous retrieval both returned 200. Retrieval used `text/html; charset=UTF-8`, without CSP or attachment disposition. In development, any caller can select the mock admin identity by design.
- **Impact:** Visiting a crafted upload URL can execute attacker-supplied JavaScript on the application origin and issue requests using the visitor's session. Merely placing an SVG/HTML URL in an `<img>` does not itself prove script execution; direct document navigation is the demonstrated serving context.
- **Recommended fix:** Validate actual bytes and decode/re-encode supported raster formats; derive server-controlled extensions. Reject HTML and reject or rigorously sanitize SVG. Serve user uploads from a separate origin or enforce safe disposition/content security controls. Validate the target category before persisting files.

### S05 — HIGH — Production does not fail closed; development boundary is incomplete

- **Locations:** `backend/src/app.ts:58`, `:81`, `:89`, `:264`, `:324`, `:385`, `:468`, `:686`; `backend/src/index.ts:1`, `:6`; `backend/package.json:7`, `:9`; `.env.example:4`, `:5`.
- **Status:** Production initialization/checkout and staging mock login confirmed. Missing guards/configuration checks confirmed by source. Deployment-specific exposure is conditional.
- **Description:** Dummy providers are always instantiated, mock guest identity is always available, and no startup validation requires real auth/payment/email providers in production. The admin confirmation and outbox retry routes lack production guards. The mock gate allows every environment except the exact string `production`, including `staging`; `ALLOW_MOCK_PAYMENT` is never read. The session configuration retains a fallback secret and non-secure cookie without production validation.
- **Evidence:** In a fresh production app, `/api/auth/me` returned Mock Guest and order creation returned 201 with provider DUMMY. Main mock login, simulation and outbox GET correctly returned 403. In staging, mock admin login returned 200. A retained admin session continued to call retry after the harness changed NODE_ENV to production; this proves the missing route guard, **not** that a fresh unauthenticated production caller can become ADMIN.
- **Configuration concern:** npm workspace commands run from `backend`, while the documented `.env` is in the root. `dotenv/config` has no explicit root path. Thus the documented root file is not loaded by the normal backend workspace command unless variables are inherited or another loader is used. `npm start` also does not set NODE_ENV. A production value written only into root `.env` cannot be relied upon to enable production guards. `app.listen` does not explicitly bind loopback (`backend/src/index.ts:7`), and Vite binds `0.0.0.0` (`frontend/vite.config.ts:8`), increasing exposure when mock mode is enabled.
- **Impact:** Deployment can run with mock identities/providers or enabled mock administration instead of refusing unsafe configuration. Checkout can accept orders that have no real payment path.
- **Recommended fix:** Validate configuration at startup and refuse non-development execution until real providers and secure authentication/session configuration exist. Use an explicit development allowlist and intentional mock flags on all mock routes/services. Resolve environment files consistently, document runtime variables, and default local mock servers to loopback.

### S06 — MEDIUM — Email delivery is not idempotent; JSON outbox updates race

- **Locations:** `backend/src/app.ts:127`, `:136`, `:157`, `:178`, `:233`, `:239`, `:444`, `:468`, `:478`.
- **Status:** Sequential admin duplication and concurrent guest duplication confirmed. Lost/corrupted JSON updates and crash-window duplication are potential risks established by the implementation, not reproduced guarantees.
- **Description:** Admin confirmation always sends email even when the provider returns an already-paid payment. Concurrent guest requests can both pass the pre-check and send. The unique delivery row does not prevent sending because the external effect happens before its upsert. JSON outbox persistence is an unlocked read/append/write, and read/parse failures silently become an empty outbox.
- **Evidence:** Guest sequential replay kept delivery attempts at 1. Two admin confirmations raised attempts from 1 to 3. Two simultaneous guest confirmations both returned 200 and produced delivery attempts=2.
- **Impact:** Duplicate deliveries and incorrect attempt history; concurrent writes or read failures can lose outbox entries. The database-backed viewer may disagree with the actual JSON send log.
- **Recommended fix:** Persist a uniquely keyed delivery job transactionally with payment confirmation, atomically claim it, and use an order-specific provider idempotency key. Use database-backed outbox entries rather than replacing a shared JSON array. Recovery must reconcile a send that succeeded before persistence failed.

### S07 — MEDIUM — Non-atomic payment/order transitions and unrecoverable guest delivery failure

- **Locations:** `backend/src/app.ts:157`, `:160`, `:163`, `:170`, `:357`, `:385`, `:393`, `:444`, `:448`, `:449`.
- **Status:** Confirmed with isolated injected write and filesystem failures. Real operational failure frequency is not measured.
- **Description:** Order/payment/delivery creation uses separate writes. Confirmation updates payment before updating the order, also in separate writes. A paid payment causes later guest confirmations to return immediately regardless of order or delivery state. Delivery failures do not record an attempt, FAILED state or `lastError`.
- **Evidence:** An injected order-update failure left payment PAID, order PENDING and email NOT_SENT; guest replay returned 200 without repairing them. An unwritable temporary JSON outbox left payment/order paid and delivery NOT_SENT, attempts=0 and `lastError=null`; guest replay again returned 200 without delivery. The initial requests timed out due to F07.
- **Impact:** Persistently inconsistent orders, customers charged/marked paid without contacts, and no guest recovery path. Failure during initial multi-step creation can also leave partially initialized records; that creation failure was not injected.
- **Recommended fix:** Create order, payment and delivery intent in one database transaction. Atomically transition payment/order state, then process the durable delivery job separately. Record failures and expose a safe idempotent retry for paid, undelivered orders instead of returning solely on payment status.

### Other security checks and limits

- Admin category/dashboard/contact/order routes inspected all use `requireRole('ADMIN')`; representative unauthenticated requests returned 403. This does not remove intentionally unrestricted mock admin selection in development or S05's environment concerns.
- Client-supplied total, item price and quantity were ignored. Duplicate category IDs produced one item charged at the stored 1,600 cents. Invalid email and unknown/unavailable category requests returned 400.
- Prisma model queries use structured parameters; no raw/interpolated SQL was found. A SQL-shaped category slug returned 404 without broadening results. This is targeted evidence, not proof against every injection technique.
- React renders category text as text expressions; no `dangerouslySetInnerHTML` or supplier contact literals were found in frontend source/HTML. No explicit application log statements logging contacts were found. Browser memory, deployed bundles and third-party/internal error logging were not comprehensively inspected. Uploads remain the confirmed content-serving risk S04.
- Client totals can disagree with checkout due to stale/duplicate cart state, but backend undercharging through manipulated totals was not reproduced.

## 4. Functional bugs

### F01 — MEDIUM — Cart hook instances overwrite each other and allow duplicate charging previews

- **Locations:** `frontend/src/App.tsx:125`, `:150`, `:250`, `:253`, `:332`, `:353`, `:396`, `:620`.
- **Status:** Confirmed by source; browser interaction not executed.
- **Description:** Every `useCart()` invocation owns independent state. Buttons, header and pages synchronize only by reading localStorage at mount; they do not subscribe to subsequent changes. Each category button can overwrite another button's additions with its own stale cart. Duplicate IDs are allowed and counted in displayed totals, while backend checkout deduplicates them.
- **Impact:** Lost cart items, stale badge, misleading totals and duplicate React keys. Adding A then B from independent catalog buttons can leave only B persisted; repeated adds can show a total above the charged amount.
- **Recommended fix:** Use a shared cart provider/store, enforce one entry per category and reconcile persisted data/prices with the API. Validate localStorage data before using array operations.

### F02 — MEDIUM — Switching identities hides the switcher and leaves other components stale

- **Locations:** `frontend/src/App.tsx:99`, `:150`, `:513`, `:624`, `:630`, `:645`; `backend/src/app.ts:81`, `:289`.
- **Status:** Confirmed by source and the API response shape; browser behavior not executed.
- **Description:** The switch response replaces App's auth state with `currentUser`, which omits `mockAccountSwitchingEnabled` and `mode`. Its own visibility condition then hides the switching buttons. Header and admin page use independent one-time auth fetches and are not updated by App's setter.
- **Impact:** Switching back requires reload; displayed identity and admin access UI can disagree with the server session. An already-mounted guest admin screen does not update when the user selects ADMIN.
- **Recommended fix:** Share authentication state through a provider and return/refetch a consistent auth payload including mock-mode capability metadata after switching.

### F03 — MEDIUM — Required administration, guest order and email-viewer screens are absent

- **Locations:** `frontend/src/App.tsx:512`, `:564`, `:586`, `:658`; `backend/src/app.ts:412`, `:660`; `README.md:28`.
- **Status:** Confirmed by complete frontend source and route inspection.
- **Description:** Admin displays summary cards, only the five most recent orders and five delivery metadata records. It provides no category create/edit/deactivate, contact CRUD or image-upload UI. Guests have no order history/detail screen, and the backend has no ownership-scoped guest order list. `/dev/email-outbox`, advertised in README, has no frontend route and redirects to the catalog. Admin outbox cards do not display email bodies.
- **Impact:** The required admin-to-guest workflow cannot be completed entirely through the application UI; guests cannot revisit pending/paid orders or recover a checkout. Email contents require direct API/file inspection.
- **Recommended fix:** Implement the required screens against properly authorized APIs after S01–S05 are fixed; add scoped order listing and a development-only authorized delivery-body viewer.

### F04 — LOW — Success page cannot retrieve router state and asserts success on direct visits

- **Locations:** `frontend/src/App.tsx:431`, `:487`, `:488`, `:495`.
- **Status:** Confirmed by source; browser execution not performed.
- **Description:** Checkout passes React Router navigation state, but SuccessPage reads `window.location.state`, which is not the router location state. The page renders payment-confirmed/email-sent text even when no order is available.
- **Impact:** Order details are normally missing and direct `/success` navigation claims an unverified successful payment.
- **Recommended fix:** Use router location state for navigation data, with an owned order ID and server lookup for authoritative status. Handle missing/pending/failed orders explicitly.

### F05 — MEDIUM — Backend filesystem paths break under documented workspace startup

- **Locations:** `backend/src/app.ts:18`, `:19`, `:54`; `backend/package.json:7`, `:9`; `package.json:9`.
- **Status:** Image failure confirmed with app construction from the backend workspace directory; upload/outbox path derivation confirmed by source. The full dev script was not started.
- **Description:** Paths append `backend/...` to `process.cwd()`. npm backend workspace commands use the backend directory, producing `backend/backend/public`, `backend/backend/public/uploads` and `backend/backend/data` relative to the project root. Shipped images are actually in `backend/public/images`.
- **Evidence:** `GET /images/default-category.svg` returned 404 when the application was constructed from the backend directory, although the shipped asset exists. File uploads/outbox would use the nested directories.
- **Impact:** Broken catalog images and launch-directory-dependent storage; switching launch methods can make uploaded assets and the JSON outbox appear missing. Environment-file resolution is covered in S05.
- **Recommended fix:** Resolve filesystem locations relative to the module or a validated absolute application data directory, consistently across scripts.

### F06 — MEDIUM — Starting development overwrites admin changes to demo categories

- **Locations:** `package.json:9`; `backend/src/seed.ts:102`, `:105`, `:122`, `:125`.
- **Status:** Confirmed by source; seed was deliberately not run against the existing database.
- **Description:** Every `npm run dev` reruns seed. Existing demo category name, description, price, image and active state are overwritten. Deleted demo contacts are recreated if their email is no longer present; edits to their email can cause the original contact to be added again.
- **Impact:** Admin changes appear not to persist across startup, deactivated demo categories become active again, and removed supplier contacts return.
- **Recommended fix:** Make seeding an explicit operation; initialize missing demo data without overwriting existing records. Provide any reset operation separately and clearly document its effects.

### F07 — MEDIUM — Expected database/filesystem errors can hang requests or terminate the backend

- **Locations:** `backend/package.json:19`; `backend/src/app.ts:299`, `:324`, `:425`, `:520`, `:526`, `:540`, `:575`, `:640`, `:709`.
- **Status:** Confirmed under installed Node v24.11.0/Express 4.
- **Description:** Async route handlers and the async upload callback lack error forwarding; there is no final application error handler. Database unique/not-found errors and filesystem failures escape the Express 4 request lifecycle.
- **Evidence:** Creating a duplicate category slug in a separate test process raised Prisma P2002 and terminated Node with exit code 1. Fault tests with a temporary harness rejection listener timed out instead of receiving a controlled error response. The listener was test-only and is not present in the app.
- **Impact:** Routine validation conflicts can take the API offline. Users cannot distinguish a failed request from an order that was partly saved, increasing accidental repeat purchases. Checkout always creates another order on resubmission and does not retain a pending order ID after simulation failure (`frontend/src/App.tsx:415`).
- **Recommended fix:** Forward async errors through an Express-compatible wrapper and central error middleware; map expected failures to 400/404/409 as appropriate and sanitize unexpected errors. Apply the transactional/recovery changes in S07 and retain/reuse checkout order identity on retry.

Additional confirmed edge behavior: deactivated category detail remained publicly retrievable with `active=false` (200), while checkout correctly rejected it (400), because `backend/src/app.ts:308` does not filter active state. Decide whether inactive detail should be public and align it with the catalog; this observation is not an additional severity-counted finding.

## 5. Missing features

These refer to findings above, not additional findings:

- Admin category/contact/image management UI; guest owned-order history/detail; authorized development email-body viewer (F03).
- Real-provider interfaces/configuration validation sufficient to reject unsafe production startup (S05). Existing provider classes are local to `createApp`, and order creation writes DUMMY payments directly, so README's constructor-only replacement guidance (`README.md:53`) is incomplete.
- Durable idempotent delivery queue, failure recording and safe recovery for paid-but-undelivered orders (S06, S07).
- Shared auth/cart state and complete pending-order recovery in the frontend (F01, F02, F07). Normal checkout automatically invokes simulation immediately after creation; there is no separate pending-payment screen.
- Automated test files, lint configuration/script and a script that includes frontend type checking. README claims a security/delivery suite exists (`README.md:55`), but none was found. No dependencies or tests were added during this review.

## 6. Test and build results

Environment: Windows PowerShell; Node v24.11.0; npm 11.13.0; installed local workspace dependencies. Build output arguments targeted a temporary directory to preserve existing `dist` artifacts.

| Check | Result | Exact scope / output |
| --- | --- | --- |
| Backend TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json`, exit 0. |
| Frontend TypeScript | PASS | `node node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.json`, exit 0. |
| Lint | NOT VERIFIED | No lint scripts/configuration or installed ESLint executable found. Nothing installed. |
| Existing automated tests | NOT VERIFIED | From `backend`: `node --test --import tsx 'test/**/*.test.ts'` exited 0 but reported **tests 0, suites 0**. This is not a passed test suite. |
| Root `npm test` wrapper | NOT VERIFIED | Deliberately not run: `backend/package.json:13` pushes schema to the hardcoded existing `database/dev.db` before discovery. No test files exist, and existing data/schema was preserved. The runner portion was executed separately above. |
| Backend build script | FAIL — environment blocker | `npm run build --workspace backend -- --outDir <temporary>/backend-dist` failed before compilation: Prisma generation tried to fetch `binaries.prisma.sh` engine checksum; connection refused through restricted networking. No download/install succeeded. |
| Frontend build script | FAIL — environment blocker | `npm run build --workspace frontend -- --outDir <temporary>/frontend-dist` failed loading Vite config: esbuild subprocess `spawn EPERM`. This does not establish a frontend source/build defect. |
| Full root build | NOT VERIFIED | Root script delegates to the two workspace builds above; not repeated after their blockers. |
| Prisma schema push against isolated SQLite | FAIL — environment blocker | Installed Prisma CLI returned `spawn EPERM` for `schema-engine-windows.exe`. Existing database was not pushed or migrated. |
| Isolated API validation | MIXED — confirmed defects above | The installed Prisma query runtime worked. Created an empty temporary DB from the existing read-only SQLite DDL, then used Supertest and fictional fixtures against the source app. Positives and regressions are enumerated below. |
| Browser UI/responsive checks | NOT VERIFIED | No installed Playwright/Puppeteer/browser automation tooling found. Layout/state findings are source-confirmed, without screenshots or browser interaction claims. |

### Isolated API evidence

Successful checks:

- Admin category creation/edit and contact creation returned expected success responses; five representative anonymous admin operations returned 403.
- Public category list/detail excluded supplier contacts.
- Injected client totals/prices/quantity were ignored; duplicate category IDs yielded one item with the database price.
- Workflow: category/contact creation → guest order PENDING/payment PENDING/delivery NOT_SENT → simulated confirmation → order/payment PAID → delivery SENT and local JSON entry. Category A's delivery excluded B's contact.
- Invalid delivery email and unknown/inactive checkout category returned 400; SQL-shaped slug returned 404.
- Sequential guest confirmation did not resend; main production mock login/simulation/outbox GET returned 403.
- An independent Prisma client observed persisted temporary orders and categories.

Confirmed negative checks:

- Other session read and confirmed another customer's order; anonymous outbox returned its contact body (S01, S02).
- Retry sent an unpaid order's contacts (S03).
- Spoofed image MIME accepted HTML and served it as an HTML document (S04).
- Production initialized and created a DUMMY payment; staging enabled mock admin (S05).
- Repeated admin and concurrent guest confirmations duplicated delivery attempts (S06).
- Injected outbox/order-update failures left unrepaired state; requests hung with a harness rejection listener (S07, F07).
- Duplicate slug crashed a separate backend process without that listener, exit 1 (F07).
- Backend-directory startup returned 404 for an existing shipped category image (F05).

The first temporary harness stopped after its delivery-failure check because Supertest's ephemeral server encountered a harness lifecycle error. Remaining checks were completed using explicitly managed loopback servers. This harness failure is not classified as an application defect. The separate duplicate-slug crash was an intentional application failure reproduction.

## 7. Recommended fixes in priority order

1. **Stop contact disclosure and unpaid delivery:** enforce customer/session ownership and response allowlists (S01), restrict the outbox (S02), and enforce paid state inside the delivery service (S03).
2. **Contain executable uploads and unsafe runtime modes:** validate/re-encode files and isolate uploads (S04); add strict startup/provider/auth validation and consistent environment loading (S05).
3. **Make payment/delivery reliable:** transactional order/payment changes, uniquely keyed durable delivery work, atomic claims, idempotent sends and recoverable failure records (S06, S07).
4. **Prevent API crashes:** introduce async error forwarding and controlled conflict/not-found/error responses; preserve checkout identity on retry (F07).
5. **Restore usable frontend flows:** share cart/auth state, add required admin and guest screens, provide an authorized outbox viewer and correct the success page (F01–F04).
6. **Make local startup predictable:** fix module-relative data/assets/environment paths and make seeding non-destructive (F05, F06).
7. **Add meaningful verification after fixes:** isolated test database, ownership/privacy/payment-gating/idempotency/failure-recovery tests, frontend interaction checks, lint and both type checks in project scripts. Re-run builds where Prisma/esbuild can execute, then perform mobile/browser acceptance testing with fictional data.

**Readiness decision:** not ready for local acceptance testing of the requested MVP; appropriate only for isolated debugging with fictional data until the HIGH findings and blocking workflow defects are corrected and verification can complete.
