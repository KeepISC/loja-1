# Authentication and RBAC

Account authentication is implemented locally alongside the existing guest and
demo workflows. The application still refuses production/staging startup while
dummy payment/email providers remain. Nothing here enables production mode or
connects to a hosting account.

## Implemented behavior

Public registration creates a new `User` with role `CUSTOMER` and a separate
`Account` credential record. Requests with role/ownership fields are rejected.
Existing guest identities, orders, accounts and supplier contacts are not
converted or reassigned. Emails are trimmed and lowercased for account lookup;
email matching never grants access to an order. The internal `@local.test`
namespace remains reserved for mock and guest identities.

Passwords use Node's native Argon2id with a 16-byte random salt, 19 MiB memory,
two passes, one lane and a 32-byte output. Hashes use the standard PHC encoding;
verification uses a timing-safe comparison. Password length is 12–128 characters.
At most four native password computations run concurrently. There is no custom
password-hashing algorithm or fallback to a weaker algorithm. Node >=24.7 is
required; validation used Node 24.11.0. An external Argon2 dependency could not be
downloaded in this restricted environment, so the installed runtime is reused.

Email verification is required before login. Random 256-bit verification/reset
tokens are stored as SHA-256 hashes with a purpose and expiry. Verification lasts
24 hours; reset lasts 30 minutes. Consumption is an atomic, conditional write in a
transaction. Replay, expiration and cross-purpose use fail. Resending replaces the
previous token and its local preview. Password reset increments the account's
session version, invalidating all earlier authenticated sessions.

The database session store is reused. Login regenerates the session ID and removes
the earlier session. Authenticated sessions have a two-hour idle timeout and a
twelve-hour absolute limit. A stable signing secret makes them valid across server
restarts. Roles, verification, Supplier activation and session version are loaded
from the database on every authenticated request. Role changes invalidate existing
sessions; the next request rotates the stale session and requires login again.
Logout deletes the current session and clears its cookie, retaining the separate
guest credential. The existing development session-clear action still revokes the
guest credential. Cookies are HttpOnly, SameSite=Lax and Secure in production or
the existing HTTPS remote profile. CSRF protection applies to all auth writes.

Registration, login, reset and verification requests have a 20/minute socket-IP
limit per app instance. Email-address operations also share a database-backed
20/10-minute limit across instances, keyed by an HMAC rather than a raw address.
Unknown and existing addresses receive the same registration/recovery response.
Logout remains available after authentication rate limiting. The existing remote
demo stays guest-only and rejects account authentication. Do not expose the local
mock account switcher through a tunnel.

## Approved authorization model

| Role | Access |
| --- | --- |
| Guest | Public catalog, checkout, and only purchases proven by a valid guest cookie |
| Customer | Public marketplace and the account's own orders/deliveries |
| Supplier | Customer access plus viewing/editing explicitly assigned contacts |
| Admin | Marketplace administration, all contacts, account list, Supplier grants/revocations and assignments |

Only a **real authenticated Admin** can grant/revoke Supplier or assign/unassign
contacts. A mock Admin cannot use account-management endpoints. Supplier writes
include contact ID, assigned Supplier ID, current active profile, current database
role and session version in the database predicate. Suppliers cannot change
ownership, category, roles or arbitrary record fields. Revocation immediately
removes permissions, invalidates old sessions and retains an inactive profile for
future workflows. Existing assignments confer no access while inactive. No
Supplier application, approval, submission or guest-purchase transfer is included.

`SupplierProfile` is separate from credentials and linked to `User`; a later
application/review lifecycle can attach to it without rebuilding contact ownership.
The nullable `SupplierContact.supplierId` references the profile and is indexed.
Unassigned legacy contacts remain Admin-managed.

## Frontend and endpoints

Routes include `/login`, `/register`, `/verify-email`, `/forgot-password`,
`/reset-password`, `/resend-verification`, `/supplier`, `/admin/accounts` and the
private local `/dev/auth-email-outbox`. They reuse theme tokens and the existing
email-preview component. Navigation follows the current role; API 401 responses
invalidate the displayed authentication state, preserve status/error codes and
show an expired-session notice. Mutations are never retried after an auth failure.
CSRF initialization alone may retry its explicit pre-mutation rejection.

