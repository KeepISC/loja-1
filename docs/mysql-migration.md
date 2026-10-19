# Local MySQL support and validation

Authentication follow-up: `202610190002_authentication` adds five tables and
nullable Supplier contact ownership. Stripe follow-up:
`202610190003_stripe_checkout` adds three payment lifecycle/audit tables and
additive currency/provider-reference/refund columns. All three migrations are
applied to the isolated local test database; integration tests verify their
checksums. See [authentication-rbac.md](authentication-rbac.md) and
[stripe-checkout.md](stripe-checkout.md) for the current seventeen-table
application schema, behavior and latest verification results.
The original compatibility validation record below describes the initial schema.

SQLite remains the default development database (`prisma/schema.prisma`,
`database/dev.db`). MySQL uses `prisma/mysql/schema.prisma` and its own migration
history. MySQL client generation writes to `node_modules/.prisma/mysql-client`;
it does not replace the SQLite client in `node_modules/.prisma/client`.
No data is copied between databases automatically.

This implementation intentionally permits MySQL only at
`localhost:3306/loja1_test`, with the account `loja1_test_app`. Remote hosts,
alternative accounts/databases, URL query parameters and production/staging
startup are rejected. Do not change these guards to test against a hosting account.

## Credentials

Use the root `.env.mysql.test` file. `.gitignore` ignores `.env*` except the
placeholder `.env.example`. Confirm from the repository root:

```powershell
git check-ignore -v .env.mysql.test
```

The local file has this shape (placeholders only):

```dotenv
NODE_ENV=development
DATABASE_URL="mysql://loja1_test_app:REPLACE_LOCALLY@localhost:3306/loja1_test"
SESSION_SECRET="REPLACE_WITH_A_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS"
```

Enter the password in your local editor, percent-encoded for use inside a URL.
Do not paste it into chat, commands, logs or source control. Keep a random session
secret stable across restarts so signed session cookies remain valid. The setup
performed on this machine already generated one without displaying its value.
The environment loader reads this file explicitly; normal SQLite commands continue
to use the existing `.env`. Do not replace `.env` with the MySQL configuration.

## Prepare, inspect and migrate

Use the installed Prisma 5.22 dependencies; no Docker or additional service is
required. From the repository root:

```powershell
npm run db:generate --workspace backend
npm run mysql:generate --workspace backend
npm run mysql:inspect --workspace backend
npm run mysql:migrate --workspace backend
```

Inspection validates the URL before connecting, then checks `DATABASE()`,
`CURRENT_USER()`, server port and MySQL 8.0 version. It inventories existing tables,
storage engines and record counts without displaying customer data. Unexpected
tables, non-InnoDB tables and a nonempty database lacking Prisma migration history
stop migration. Existing nonempty databases must be backed up and assessed before
any manual baseline; the tooling never resets or automatically baselines them.
Even with migration history, review existing data and any failed migrations before
proceeding. Close other apps using this test database while running integration
tests, which temporarily exercise and restore its shared theme setting.

The initial versioned migration creates nine application tables and six foreign
keys, preserving cascade, set-null and restrict behavior. It uses InnoDB,
`utf8mb4_0900_bin` (case-sensitive, NO PAD), millisecond datetimes, bounded indexed
strings, TEXT descriptions/notes and LONGTEXT email bodies/session payloads.
MySQL 8.0.17 or newer is needed for this collation. Unique email, slug, order number,
payment/order and delivery/order constraints match the SQLite schema. Foreign-key,
order-history and session-expiry indexes are explicit.

`mysql:migrate` uses `prisma migrate deploy` followed by `prisma migrate status`.
It does not use `db push`, a shadow database, destructive reset or development seed.
MySQL DDL can commit partially on failure: stop and inspect migration history before
retrying; never blindly mark a failed migration applied.

### Restricted Windows process spawning

On this agent's Windows environment, Node spawning Prisma commands returns
`spawn EPERM`. The installed Prisma schema engine can be launched by PowerShell.
The following fallback repeats the safe inspection and calls that same engine's
`applyMigrations` operation against the versioned directory, recording normal
`_prisma_migrations` history:

```powershell
& .\backend\scripts\mysql-migrate-local.ps1
```

It captures engine diagnostics without displaying connection details. It never
resets the database. It is specific to the installed Prisma 5.22 Windows engine;
prefer the normal Prisma CLI in an unrestricted terminal. Both clients were
generated locally using the installed generator in process after the normal
generation command was blocked; generated files remain ignored. For fresh installs,
run the normal generation commands above in a terminal that permits Prisma's
subprocesses. Do not upgrade dependencies merely to bypass this restriction.

## Validation

```powershell
npm run test:mysql --workspace backend
npm run test:database --workspace backend
npm run test --workspace backend
npm run typecheck
npm run build
```

