# Supplier Market: security hardening and private remote testing

Review date: 2026-10-17. This is a fictional development application, not a production service. **Do not expose the ordinary local backend or the Vite development/preview servers through a tunnel.** Use the explicit guest-only remote profile below, behind Cloudflare Access and connector-side Access token validation. A successful build and external Access checks are required before inviting testers.

The review considered `CODE_REVIEW.md`, `PHASE1_FIX_REPORT.md`, `PHASE2_FIX_REPORT.md`, `MVP_ACCEPTANCE_REPORT.md` and `MVP_FINAL_FIX_REPORT.md`. Their resolved ownership, payment/delivery, safe-upload, production-boundary and guest-restart findings were checked against current source and retained tests; they are not presented as new vulnerabilities. Earlier uncommitted email-theme work was preserved. No project database, existing credentials or remote infrastructure was modified.

## Findings and fixes

Severity describes impact if the development backend is exposed, not permission to use it in production. Source-confirmed weaknesses are distinguished from demonstrated end-to-end browser attacks, which were not executed.

| ID | Severity | Finding | Evidence and implemented fix |
| --- | --- | --- | --- |
| R01 | **High, confirmed** | Any reachable client could POST a mock ADMIN role while `NODE_ENV=development`. Loopback binding alone does not stop a local tunnel from forwarding external traffic. | Source had unrestricted development role selection. Local mode now rejects non-loopback connections, non-local Host values and forwarded/Cloudflare headers. Remote mode disables role selection, advertises no switcher capability and downgrades any retained ADMIN role before authorization. All admin APIs, outbox, configuration changes and admin email previews remain unavailable remotely. Regression requests with valid CSRF tokens and forged identity headers are denied. |
| R02 | **Medium, confirmed** | No CSRF token or origin rejection on state-changing endpoints; URL-encoded forms were accepted. SameSite=Lax and CORS alone did not protect same-site, different-origin form submissions. | Every unsafe method now requires an unguessable session-bound CSRF token. Origins and Fetch Metadata are checked, JSON is required except for bounded image multipart uploads, and URL-encoded body parsing is removed. Tests cover missing, foreign-session, stale, malformed and cross-origin tokens without successful mutation. Exploit mechanics were established from source; no browser exploitation is claimed. |
| R03 | **Medium, conditional deployment weakness** | Session and durable guest cookies were always non-Secure, including behind HTTPS proxies; role elevation reused the session ID. | Remote cookies now use Secure/HttpOnly/SameSite=Lax, role sessions expire after two hours, and role changes regenerate the session ID and CSRF token. Local HTTP remains supported; durable guest credentials retain their existing seven-day lifecycle. Cookie/session weaknesses were confirmed from configuration; no stolen-session exploit was reproduced. |
| R04 | **Low, confirmed integrity defect** | ADMIN contact update/delete used the contact ID while ignoring the category ID in the URL. | Both identifiers are now required in the Prisma mutation. Wrong-parent requests return 404 and preserve the record. This was not an escalation beyond ADMIN's existing permissions. |

No Critical vulnerability was confirmed. The following are preventive improvements rather than claims of reproduced exploitation:

- **Medium resource-abuse prevention:** API budgets of 1,000 requests/minute locally and 300 remotely; write budgets of 300/minute locally and 60 remotely; 30 role-session attempts/minute. Remote testers share the connector's loopback budget. These limits run before body parsing/session creation and ignore spoofable client-IP headers. Buckets expire and are bounded; HTTP 429 includes Retry-After.
- **Low input hardening:** JSON is limited to 64 KiB; URLs to 2,048 characters; orders to 100 category entries with bounded IDs; email addresses to 254 characters; new/edited category prices to 1,000,000 cents. Existing raster signature/MIME/filename checks and 2 MiB image limit remain, with one file, no text fields and a bounded multipart parser budget. Upload errors are generic.
- **Low browser/transport hardening:** nosniff, frame denial, no-referrer and Permissions-Policy headers; no Express fingerprint; API responses are no-store. The built remote storefront uses a same-origin CSP with inline styles allowed for React/cart/email styling, external module scripts from self, and no unsafe-inline script permission. Vite keeps its normal development/HMR behavior and gains basic response headers and strict port selection. Remote responses include a short HSTS policy.
- **Low session/configuration hardening:** omitted/weak placeholder local secrets generate an ephemeral secret; remote startup requires a non-placeholder secret of at least 32 characters and a dedicated HTTPS origin. Ambiguous flags, partial configuration and Quick Tunnel hostnames fail closed. The app trusts HTTPS forwarding only from a loopback socket in remote mode. HTTP request/header/keepalive timeouts and header count are bounded.

