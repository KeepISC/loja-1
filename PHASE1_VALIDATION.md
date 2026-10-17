# Phase 1 Validation

Date: 2026-10-16. Compared `CODE_REVIEW.md` and `PHASE1_FIX_REPORT.md` with the current implementation, reran verification, and independently exercised the purchase flow. Application code, existing build artifacts and both earlier reports were left unchanged. No dependencies, migrations or development-database mutations were performed.

## Decision

**Not ready for complete manual acceptance testing as delivered.** The Phase 1 **source** fixes pass the targeted checks, including all five original HIGH findings. However, the existing compiled backend selected by `npm start` is stale and still reproduces HIGH-severity behavior. Builds remain environmentally blocked, and the known missing screens/success-page defect remain.

The source API/core checkout flow is suitable for targeted testing with fictional data when launched from current source or a freshly verified build. This is not approval to test the existing `npm start` artifact as the fixed MVP.

## Original findings versus current source

Statuses in this table apply to current source, not the stale compiled artifact described in V01 below.

| Verification | Result | Root-cause validation and evidence |
| --- | --- | --- |
| **S01 — customer ownership/contact privacy** | **PASS** | `backend/src/app.ts:142`, `:357`, `:394`, `:418`, `:436`: ownership uses a server-assigned per-session customer ID, not the former shared guest. Both read and simulation enforce ownership/ADMIN. Explicit response fields at `:56` omit contact bodies. Regression tests and an independent workflow returned 404 for another session's order/confirmation; ordinary pending/paid responses contained no supplier contacts. |
| **S02 — aggregate outbox authorization** | **PASS** | `backend/src/app.ts:625` requires ADMIN; `:633` releases bodies only for SENT deliveries with both order/payment PAID. Guest/anonymous outbox calls returned 403. Regression tests also verified redaction of a legacy unpaid SENT delivery. |
| **S03 — delivery before payment** | **PASS** | The provider checks both persisted payment and order state before loading contacts (`backend/src/app.ts:209`, `:220`, `:227`), including already-SENT records. ADMIN retry of an unpaid order returned 409 with no attempt/body created. This enforcement is in the provider, not only the route. |
| **S04 — executable uploads** | **PASS** | `backend/src/app.ts:20`, `:43`, `:83`, `:531`: raster signature/MIME validation, generated filenames, size limit, SVG rejection and controlled serving address the original HTML/SVG exploit. Regressions rejected spoofed HTML/SVG, mismatched MIME, oversize/unauthorized uploads and legacy active content. Valid PNG serving used image MIME, `nosniff` and sandbox CSP. Validation remains signature/container-based, not full image decoding; browser rendering was not exercised. |
| **S05 — development-only/fail-closed configuration** | **PASS — source** | `backend/src/config.ts:10`, `:13`; `backend/src/app.ts:71`, `:75`, `:135`: explicit root environment loading, exact development startup gate, request-time guard and explicit payment flag. Tests reject production/staging/test/empty modes and disabled payment flags. Independent source initialization under production threw; an existing source app returned 503. **The current start artifact fails this requirement: V01.** |
| **S06 — delivery/payment idempotency** | **PASS** | `backend/src/app.ts:183`, `:206`: first-write transaction checks, conditional payment transition and a transactional SQLite outbox replace send-before-save/JSON races. Repeated and concurrent guest/admin confirmations produced one delivery row, attempts=1 and an unchanged confirmation timestamp. |
| **S07 — atomic state transitions/recovery** | **PASS** | Nested checkout writes at `backend/src/app.ts:388`, transactional confirmation at `:183`, failure recording at `:261` and replay through `:426` address partial creation, split payment/order state and undelivered-paid replay. Fault-trigger regressions passed rollback, retry and legacy-state reconciliation. |
| **F01, F02, F05, F06, F07 — reported workflow fixes** | **PASS — targeted checks** | Existing regressions passed shared cart/auth subscriptions and component snapshots, cwd-independent assets, non-destructive seeding, controlled async errors and checkout replay/recovery. Frontend interaction evidence is store/helper testing and server rendering, not browser clicks/effects. |
| **F03 — required management/order/viewer screens** | **FAIL** | Still absent; see V02. The fix report correctly leaves this open. |
| **F04 — success page state/status** | **FAIL** | Still incorrect; see V03. The fix report correctly leaves this open. |