Auth writes use `/api/auth/register`, `/login`, `/logout`, `/verify-email`,
`/resend-verification`, `/forgot-password` and `/reset-password` below `/api/auth`.
`GET /api/auth/me` restores a validated account or the existing guest context.
No password/hash/session version or action token is returned in auth responses.

Account checkout/history use `/api/account/orders`, which requires authentication
even when a guest cookie is present. The checkout attempt signature includes
account identity to prevent reusing a different account's pending attempt.
`/api/orders` remains compatible with existing guest checkout/history.
`/api/guest/orders` and `/guest/orders` expose guest history separately, including
after account login. Individual order/delivery access still requires the current
account, the proven guest cookie or Admin. No email-based claiming occurs.

Admin account management uses `GET /api/admin/accounts`,
`PUT /api/admin/accounts/:id/supplier` with `{ "active": true/false }`, and
`PUT /api/admin/contacts/:id/assignment` with `{ "supplierId": "id-or-null" }`
(use JSON `null` to unassign). Supplier access uses
`GET /api/supplier/contacts` and `PUT /api/supplier/contacts/:id` with allowlisted
contact fields. Other account role changes have no public HTTP endpoint.

## Local setup and first Admin

Keep the existing `.env` and SQLite datasource. `.env.auth.local` contains only a
random session signing secret and is ignored by `.gitignore`. It loads before
`.env`; inherited process environment takes precedence over both. A stable secret
was generated locally without displaying it. MySQL tests continue to load only
the existing ignored `.env.mysql.test` connection, which overrides the local
signing key in the test process. Never paste these files into chat or source control.

The default email adapter writes private `AuthEmail` previews; **no email is sent**.
An optional SMTP adapter and retry worker are now available; see
[authentication-email.md](authentication-email.md) for configuration, encryption,
trusted HTTPS links and delivery semantics. SMTP was validated with mocks only.
`EmailDelivery` remains the order-only delivery outbox, with its existing ownership
and paid-state checks. Keeping authentication messages separate avoids fabricating
orders to send account emails. The local auth outbox is Admin-only and unavailable
in production/remote-demo mode. It intentionally contains bearer links needed for
local verification, so treat its storage as private. Consumed/replaced links are
removed from the preview. Tokens are fragments, never URL query strings; the auth
page removes the fragment and retains it only in memory, then redeems it by POST.
Plaintext passwords/tokens/secrets are never printed or put into auth API results.

To provision the first real Admin:

1. Register a Customer in the local UI.
2. In a separate local browser session, use the existing development Admin switch
   and open `/dev/auth-email-outbox`. Copy the verification **path** from the
   preview into the Customer's application tab and confirm verification.
3. Create ignored `.env.auth-admin.local` at the repository root containing
   `ADMIN_EMAIL=the-verified-account-address` and `CONFIRM_INITIAL_ADMIN=true`.
   It contains no password. Do not put the address into tracked seed scripts.
4. For the default SQLite database run
   `npm run auth:bootstrap-admin --workspace backend` from the repository root.
   For local MySQL, build the backend and explicitly use its safe preloader:
   `node --import ./backend/scripts/mysql-test-env.mjs backend/scripts/bootstrap-admin.mjs`.
5. Sign in again. The operator-only command accepts only a verified Customer and
   closes permanently once a real Admin exists. No Admin was provisioned in your
   existing data during this task; test Admins were isolated fictional fixtures.

## Migrations, validation and rollback

`prisma/mysql/migrations/202610190002_authentication/migration.sql` is additive:
it creates `Account`, `AuthToken`, `AuthEmail`, `AuthRateLimit` and `SupplierProfile`,
adds nullable contact ownership, five foreign keys and the relevant unique/expiry/
ownership indexes. It uses InnoDB, the existing binary collation, bounded indexed
strings, millisecond timestamps and LONGTEXT preview bodies. The original migration
is unchanged. This migration was applied only to `localhost:3306/loja1_test` using
the installed Prisma engine fallback described in [mysql-migration.md](mysql-migration.md).

SQLite uses `auth-schema.ts` to add the same tables/indexes and nullable contact
column once per client initialization. It neither rebuilds existing tables nor
rewrites existing rows. A legacy-data test verifies preservation and repeatability.
Both Prisma clients must be regenerated from their separate schemas after model
changes. Prisma's normal generation command remains blocked here by `spawn EPERM`;
both clients were generated with the installed generator in process, without
changing tracked dependencies or switching the default provider.