## Unchanged protections and review boundaries

- Startup and runtime still refuse mock providers outside `NODE_ENV=development`. The remote start script does not override the backend's NODE_ENV to bypass this guard.
- Orders remain owned by the validated durable guest credential, not an email/order ID. Guest ownership persists across backend restarts. Other customers get 404; unpaid or undelivered contacts remain unavailable.
- Mock payment remains explicitly gated by `ALLOW_MOCK_PAYMENT=true`. Remote testers can simulate only their own orders. Dummy delivery writes the SQLite outbox; no external email/payment is introduced.
- Public categories and ordinary order responses omit supplier bodies. Theme changes and email preview APIs retain server-side authorization. Remote administration is intentionally unavailable.
- Existing uploads remain limited to validated raster files with generated names and safe response headers. This is signature/container validation, not full image decoding or malware scanning.
- Static exposure remains limited to shipped images, validated uploads and the compiled frontend directory. Source, `.env`, SQLite and outbox files are not mounted. Unknown API routes return JSON 404 rather than the SPA.
- Inspected application logging does not print request bodies, cookies, credentials, supplier records or raw exception stacks. Existing error handling returns controlled/sanitized JSON. Ignored private files were not published or printed. This is not a forensic audit of every historical log or ignored artifact.
- No dependency was added or upgraded. Audit results are recorded below; a clean registry audit is not proof of complete security.
- The GitHub Pages fictional build retains its hash routing, `/loja-1/` base, in-memory cart, API allowlist and lack of admin/payment/backend functionality. CSRF initialization is skipped entirely in Pages mode.

## Safe localhost operation

Use fictional records only. No database reset or reseeding is required.

Terminal 1, from the project root:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
$env:REMOTE_TESTING = 'false'
Remove-Item Env:REMOTE_ORIGIN -ErrorAction SilentlyContinue
$env:ALLOW_MOCK_PAYMENT = 'true'
npm start
```

Terminal 2:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
npm run dev --workspace frontend
```

Open `http://127.0.0.1:5173/` consistently; use the local ADMIN/GUEST buttons as before. Backend binds `127.0.0.1:3001`, Vite binds `127.0.0.1:5173`. The local boundary accepts the standard loopback frontend/preview ports 5173/4173 and the configured API port. Do not add a tunnel to either local service. Other processes/users controlling this same computer are inside the local development trust boundary; this is not OS-user isolation.

The frontend obtains a CSRF token automatically and refreshes it after session rotation. Tokens are HMAC-derived with a server-only key and the session ID, giving concurrent initialization requests for one established session the same token. Regenerating the role session changes the token. For manual API testing use a cookie jar: GET `/api/csrf`, retain its session cookie, then send the returned token in `X-CSRF-Token` on every POST/PUT/PATCH/DELETE. Do not put tokens in URLs or logs. JSON writes use Content-Type application/json; images use multipart with exactly one `image` file. Existing curl/DevTools snippets without CSRF headers must be updated.

## Private remote testing with Cloudflare Tunnel

These are instructions for the operator after review, **not actions executed by this change**. Use an existing Cloudflare-managed hostname and an account with Tunnel/Access available. Do not open a public Quick Tunnel or expose Vite/HMR. Keep Windows inbound port forwarding/firewall exceptions disabled; cloudflared connects to loopback.

### 1. Prepare fictional data locally

Use localhost ADMIN to prepare categories, supplier fixtures and the chosen storefront theme. Stop that backend before starting the remote profile on the same port. Remote participants will be GUEST only; perform administrative testing locally. Do not run a second exposed local/admin backend as a workaround.

### 2. Create the Access application before publishing the hostname

In Cloudflare Zero Trust, add **Access controls → Applications → Add an application → Self-hosted** for the dedicated hostname, for example `shop-test.your-domain.example`. Cover the **entire hostname**, including assets, `/api`, `/uploads` and `/images`; do not add path exclusions or Bypass policies.

Enable One-time PIN under identity providers/login methods if needed, or use an already configured identity provider. Configure one Allow policy with **Include → Emails → only the exact approved tester email addresses**. If using OTP, add **Require → Login methods → One-time PIN**. Do not use Everyone, a broad email domain, Service Auth or OTP alone as the Include rule. Set an Access session duration of one hour. Default-deny everybody else.

Copy the application's **Application Audience (AUD) Tag** from its settings and note your Access team name. Cloudflare's [self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), [OTP guide](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) and [policy guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/) describe these controls. OTP by itself does not restrict who can authenticate.

### 3. Configure a named tunnel and origin token validation