Development mock ADMIN selection remains intentionally passwordless. These checks validate role enforcement after selecting an identity; they do not establish real authentication, which is explicitly outside this MVP.

## Complete purchase workflow

An additional temporary harness used the actual `frontend/src/checkout.ts` helper with an API adapter calling the current source Express app over loopback. It used a separate SQLite database initialized from the test fixture and fictional supplier/customer data. It did not target a user-running server or modify project tests.

| Step/check | Result | Observed behavior |
| --- | --- | --- |
| ADMIN creates categories and adds contacts | **PASS — API** | Created two categories and two contacts through ADMIN endpoints, each returning 201. One category was purchased; the other provided a negative contact-scope check. |
| GUEST browses categories | **PASS** | List and detail returned 200 without either private supplier email. |
| GUEST creates checkout | **PASS** | Actual frontend helper called the order API. Server total was 1,700 cents from stored pricing. Existing regression tests additionally passed attempted forged status, role, ownership and total inputs. |
| Before confirmation: PENDING and private | **PASS** | Inspected persisted order/payment=PENDING, delivery=NOT_SENT, body empty. ADMIN unpaid retry returned 409, another session's order/confirmation returned 404, and outbox access returned 403. |
| Dummy confirmation changes order to PAID | **PASS** | Helper's simulation request returned order PAID with delivery SENT. Customer response remained free of supplier contacts. |
| Dummy email contains correct contacts | **PASS** | SQLite outbox recipient matched the submitted delivery email; purchased category A's contact/WhatsApp appeared, unpurchased category B's contact did not. ADMIN outbox inspection returned the correct body. No real email was sent. |
| Repeated/concurrent confirmation produces no duplicates | **PASS** | Four mixed guest/admin confirmation/retry calls returned 200. Exactly one delivery row remained, attempts=1, with the original payment confirmation timestamp. |
| Entire workflow through the UI | **FAIL** | ADMIN category/contact creation and a complete delivery viewer are missing (V02). The API workflow is not a substitute for these acceptance criteria. |
| Browser/mobile interaction and visual verification | **BLOCKED** | No browser automation was available/installed; Vite build execution is blocked below. No browser-rendering or responsive acceptance claim is made. |

## Tests and builds rerun

Environment: Windows PowerShell, Node v24.11.0, npm 11.13.0. Tests run against current source using the installed in-process TypeScript loader. Their temporary database/upload setup was inspected; they do not push schema changes to the development database.

| Command/check | Result | Output |
| --- | --- | --- |
| `npm run typecheck` | **PASS** | Backend and frontend checks exited 0. |
| `npm test` | **PASS** | 22 backend + 8 frontend tests passed; 30 total, 0 failures, 0 skipped. Node emitted its built-in SQLite experimental warning. |
| `npm run build --workspace backend -- --outDir <temporary>/backend-dist` | **BLOCKED** | Exit 1 during Prisma generation, before compilation: request to `https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/windows/schema-engine.exe.gz.sha256` failed with `connect ECONNREFUSED 127.0.0.1:9`. |
| `npm run build --workspace frontend -- --outDir <temporary>/frontend-dist` | **BLOCKED** | Exit 1 loading Vite configuration: esbuild subprocess `spawn EPERM` at `ensureServiceIsRunning`. |
| Current-source production guard | **PASS** | Both regression checks and the independent harness reject production startup; requests through a retained source app return 503 after a production-mode change. |
| Existing compiled backend under production configuration | **FAIL** | The module selected by the start entrypoint initializes, returns Mock Guest (200), creates a DUMMY order (201), and exposes another session's paid contacts (200). See V01. |

