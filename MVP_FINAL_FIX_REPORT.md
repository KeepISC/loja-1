# MVP Final Fix Report

Date: 2026-10-17.

## Recommendation

**NOT READY for final MVP v1.0 sign-off.** Guest order continuity is fixed and verified through both regression tests and a real backend process restart. The backend is ready for local browser acceptance testing. Frontend build/start and browser acceptance still require a permitted execution environment; no browser tests were executed.

## 1. Guest order persistence: FIXED / PASS

**Root cause:** Express used its default in-memory session store. Order ownership depended on `req.session.customerId`, which disappeared after restart while SQLite retained the orders. A newly generated session secret could also invalidate role cookies. An order ID or delivery email alone must never reconstruct ownership.

**Targeted fix:**

- Added a separate `market_guest` HttpOnly, SameSite=Lax, seven-day cookie containing 256 random bits and an expiry. The complete credential is hashed with SHA-256 and bound to the guest's existing synthetic `User.email` field in SQLite. No schema migration, dependency or service was added.
- Resolve the credential against SQLite on protected requests; authorization uses the resolved guest ID, never an unverified customer ID, delivery email, URL parameter or cached session value. Restarting with a different role-session secret still preserves guest access.
- No raw credential is returned in response JSON or stored in SQLite. Individual unauthorized order/payment/delivery requests return 404; history without a valid credential returns 401. Malformed, duplicate, expired and unknown credentials are rejected.
- Explicit development-session clearing revokes the credential without deleting orders. A proven live legacy session can upgrade its private synthetic guest user without changing order ownership; the former shared guest is excluded.
- Existing development-only guards and ADMIN/GUEST role switching remain. Role sessions remain in memory; ADMIN must switch again after restart. Cookies use local HTTP settings only inside this development-only app.

Implementation references: `backend/src/guest-access.ts:12`, `:17`, `:29`, `:49`; `backend/src/app.ts:114`, `:148`, `:284`, `:307`, `:364`, `:424`.

**Data preservation:** No project database records were reset, deleted or reassigned during verification. Tests used isolated temporary SQLite files. Lost credentials from the previous implementation cannot safely be recovered from public IDs or email addresses; those existing orders remain available to ADMIN. Cookie loss, seven-day expiry or explicit revocation intentionally removes guest access without deleting purchases.

## 2. Frontend spawn EPERM: ENVIRONMENTAL / BLOCKED

The failure occurs in Node's piped subprocess execution path used by esbuild, before application bundling.

| Diagnostic actually executed | Result |
| --- | --- |
| Resolve Vite's nested esbuild and matching Windows package | PASS: installed esbuild 0.21.5 and matching binary found; no ESBUILD_BINARY_PATH override |
| Launch that exact esbuild.exe directly from PowerShell | PASS: version 0.21.5, exit 0 |
| Plain Node child-process probe using default piped stdio, independent of Vite | BLOCKED: EPERM |
| Launch Node child with inherited stdio / ignored stdio | PASS: exit 0 in both cases |
| Launch esbuild child with inherited stdio | PASS: version 0.21.5, exit 0 |
| Minimal esbuild TypeScript transform without Vite or application configuration | BLOCKED: spawn EPERM at ensureServiceIsRunning |
| Existing frontend production build | BLOCKED: same spawn EPERM while esbuild loads frontend/vite.config.ts |

This rules out a missing esbuild executable and reproduces the failure without app configuration. General executable launch permission works; the piped Node subprocess path is restricted in this execution context. The evidence is consistent with the Codex sandbox restriction. Distinguishing that restriction from a host Windows security policy affecting Node pipes requires the same probe outside Codex; that comparison was unavailable here. No frontend configuration or application code was changed to bypass it, and no dependencies were reinstalled.

The frontend dev command was not retried after the earlier acceptance report's identical failure. The final build and diagnostic probes above were sufficient; repeated blocked builds were avoided.

## 3. Files changed

| File | Change |
| --- | --- |
| backend/src/guest-access.ts | New durable guest credential creation, validation, legacy upgrade and revocation |
| backend/src/app.ts | Resolve guest ownership from SQLite; initialize identity and checkout credentials; revoke on clear; reject unauthorized history |
| backend/test/marketplace.test.mjs | Four focused regressions; update anonymous-history expectation to 401 |
| backend/dist/app.js | Rebuilt compiled API |
| backend/dist/guest-access.js | New compiled guest credential helper |
| README.md | Correct restart/cookie ownership and history authorization instructions |
| MVP_FINAL_FIX_REPORT.md | This report |

No frontend source, database schema, package manifests, lockfile, environment file or previous reports were changed. This directory has no Git metadata; Git diff/status verification was unavailable.

