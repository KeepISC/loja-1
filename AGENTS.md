# KeepISC/loja-1 development rules

## Scope and references

Implement focused tasks; preserve existing uncommitted work and inspect `git status`
before editing. Read only the relevant implementation and reference documents:

- `docs/authentication-rbac.md`
- `docs/authentication-email.md`
- `docs/stripe-checkout.md`
- `docs/mysql-migration.md`
- `docs/github-governance.md`

Use Node.js 24 (at least 24.7); tests use native SQLite, Argon2 and module hooks.
The root npm lockfile covers both workspaces. Prefer existing dependencies.

## Authentication and authorization

- Enforce roles, order ownership and Supplier contact assignments server-side.
  Registration creates Customers only. Real Admin authentication is required for
  account management, Supplier grants and refunds; mock Admin is not equivalent.
- Preserve CSRF checks, session rotation/revocation, HttpOnly/SameSite cookies,
  password hashing, rate limits and generic recovery responses.
- Never expose password hashes, session credentials or verification/reset tokens.
  Action tokens remain hashed, expiring, purpose-bound and single-use; recovery
  must invalidate the appropriate sessions. Guest access requires its own cookie.

## Payments

- Preserve server-calculated integer-cent totals, currency, ownership and provider
  binding. Browser success redirects cannot mark an order paid or grant delivery.
- Stripe webhooks require the bounded raw body and SDK signature/timestamp check
  before processing. Preserve live/test-mode checks, authoritative provider
  reconciliation, event deduplication, transactional transitions and idempotency.
- Keep provider network calls outside database transactions; preserve locking and
  refund/fulfillment rules on both databases. Never log card data or raw webhooks.
- Tests inject Stripe SDK mocks and fictional keys. No real Stripe requests,
  charges, refunds or CLI forwarding without explicit authorization.

## Email and sensitive data

- Use preview mode or injected mock SMTP transports in tests. Never contact a
  mailbox/provider or send real mail without explicit authorization.
- Private previews contain bearer links: never commit, upload as CI artifacts or
  paste their contents into logs/chat. Preserve token removal on use/replacement.
- Preserve trusted-origin links, verified TLS, encrypted SMTP queue payloads,
  bounded retry/timeout behavior and queue/token transaction safety. HTTP success
  acknowledges processing, not delivery. Keep encryption/signing keys private.

## Databases and migrations

- SQLite remains the local default. Keep SQLite and MySQL behavior compatible,
  including foreign keys, uniqueness/collation, dates, transactions and sessions.
  Generate separate clients; MySQL must not replace the SQLite Prisma client.
- MySQL tools allow only MySQL 8.0 at `localhost:3306/loja1_test`, using
  `loja1_test_app`. Never weaken host/account/database/engine/history guards.
- Do not change schemas or apply migrations unless the current task authorizes it.
  CI's existing migration replay targets only its fresh disposable service.
  Never run migration commands against the developer database to validate CI.
- Review SQL and the PR migration checklist before execution; inventory the target,
  back up existing data and define restore/forward recovery. Never rewrite applied
  migration checksums, reset/baseline automatically, drop data or mark a failed
  migration successful. MySQL DDL may partially commit on failure.
- Integration suites use fictional fixtures and run sequentially per database.
  Do not parallelize suites that share MySQL settings or cleanup state.

## Production, environments and the demo

- Keep production/staging startup disabled and preserve loopback, Host/Origin,
  remote-demo, mock-payment and access-control guards. No cloud/production database
  changes, deployment or real customer data without explicit authorization.
- Preserve the GitHub Pages fictional demo, hash routes, curated public assets and
  absence of backend requests, checkout, contacts, admin and outbox access.
- Only `.env.example` with placeholders is tracked. Never read or print private
  `.env*` files to debug CI. Do not commit secrets, credentials, SQLite files,
  uploads, generated clients, builds, logs or private email previews. Ignore rules
  do not remove already tracked files or revoke leaked credentials.

## Efficient verification and change management

- Use `rg` and targeted reads; avoid unrelated audits/refactors and duplicate runs.
  Run focused tests while editing, then `npm run verify:ci` once before a PR.
  That command builds once before suites and skips redundant npm pretest hooks.
  MySQL remains a separate disposable CI check, never an implicit local migration.
- CI uses `npm ci`, Node 24, cached npm downloads, read-only permissions and no
  application secrets. Never use `pull_request_target` to execute PR code or cache
  private environment/database files. Do not weaken failed checks to obtain green CI.
- Review npm audit results; do not use `npm audit fix --force`, automatic major
  upgrades or automatic merges. Use focused dependency remediation PRs.
- Report PASS, FAIL and NOT VERIFIED accurately, including environment failures.
  Do not claim successful Actions runs or enabled GitHub settings from local YAML.
- Explicit approval in the current request is required before commit, push, merge,
  release tagging, deployment or remote infrastructure changes. Commit approval
  does not authorize pushing. Stage only the authorized changes.