Both workspace builds were attempted once in this validation, independently so the backend blocker did not prevent the frontend attempt. Output paths were under `%TEMP%/marketplace-validation-4099a5fa06f04430bad7d4de70dd62f8/` to preserve existing artifacts. No successful build is inferred from type-check/test success.

## Remaining defects and required action

### V01 — HIGH — Start entrypoint selects a stale, unsafe compiled backend

- **Status: FAIL, confirmed at runtime.** This is an artifact/startup-readiness problem, not a failure of the reviewed source ownership/production guards.
- **Locations:** `backend/package.json:9`; `backend/dist/index.js:2`, `:4`; `backend/dist/app.js:37`, `:72`, `:231`, `:279`, `:358`.
- **Evidence:** `npm start` selects `dist/index.js`, whose app module still contains the pre-Phase-1 implementation. Against the isolated validation database with NODE_ENV=production, that exact app module started, returned Mock Guest, created a DUMMY payment, and returned a paid order's contact-bearing delivery body to an unrelated session. The current source module refused startup under the same mode.
- **Impact:** Running the existing compiled entrypoint reintroduces at least S01 and S05. Passing source regressions does not certify what the current start command executes. The raw start command was not launched against its default database; its selected app module was exercised with a temporary database and managed loopback listener.
- **Required action:** Complete a clean normal build into the actual runtime output directories in an environment permitting Prisma/esbuild, then rerun ownership, payment/delivery and production startup checks against those generated artifacts. Do not use the current `backend/dist` as the validated Phase 1 implementation. Artifact replacement was not performed during this read-only verification.

### V02 — MEDIUM — F03 remains: required user-facing screens are missing

- **Status: FAIL, confirmed by source/route inspection.**
- **Locations:** `frontend/src/App.tsx:452`, `:504`, `:526`, `:598`; `backend/src/app.ts:418`.
- **Description/impact:** ADMIN has summary/recent-order/outbox-metadata displays but no category/contact/image management forms. Guests have no owned-order history/detail screen, and there is no dedicated email-body viewer route. Therefore a tester cannot complete the specified admin-to-guest journey entirely through the UI, despite the passing API flow.
- **Required action:** Implement the remaining required screens/scoped order-list support in a separate implementation task, or explicitly limit any interim manual session to API-assisted setup and inspection. The original finding remains open.

### V03 — LOW — F04 remains: success page reads the wrong state and claims unverified success

- **Status: FAIL, confirmed by source; browser execution not performed.**
- **Locations:** `frontend/src/App.tsx:371`, `:427`, `:428`, `:435`.
- **Description/impact:** Checkout supplies router navigation state, while SuccessPage reads `window.location.state`. Details are lost, and direct visits display payment-confirmed/email-sent text without an owned order lookup. The corrected checkout helper validates PAID/SENT before its own navigation, but the page itself remains misleading.
- **Required action:** Read the correct router state and verify an owned order's persisted status, with explicit missing/pending/failure handling.

The documented in-memory session limitation remains: restarting the backend or clearing cookies loses guest access to earlier orders, while ADMIN retains access. The signature-only upload validator and local transactional dummy email semantics are also documented limits, not claims about full raster decoding or external email delivery. No additional broad audit was performed.

## Acceptance gate

**PASS:** current-source privacy, payment gating, transactional/idempotent local delivery and targeted workflow regressions.

**FAIL:** current compiled start artifact, complete UI workflow (F03), and success-page behavior (F04).

**BLOCKED:** successful frontend/backend builds and full browser/mobile verification in this environment.

Manual testing can proceed only as a clearly scoped source/API exercise with fictional data. Complete MVP acceptance requires fresh verified artifacts, the missing UI behavior, and browser execution. The two earlier reports retain their original hashes; the supplemental harness also verified 24 inspected application/test/configuration/report inputs were unchanged.