Install cloudflared using Cloudflare's [official downloads and Windows instructions](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/). In a normal PowerShell terminal, authenticate and create a named tunnel:

```powershell
cloudflared tunnel login
cloudflared tunnel create supplier-market-private
```

Keep the generated certificate and tunnel credentials under your private `%USERPROFILE%\.cloudflared` directory, outside this repository. Do not paste credentials into chat, source or command arguments. Create `%USERPROFILE%\.cloudflared\supplier-market-private.yml`, replacing placeholders:

```yaml
tunnel: YOUR-TUNNEL-UUID
credentials-file: C:\Users\YOUR-USER\.cloudflared\YOUR-TUNNEL-UUID.json
ingress:
  - hostname: shop-test.your-domain.example
    service: http://127.0.0.1:3001
    originRequest:
      httpHostHeader: shop-test.your-domain.example
      access:
        required: true
        teamName: YOUR-ACCESS-TEAM-NAME
        audTag:
          - YOUR-ACCESS-APPLICATION-AUD
  - service: http_status:404
```

The `access.required` setting makes cloudflared validate the Access JWT before forwarding any request. Use the exact team's name and application's AUD. For dashboard-managed tunnels the equivalent is **Protect with Access**, enabled for this hostname and application. See Cloudflare's [origin Access parameters](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/origin-parameters/).

Validate the local ingress configuration and then create the DNS route only after the Access policy is configured:

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\supplier-market-private.yml" ingress validate
cloudflared tunnel route dns supplier-market-private shop-test.your-domain.example
```

Use Cloudflare HTTPS for the public hostname, redirect HTTP to HTTPS, and do not add alternate public hostnames that bypass Access. No router port forwarding or direct public origin is needed.

### 4. Build and start the guest-only remote application

In a fresh local PowerShell terminal from the project root:

```powershell
Set-Location 'C:\Projects\Projeto 50k'
$env:NODE_ENV = 'development'
$env:REMOTE_ORIGIN = 'https://shop-test.your-domain.example'
$env:SESSION_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
$env:ALLOW_MOCK_PAYMENT = 'true'
npm run start:remote
```

The script builds backend and frontend before listening. Only the frontend build child gets NODE_ENV=production; the backend must still be explicitly in development. A failed build prevents startup. The Express process serves the compiled frontend and API together on loopback port 3001. Do not use the Pages build for this full local application. Do not bypass a blocked build by serving an old artifact.

In another terminal, start the protected connector in the foreground:

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\supplier-market-private.yml" run supplier-market-private
```

The application checks the configured public Host and HTTPS forwarding, sets Secure cookies, accepts only same-origin writes with valid CSRF, and refuses ADMIN independently of forwarded identity headers. The ordinary local profile refuses Cloudflare/forwarded requests.

### 5. Verify before inviting anyone

1. In a signed-out/incognito browser, visiting the hostname and `/api/health`, `/uploads/...` and `/api/csrf` must require Access authentication or be denied. An unauthenticated request must never receive application JSON or an uploaded image. Test an unapproved email and verify denial.
2. Sign in as an approved tester. `/api/auth/me` must return GUEST and `mockAccountSwitchingEnabled: false`. No mock account buttons should appear. Inspect both session/guest cookies: Secure, HttpOnly and SameSite=Lax. Confirm HTTPS, assets and normal category/cart/theme layouts.
3. Try ADMIN APIs and a role change with a valid CSRF token: they must return 403. A forged Cloudflare email header must not grant a role. Check that localhost mode is also not reachable through another tunnel/hostname.
4. Use two independent approved browser profiles. Complete a fictional checkout, verify unpaid delivery is refused, simulate the payment and inspect only the buyer's contacts. The other browser must receive 404 for that order/delivery. Restart the backend with cookies retained and confirm durable guest ownership.
5. Check keyboard/mobile behavior, uploads previously created locally, email HTML, cart animation and the console for CSP errors. These browser checks cannot be replaced by server-rendered tests.

**What the app cannot enforce:** it does not authenticate Cloudflare users or independently verify JWTs. Those jobs are delegated to Access and cloudflared's required token validation, as supported by Cloudflare. The app cannot prove that an operator configured the correct policy, AUD, DNS route, connector, OS firewall or every alternate hostname. Host/forwarding checks and headers are not authentication. If the edge/connector checks above are missing or fail, **do not expose or invite testers**. Other reverse proxies must provide an equivalent authenticated edge and token validation; their safe setup has not been verified here.

## Stop or revoke access

