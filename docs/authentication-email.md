# Transactional authentication email

Verification and password-reset messages use a separate `AuthEmail` outbox and
configurable transport. Order-contact delivery remains the existing mock provider.
No new account-security notification events were introduced because none existed.
Production startup guards remain enabled. No Hostinger connection or real SMTP
delivery was made during implementation or testing.

## Configuration

Keep credentials in Git-ignored `.env.auth-email.local` at the repository root.
Check exclusion with `git check-ignore -v .env.auth-email.local` before entering
private values. Never paste that file into chat, log it or commit it.

The backend and worker load inherited process variables first, then
`.env.auth.local`, `.env.auth-email.local` and `.env`, without overriding earlier
values. Leave the SQLite `DATABASE_URL` and session secret unchanged. MySQL tests
use only the guarded local target from `.env.mysql.test` and force preview mode.

| Variable | Configuration |
| --- | --- |
| `AUTH_EMAIL_TRANSPORT` | `preview` by default in development; `smtp` explicitly selects delivery |
| `AUTH_APP_ORIGIN` | Trusted root application origin; preview defaults to `http://localhost:5173`; SMTP requires HTTPS and rejects loopback |
| `SMTP_HOST` | Required SMTP hostname, without scheme or path |
| `SMTP_PORT` | `465` for implicit TLS or `587` for required STARTTLS |
| `SMTP_USER` | Required full mailbox email address |
| `SMTP_PASS` | Required mailbox password, entered privately in the ignored file |
| `SMTP_FROM` | Required sender mailbox address authorized by the provider |
| `SMTP_TIMEOUT_MS` | Total delivery deadline, default `10000`, allowed `1000`–`30000` |
| `AUTH_EMAIL_ENCRYPTION_KEY` | Required SMTP queue key: 32 random bytes encoded as 43 base64url characters |