`test:mysql` builds the backend, loads only the ignored test connection and checks
the server identity again before tests. The integration suite checks migration
checksums, InnoDB, column types, indexes, unique constraints, all foreign-key delete
behaviors, rollback on nested-write failure, Unicode, large email bodies, hashed
sessions, independent-client persistence, expiration, rotation, logout deletion,
themes, authorization, checkout replay, prices, payment gating and concurrent
payment/delivery idempotency. Only recorded fixture IDs are deleted; an existing
theme is restored. Failed/interrupted runs can leave fictional fixtures; inspect
them and remove only confirmed fixture records, never truncate shared tables.

`test:database` runs the same functional tests against a temporary SQLite file.
The existing backend suite also uses isolated temporary SQLite fixtures. Neither
command touches `database/dev.db`. Normal `npm run dev` remains the SQLite flow.
Existing SQLite files receive additive settings/session tables when first used;
no existing rows are replaced. Regenerate the SQLite client after schema changes.

Sessions use SHA-256 digests of high-entropy Express session IDs as primary keys;
raw IDs are neither columns nor session payload fields. Expired sessions are
refused and removed; writes opportunistically remove expired rows at most once a
minute per store instance. Touch cannot revive expired or deleted rows. Logout and
role changes delete the old session. Guest capability credentials remain hashed
in synthetic user emails, retaining existing guest-order ownership behavior.
Expired unused rows can remain while the app is idle, but cannot authorize access.

InnoDB deadlock/write-conflict errors (`P2034`) retry the entire payment/delivery
transaction up to five attempts with short backoff. These transactions contain
only database side effects; never put real email or payment network calls inside
the retry callback.

## Rollback and production limitations

To return to SQLite, stop any MySQL-configured backend and start the normal
development command with the original `.env`. Both clients coexist; no generation
swap or data reset is needed. Keep the MySQL schema/history intact for inspection.
There is no automatic MySQL down migration or SQLite-to-MySQL data transfer. Restore
a verified local test backup if schema rollback is actually required; retain any
new records first. Do not run destructive rollback against an existing database.

This is local compatibility validation, not production enablement. The app still
uses development account switching, dummy payment and dummy email delivery.
Production/staging startup fails closed; real authentication, payments, email,
authorization review, operational backups and secure deployment configuration are
still required. MySQL selection is deliberately restricted to the local test
database. Session storage alone does not make the application production-ready.

References: [Prisma MySQL native types](https://docs.prisma.io/docs/orm/v6/overview/databases/mysql),
[Express session store contract](https://expressjs.com/en/resources/middleware/session.html),
[MySQL 8.0.17 binary collation](https://dev.mysql.com/doc/relnotes/mysql/8.0/en/news-8-0-17.html).

## Validation record — 2026-10-19

- Target and account confirmed before migration; initial test database was empty.
- `202610190001_init` applied successfully through the PowerShell engine fallback.
  Reapplication reports zero pending migrations. Checksum and completed migration
  history are verified by the integration tests.
- MySQL integration: 9 scenarios plus parent test, **10/10 PASS**.
- Temporary SQLite integration: **10/10 PASS**.
- Existing backend suite plus new configuration/retry checks: **75/75 PASS**.
- Backend/frontend TypeScript checks and backend build: **PASS**.
- Full build: frontend blocked at Vite/esbuild startup by **spawn EPERM**, before
  compilation. No successful frontend build is claimed.
- Fixtures removed; the original test database had zero application records and
  remains empty apart from schema and migration metadata. SQLite development data
  was not opened by these tests or migration commands.

Files created: `prisma/mysql/schema.prisma`,
`prisma/mysql/migrations/migration_lock.toml`,
`prisma/mysql/migrations/202610190001_init/migration.sql`,
`backend/src/database.ts`, `backend/src/sqlite-compat.ts`,
`backend/src/session-store.ts`, `backend/src/transaction-retry.ts`,
`backend/scripts/mysql-env.mjs`, `backend/scripts/mysql-local.mjs`,
`backend/scripts/mysql-test-env.mjs`, `backend/scripts/mysql-migrate-local.ps1`,
`backend/test/database-config.test.mjs`, `backend/test/database.integration.mjs`,
and this document. The ignored `.env.mysql.test` contains local configuration.

Files modified: `prisma/schema.prisma`, `backend/src/app.ts`,
`backend/src/appearance.ts`, `backend/src/seed.ts`,
`backend/scripts/preview-emails.mjs`, `backend/test/schema.sql`,
and `backend/package.json`. Pre-existing working-tree changes were preserved.

Next step: in a normal local PowerShell terminal that permits esbuild child
processes, run `npm run build` from the repository root. This is the remaining
build verification; no commit, push, deployment or production enablement is needed.