- Stop foreground cloudflared with Ctrl+C; confirm the hostname no longer reaches the app. Stop the backend with Ctrl+C. This guide does not install an unattended tunnel service.
- Remove/disable the application's Allow policy when ending a test or removing a tester. Under **Access controls → Applications → Configure → Revoke existing tokens**, revoke the application's sessions; verify denial afterward. Logging out of one browser alone does not remove other testers' policy permissions. See [Cloudflare session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/). Remove the tunnel's DNS route/hostname when it is no longer needed.
- Clear the shell's REMOTE_ORIGIN, set REMOTE_TESTING=false and restart normally for local ADMIN work. Rotate SESSION_SECRET before another remote run if needed; losing role sessions does not erase orders.
- Durable guest capabilities intentionally survive backend/role-secret restarts. Use the CSRF-protected `/api/dev/session/clear` from the owning session to revoke its guest credential, without deleting purchases. Revoking Access is the operator's control for denying a remote tester at the edge; changing SESSION_SECRET alone does not revoke guest ownership.

## Remaining risks and release gates

- This is still a mock development system with no real authentication, payment or external-email provider. Remote access is private, temporary and **guest-only**. No public-production readiness is claimed.
- Local mock ADMIN remains available to clients inside the trusted localhost boundary. A malicious local process/user or a proxy deliberately rewriting/removing boundary headers is not isolated by this application. Protect the workstation and do not expose the local profile.
- Cloudflare policies, domain/DNS ownership, connector token validation and revocation require operator configuration and external validation. No tunnel, Access application, identity provider or paid service was created or changed here.
- Express MemoryStore is appropriate only for bounded testing, not production/high availability. Rate limits are per-process, reset on restart and aggregate remote visitors; they are not a replacement for edge controls or a distributed DDoS defense.
- No full image decoder, malware scanner, browser penetration test or exhaustive secrets/history audit was added. Stored email snapshots retain their existing paid/owner restrictions and sandboxed previews.
- The known Windows/Codex esbuild subprocess restriction may prevent frontend compilation/startup here. Until a current build and the browser/Access checks pass in a permitted environment, remote testing remains gated.

## Verification and changed files

Final results on 2026-10-17:

| Check | Result |
| --- | --- |
| Backend regression suite after the CSRF concurrency correction | **PASS — 72 tests** |
| Frontend regression suite | **PASS — 52 tests** |
| Backend/frontend TypeScript checks | **PASS**; final backend changes also compiled in its test prebuild |
| Backend build, including compiled-app regressions | **PASS** |
| npm dependency audit (`npm audit --json --ignore-scripts`) | **PASS — 0 known vulnerabilities reported; 434 dependencies reported** |
| Tracked public/private artifact check and selected credential-pattern scan of source/public assets/workflow/example configuration | **PASS — only shipped SVG assets tracked; no environment/database/private-key files tracked and no scanned credential patterns matched** |
| CSRF/session/origin/host/rate-limit/input/remote-profile regressions | **PASS** |
| Existing privacy, ownership across restart, paid-only/idempotent delivery, upload, storefront/email-theme and Pages regressions | **PASS** |
| Frontend production build | **BLOCKED — Vite/esbuild spawn EPERM before compilation**, attempted once for this task |
| Pages/remote-start builds after that failure | **NOT RETRIED**, same frontend subprocess requirement |
| Browser/CSP/HMR/mobile acceptance and live Cloudflare policy/tunnel tests | **NOT VERIFIED**, external/manual gates remain |
| `git diff --check` | **PASS** |

The consolidated run exposed a concurrent first-CSRF-token issuance race in an existing checkout replay regression. Issuance was corrected to be deterministic per established session using HMAC; a parallel-token assertion was added, and the complete affected backend suite then passed all 72 tests. The unchanged frontend suite had already passed all 52 tests. No test is skipped or represented as browser acceptance.

Focused security regressions use isolated fictional SQLite/upload/frontend fixtures and simulated loopback proxy headers; they do not create a real Cloudflare tunnel or validate its live policy. No existing project database or supplier/customer record was modified.

Files touched by this security task:

- `backend/src/security.ts` (new), `backend/src/app.ts`, `backend/src/guest-access.ts`, `backend/src/index.ts`.
- `frontend/src/api.ts`, `frontend/vite.config.ts`.
- `backend/test/security.test.mjs` (new), `backend/test/marketplace.test.mjs`.
- `frontend/test/security.test.mjs` (new), `frontend/test/workflow.test.mjs`.
- `.env.example`, `package.json`, `README.md`, `SECURITY_REMOTE_TESTING.md` (new).

Existing uncommitted email/theme changes in shared files remain intact. No dependency installation, commit, push or deployment was performed.