SMTP configuration is checked before the application handles authentication.
Missing/invalid values fail closed with a fixed error that contains no secrets.
Preview is rejected outside development. SMTP enables certificate verification,
TLS 1.2 or newer, connection/greeting/socket/DNS timeouts, and a total deadline.
Nodemailer logging, pooling, URL attachments and filesystem attachments are disabled.
See [Nodemailer SMTP options](https://nodemailer.com/smtp) and
[message security options](https://nodemailer.com/message).

## Local previews

1. Keep `NODE_ENV=development`, `AUTH_EMAIL_TRANSPORT=preview` and
   `AUTH_APP_ORIGIN=http://localhost:5173` (also the defaults when omitted).
2. Start the usual local application with `npm run dev`. Register a Customer or
   request verification/password reset through the existing account pages.
3. In a separate local browser session, select development Admin and visit
   `/dev/auth-email-outbox`. This private route is unavailable to ordinary users,
   remote demo visitors and production. It contains sensitive local bearer links.
4. Read the plain-text message, or select **Ver versão HTML**. Follow its action
   link in the intended account tab. The HTTP preview includes the full local link;
   SMTP templates additionally provide the HTTPS action button.
5. Change the saved appearance theme through Admin to test Classic, Minimal,
   Marketplace and Dark. Authentication uses the saved theme when queuing.

No worker or SMTP credentials are needed for previews. Historical text previews
remain readable. The existing sandboxed viewer blocks scripts and remote resources.
Messages explicitly say that no email was sent. SMTP outbox entries expose only
delivery status, never decrypted links. Consumed/replaced previews are removed.

## Hostinger SMTP setup (operator instructions; not executed)

Only perform a live delivery check after separate authorization. No credentials
are needed for automated tests. Do not set `NODE_ENV=production` for this task.

1. Obtain the mailbox settings from your Hostinger Email account. Its documented
   outgoing server is `smtp.hostinger.com`, normally port `465` with SSL/TLS;
   `587` uses STARTTLS. Use the full mailbox address as the username and its
   mailbox password. Confirm that these are the settings for your email product;
   other providers/products can use another hostname. Sources:
   [Hostinger account configuration](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/),
   [Hostinger SMTP ports](https://www.hostinger.com/tutorials/smtp-port/).
2. In the ignored file, set `AUTH_EMAIL_TRANSPORT=smtp`, the SMTP fields above,
   and `AUTH_APP_ORIGIN=https://your-owned-application-domain.example` using your
   reviewed application origin. Do not use Hostinger's SMTP hostname as the app
   origin. No path, query, fragment, username or password is allowed in that origin.
3. Generate the encryption key locally, without printing it. From the repository
   root, run the following **once**, only when the ignored file has no key yet:

   ```powershell
   node -e "const fs=require('node:fs'),c=require('node:crypto'),f='.env.auth-email.local';if(fs.existsSync(f)&&/^AUTH_EMAIL_ENCRYPTION_KEY=/m.test(fs.readFileSync(f,'utf8')))throw Error('Key already configured');fs.appendFileSync(f,'\nAUTH_EMAIL_ENCRYPTION_KEY='+c.randomBytes(32).toString('base64url')+'\n');"
   ```

   Retain the same key across backend/worker restarts and instances. Restrict file
   access and back it up securely. Drain pending messages before rotating it;
   messages encrypted with a lost/old key cannot be delivered and need a new user
   verification/reset request.
4. Start the backend normally in development. Start the independent dispatch
   process using the same private environment and database:

   ```powershell
   npm run auth:email:worker --workspace backend -- --watch
   ```

   `--once` processes currently due work and exits; a failed delivery gives a
   nonzero exit code. Preview mode exits without opening SMTP or querying the DB.
   Keep the worker running for automatic retry; monitor its status/counts and
   process availability. It prints no recipients, tokens or provider diagnostics.
5. After authorization, use a controlled mailbox to verify receipt, correct
   trusted links, SPF/DKIM/DMARC and mailbox-provider behavior. SMTP acceptance
   alone does not establish inbox delivery. Actual mail-client rendering remains
   a manual check. No real-delivery result is claimed here.

## Links, queue and retry behavior

Links are constructed solely from `AUTH_APP_ORIGIN`, fixed `/verify-email` or
`/reset-password` paths and a random bearer token in the URL fragment. Request
Host/forwarded headers, redirect parameters and recipients never choose the
domain. The frontend removes the fragment and submits the token by POST.
Verification expires after 24 hours; password reset after 30 minutes. Tokens are
hashed in `AuthToken`, purpose-bound, single-use and atomically consumed as before.

The token hash and queued email commit together. Public registration/recovery
responses acknowledge processing with HTTP 202; they never claim SMTP delivery.
Known/unknown email addresses return the same status and message, including when
SMTP later fails. HTTP handlers do not contact SMTP. The worker sends outside
database transactions and marks `SENT` only after positive SMTP acceptance.

SMTP payloads are encrypted with Node AES-256-GCM and a random nonce in a versioned
`AuthEmail.body` envelope. The bearer link is never stored there as plaintext.
Preview payloads intentionally remain readable only in the private local outbox.
An atomic compare-and-update claim prevents simultaneous workers from dispatching
the same pending item. A 60-second lease allows crash recovery. There are at most
five attempts, with delays of 30, 60, 120 and 240 seconds before retries. Failures
store only `DELIVERY_FAILED`; detailed provider responses are discarded. Expired,
used or replaced tokens are not dispatched. Success/cancellation drops the
encrypted payload. Exhaustion leaves a failed status; users can request a new
link, which atomically replaces the old token/message and restarts delivery.
Registering an already unverified account also permits verification retry.

Delivery is at least once: a process crash after SMTP acceptance but before the DB
update, or an ambiguous timeout during sending, can cause a duplicate on retry.
The total deadline bounds the worker's wait; SMTP socket inactivity timeouts also
apply, but a timeout cannot prove that the server did not accept the message.
Retries retain a stable message ID, but
provider deduplication is not guaranteed; the action remains single-use. A resend
can invalidate an older message already in flight. No sent/inbox guarantee is
exposed to the user.

## Storage, validation and rollback

No Prisma schema change, migration or existing-data rewrite is required. The
adapter reuses Task 2's `AuthEmail` and `AuthToken` tables on SQLite and MySQL.
Queue polling pages through envelopes in the existing body field; an indexed
status/next-attempt table and retention policy should be considered before large
production volumes. Stop workers before switching transports. To return to local
preview, set `AUTH_EMAIL_TRANSPORT=preview`, restore the loopback app origin and
restart. Existing encrypted SMTP rows are not dispatched by preview mode. Preserve
the key/database backup if those pending rows may be resumed later.

Run from the repository root:

```powershell
npm run typecheck
npm test
npm run test:auth --workspace backend
npm run test:database --workspace backend
npm run test:auth:mysql --workspace backend
npm run test:mysql --workspace backend
npm run build
```

Run the two MySQL suites sequentially. They guard
`localhost:3306/loja1_test` as `loja1_test_app`, force preview for HTTP flows, and
inject mocked SMTP for the encrypted queue/retry test. SQLite suites use temporary
databases. SMTP tests never open a network connection, including real Nodemailer
MIME compilation through its in-memory stream transport. Tests cover missing/
invalid configuration, trusted URLs, four themes, preview persistence, TLS options,
timeouts, rejection, safe errors, concurrency, token expiry/use, retry exhaustion,
lease recovery and indistinguishable recovery responses.

Remaining release blockers include real SMTP/deliverability acceptance, worker
process supervision, deployment/proxy review, browser authentication acceptance,
and the application's existing production/payment/order-email limitations. No
production mode or real payments were enabled. The sandbox's esbuild `spawn EPERM`
must be resolved in a permitted shell to verify the frontend bundle.

## Task 3 files and verification

New files: `backend/src/auth-email-transport.ts`, `backend/src/auth-email.ts`,
`backend/scripts/auth-email-worker.mjs`, `backend/test/auth-email.test.mjs` and this
document. Updated files:

- `.env.example`, `README.md`, `package-lock.json`, `backend/package.json`.
- `backend/src/authentication.ts`, `backend/src/app.ts`, `backend/src/config.ts`,
  `backend/src/email-designs.ts`, `backend/src/email-templates.ts`.
- `backend/scripts/mysql-env.mjs`, `backend/test/auth.integration.mjs`,
  `backend/test/database.integration.mjs`, `backend/test/marketplace.test.mjs`.
- `frontend/src/AuthPages.tsx`, `frontend/src/AccountManagement.tsx`,
  `docs/authentication-rbac.md`.

These changes retain the existing uncommitted authentication/RBAC implementation.
No database schema or migration was changed in Task 3.

| Verification on 2026-10-19 | Result |
| --- | --- |
| Backend suite, including seven new authentication-email tests | PASS: 83/83 |
| Frontend suite | PASS: 56/56 |
| SQLite authentication/RBAC with mocked SMTP queue | PASS: 11/11 |
| SQLite database/marketplace integration | PASS: 10/10 |
| Local MySQL authentication/RBAC with mocked SMTP queue | PASS: 11/11 |
| Local MySQL database/marketplace integration and existing migration checksums | PASS: 10/10 |
| Backend and frontend TypeScript | PASS |
| Backend build | PASS |
| Worker in forced preview mode | PASS: exits without SMTP or DB query |
| Frontend Vite build | BLOCKED: esbuild `spawn EPERM` in this environment |
| Real SMTP delivery and browser/mail-client acceptance | NOT VERIFIED |

Next recommended step: run `npm run build --workspace frontend` in a normal
permitted PowerShell and complete browser verification/reset/retry acceptance with
local previews. A live staging SMTP test requires separate explicit authorization.