Run from the repository root:

```powershell
npm run typecheck
npm test
npm run test:auth --workspace backend
npm run test:database --workspace backend
npm run test:mysql --workspace backend
npm run test:auth:mysql --workspace backend
npm run build
```

Fixtures use reserved domains and are removed by recorded IDs. No test opens the
existing SQLite development database. MySQL checks validate the exact local target,
both migration checksums, tables, constraints and indexes. Do not run database and
auth integration suites concurrently against the same test database. For rollback,
stop the app and restore a verified backup if schema rollback is required; retain
new accounts/data first. There is no destructive down migration. Returning to
SQLite uses the original development datasource without transferring MySQL data.

Remaining production work: validate the SMTP adapter with an authorized mailbox,
review deployment/proxy settings and the configured HTTPS application origin, verify
password hashing capacity on the deployment runtime and complete browser acceptance.
Real payment/email order providers and the full application's production guards
remain outside this task. Account/version checks do not replace an independent
security review. The frontend bundle currently remains blocked by esbuild
`spawn EPERM`; type checks and server-rendered UI tests do not certify browser UX.

Next recommended task: run the frontend build and browser authentication acceptance
checks in a normal permitted PowerShell environment. Then arrange an explicitly
authorized SMTP staging delivery check. Keep production disabled until the remaining
provider/deployment work is complete.

References: [Node native Argon2](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback),
[OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP recovery tokens](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Verification record — 2026-10-19

| Check | Result |
| --- | --- |
| Backend tests, including legacy SQLite migration and first-Admin restrictions | PASS — 76/76 |
| Frontend tests, including role navigation, expiry handling and identity-scoped checkout | PASS — 56/56 |
| SQLite authentication/RBAC integration | PASS — 10/10 (nine scenarios plus parent) |
| MySQL authentication/RBAC integration | PASS — 10/10 (nine scenarios plus parent) |
| SQLite marketplace/database integration | PASS — 10/10 |
| MySQL marketplace/database integration and migration checksums | PASS — 10/10 |
| Backend and frontend TypeScript checks | PASS |
| Backend build | PASS |
| Frontend build | BLOCKED — Vite/esbuild spawn EPERM before compilation |
| Interactive browser acceptance | NOT VERIFIED |

MySQL migration `202610190002_authentication` was applied once. A subsequent
application found zero pending migrations. All fourteen application tables use
InnoDB, alongside Prisma migration metadata. Fictional fixture users, orders,
sessions, token hashes, private preview messages and rate-limit keys were removed.
No real Admin was created, no SQLite development data was overwritten, and no
production database, hosting account, payment integration, commit, push or deployment
was touched.

New files:

- `backend/src/authentication.ts`, `backend/src/passwords.ts`,
  `backend/src/auth-schema.ts`, `backend/src/supplier-access.ts`,
  `backend/src/admin-bootstrap.ts`
- `backend/scripts/bootstrap-admin.mjs`
- `backend/test/auth.integration.mjs`, `backend/test/auth-schema.test.mjs`
- `frontend/src/AuthPages.tsx`, `frontend/src/AccountManagement.tsx`,
  `frontend/test/auth.test.mjs`
- `prisma/mysql/migrations/202610190002_authentication/migration.sql`
- `docs/authentication-rbac.md`
- Ignored local configuration: `.env.auth.local` (signing secret only)

Modified files:

- `prisma/schema.prisma`, `prisma/mysql/schema.prisma`
- `backend/src/app.ts`, `backend/src/config.ts`, `backend/src/security.ts`,
  `backend/src/session-store.ts`
- `backend/scripts/mysql-local.mjs`, `backend/test/database.integration.mjs`,
  `backend/test/schema.sql`, `backend/package.json`
- `frontend/src/App.tsx`, `frontend/src/MarketplacePages.tsx`,
  `frontend/src/Storefront.tsx`, `frontend/src/api.ts`, `frontend/src/checkout.ts`,
  `frontend/src/stores.ts`, `frontend/test/storefront.test.mjs`
- `package-lock.json` (runtime engine requirement only), `README.md`,
  `docs/mysql-migration.md`