## 4. Verification results

| Check | Result |
| --- | --- |
| Focused backend suite during implementation | PASS: 29 tests |
| Final npm run typecheck | PASS: backend and frontend, exit 0 |
| Final npm test | PASS: 29 backend + 14 frontend = 43 tests, zero failed/skipped |
| Final npm run build: backend | PASS: TypeScript compilation |
| Final npm run build: frontend | BLOCKED: Vite/esbuild spawn EPERM; root command exit 1 |
| Browser acceptance | NOT EXECUTED |

New regression cases in `backend/test/marketplace.test.mjs`:

1. Line 482: create an owned order, start a fresh compiled app/session store with a different secret, restore history/order/payment/delivery access using only the durable guest cookie; deny another guest and ADMIN API access.
2. Line 525: reject missing, role-session-only, malformed, expired, tampered, duplicate, random and customer-ID-based credentials; reject forged query/header identity.
3. Line 550: explicit session clear revokes replay of the old credential while preserving the SQLite order.
4. Line 561: upgrade a valid private legacy session while retaining its order owner.

**Real process restart smoke: PASS.** The existing `npm start` script built and launched the backend twice on `127.0.0.1:62902`, using one isolated SQLite database. The first process was stopped and its port confirmed unreachable before the second start. The second used a different SESSION_SECRET and received only the original guest credential, with no role-session cookie.

Live HTTP assertions passed for private public-category responses, server-authoritative pricing, PENDING order/payment state, unpaid delivery refusal, paid email containing only purchased contacts, restoration of pending and paid orders/history/email after restart, foreign/missing/invalid credential rejection, guest denial of ADMIN endpoints, payment after restart and repeated confirmations. Each paid order retained exactly one SENT delivery with attempts=1; SQLite quick_check returned ok. Both backend processes were stopped afterward.

Regression coverage also continues to pass payment gating, contact privacy, authorization, production fail-closed behavior, uploads and idempotent delivery. These automated checks do not certify browser interactions.

Temporary evidence: `%TEMP%/mvp-final-fix-WcC39R/` contains final-tests.log, final-build.log, diagnostic.json, handle-probe.json and the isolated restart smoke fixture/script. The local restart evidence file includes test-only bearer cookies; do not publish it.

## 5. Exact steps outside the restricted execution environment

Open a normal local PowerShell window outside Codex. Use the existing installation and database; do not reset or reseed user data.

First compare the piped subprocess probe:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
@"
const { spawnSync } = require('node:child_process');
const child = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
console.log({ status: child.status, error: child.error?.code, stdout: child.stdout?.trim() });
process.exitCode = child.error || child.status !== 0 ? 1 : 0;
"@ | node

& '.\node_modules\vite\node_modules\@esbuild\win32-x64\esbuild.exe' --version
npm run build --workspace frontend
```

Expected: probe status 0 with a Node version, esbuild version 0.21.5, frontend build exit 0. If this succeeds outside Codex, it confirms the execution-context restriction. If the same probe fails there, investigate host Windows process/pipe security policy with the captured error; an application rewrite or dependency reinstall is not established as a fix.

Terminal 1, backend:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
$env:ALLOW_MOCK_PAYMENT = 'true'
$env:PORT = '3001'
npm start
```

Terminal 2, frontend:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
npm run dev --workspace frontend
```

Use `http://localhost:5173/`, `/admin`, `/orders` and `/dev/email-outbox`. API: `http://localhost:3001/api/health`. Keep the same hostname throughout so browser cookies remain available.

**Manual acceptance still required:**

1. In the browser, use ADMIN to create/edit a fictional category, manage its contacts and upload a valid raster image. Verify orders and payment statuses.
2. Switch to GUEST; browse without private contacts, add/remove cart items and check out. Verify pending state, simulate payment, then inspect the paid delivery and ADMIN outbox for purchased contacts only.
3. Keep browser cookies, stop the backend with Ctrl+C and restart it using the same command. Refresh `/orders` and the previous order; verify retained access and paid email. Repeat payment confirmation and verify one delivery.
4. In a separate private browser session remaining GUEST, verify the buyer's order/delivery is inaccessible and ADMIN APIs reject requests. Verify missing authorization, unpaid delivery, invalid checkout and invalid upload responses.
5. Complete browser refresh/navigation, file picker, image rendering and responsive layout checks from MVP_ACCEPTANCE_REPORT.md.

Fresh-install Prisma CLI initialization was blocked by native subprocess EPERM in the previous acceptance report and was not repeated here; this work validates the existing schema/runtime, not a fresh installation.

**Release gate:** obtain a successful frontend build/start outside the restriction and complete the browser checklist before declaring MVP v1.0 READY.

