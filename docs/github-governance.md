# GitHub governance and CI

Task 5.1, 2026-10-19. These files propose controls for `KeepISC/loja-1`; they
do not enable repository settings. Repository visibility, plan, collaborator
permissions and existing GitHub rules were not verified. No paid service is added.
Application behavior, schemas and existing migration files are unchanged by this
task. No migration, commit, push, merge, tag or deployment was executed.

## Checks implemented

`.github/workflows/ci.yml` runs on every PR targeting `main`, pushes to `main`
and manual dispatch. No path filters can leave required checks pending. Jobs have
timeouts, read-only `contents` permission, no persisted checkout credentials and
no application secrets. New runs cancel superseded runs on the same ref.
Checkout/setup-node are pinned to full upstream commit SHAs with version comments;
Dependabot proposes updates for review. Node.js stays on the supported 24.x line.

| Check name (select these exact job names in GitHub) | Coverage |
| --- | --- |
| `Verify / Node 24 + SQLite` | Cached npm downloads, `npm ci`, SQLite client generation, both workspace TypeScript checks plus Vite config types, backend/frontend production builds, Pages demo build, backend/frontend general tests, SQLite database/auth/Stripe integration |
| `Integration / MySQL 8` | Fresh MySQL 8.0 service, limited app user, ignored fictional configuration, separate MySQL client generation, guarded identity/history inspection, existing migration replay, sequential database/auth/Stripe integration |
| `Security / npm audit` | Online production and full-tree audits; high/critical findings or registry errors fail the check; moderate findings remain visible for triage |

The aggregate local command is `npm run verify:ci`. It compiles the backend once
and skips repeated npm pretest build hooks while running the actual test scripts.
It builds both the application and the distinct Pages demo mode, because they
expose different assets/routes. Production `NODE_ENV` is scoped to build commands;
the backend is never started in production. The existing `pages.yml` is preserved,
including its frontend checks, permissions, artifact path and deployment trigger.
Its post-merge verification intentionally remains independent from PR CI.

MySQL CI binds the service only to runner loopback port 3306. Credentials are
public fictional constants valid only inside the disposable runner; the app user
has privileges for `loja1_test` rather than root/global access. Existing target,
account, MySQL 8.0, InnoDB and migration-history guards remain in use. Only the CI
service receives existing migrations when this workflow eventually runs. CI
never contacts the developer's local database or a production database. The job
deletes its environment file and GitHub disposes of its service/runner. No DB,
email preview, private upload or environment artifact is published.

General HTTP tests force mock payment/preview email. Stripe integration supplies
fictional test keys, injected SDK responses and locally signed fixture events;
SMTP cases inject mock transports, including MIME composition without delivery.
No application secrets or real Stripe/SMTP credentials belong in Actions.

## Manual GitHub configuration

An administrator should review and configure the following; none is assumed enabled:

1. **Actions > General:** allow only needed actions/reusable workflows; keep the
   default token read-only and Actions PR creation/approval disabled. Require
   approval for outside-contributor workflow runs. Review changes to workflows
   before approving execution; use GitHub-hosted disposable runners for PR code.
2. **Rules > Rulesets**, or **Branches > Branch protection** if that is the
   available no-cost control: target `main`, require PRs, the three exact checks
   above with GitHub Actions as their source, resolved conversations and linear
   history; block force pushes/deletion. Require checks on the current merge base
   (up-to-date branches). Add the checks after the first workflow has reported them.
   Apply rules to administrators where supported and keep bypasses minimal and
   documented. Do not require a Pages deployment before PR merge: it runs on `main`.
3. **Solo review:** require the PR and checks with zero external approvals while
   only one maintainer exists; self-review the diff/checklist and record the result
   in the PR. GitHub does not count an author's own approval. When a second trusted
   reviewer has write access, require one independent approval and dismiss stale
   approvals. Avoid a reviewer rule that leaves the sole maintainer unable to merge.
4. **General > Pull Requests:** enable squash merging and automatic branch deletion;
   disable merge commits/rebase merging if enforcing this workflow. Leave automatic
   merging disabled. Review the final squash message and check results manually.
5. **Code security / Security settings:** enable dependency graph, Dependabot alerts
   and security update PRs where available. `.github/dependabot.yml` adds weekly
   grouped patch/minor npm and Actions version-update PRs; major updates are ignored
   and require a planned manual compatibility review. Do not auto-merge. A major-only
   security fix still needs explicit prioritization; the ignore rule is no waiver.
6. **CodeQL:** propose default setup for JavaScript/TypeScript, standard queries,
   PR/default-branch scans and a weekly scan where included at no extra charge.
   Confirm the available plan/visibility first; skip paid enrollment/trials.
   Once verified, optionally add its actual check name to protection. Do not require
   an analysis check that has not been configured or reported.
7. **Secret scanning:** enable scanning, push protection and private vulnerability
   reporting where available without extra cost. Review alerts and revoke/rotate
   exposed secrets. If unavailable, use local secret review/scanning before each
   push and establish a private reporting channel. No secret-history scan was
   executed here, so absence of tracked `.env` files is not proof of clean history.
8. **Pages:** preserve Source = GitHub Actions, the existing `github-pages`
   environment, allowed `main` branch and any existing approval gate. A merge/push
   to `main` triggers the existing demo deployment, so authorization must account
   for that effect. Do not add app secrets to Pages or deploy the backend there.
9. **Billing/access:** keep spending within the existing free allowance/budget;
   standard hosted Linux jobs can consume private-repository minutes. Limit
   collaborators and review access periodically. Do not purchase security services.

GitHub availability varies: [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[CodeQL/code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning),
[security setup and secret scanning](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository).
If a control requires upgrading the plan, document the limitation and use the
manual PR/checklist process rather than enabling billing.

## Ownership and migration review

No active CODEOWNERS file is added: an eligible individual/team with explicit
repository write access has not been established, and the repository owner name
alone is insufficient to infer a reviewer. After confirming one, add
`.github/CODEOWNERS` assigning `.github/`, `AGENTS.md`, `SECURITY.md`, `prisma/`,
authentication/payment/session modules and their reference docs. Confirm GitHub
resolves every owner; require owner approval only with an independent reviewer.

Every PR uses `.github/pull_request_template.md`. Its explicit migration checklist
covers both providers, SQL/constraints/indexes/collation, applied checksums,
disposable replay, existing-data upgrades, backup/restore, partial DDL failure,
target/account verification and separate execution approval. Mark it N/A for
governance-only changes. Passing fresh-service tests does not prove an existing
customer database can be upgraded safely. See [MySQL migration safety](mysql-migration.md).

## Lightweight solo workflow

1. Inspect the working tree; preserve existing changes. Create `feature/<task>`
   from the intended base. Keep the diff and task focused.
2. Run only relevant tests during development. For example, after a necessary
   backend build: `node --import ./backend/test/source-loader.mjs --test
   --test-isolation=none backend/test/security.test.mjs`. Rebuild if compiled
   integration inputs changed; do not repeat unrelated full suites on every edit.
3. With Node 24 and a current lockfile, use `npm ci` on a clean checkout and
   `npm run db:generate --workspace backend`, then `npm run verify:ci` once for
   consolidated verification. This does not migrate persistent MySQL or start the
   app. Use the disposable CI MySQL job for that coverage. Run/review both audits.
4. Review `git diff` and ignored files; stage only the intended files. Commit and
   push only after explicit authorization. Open a PR using the template; record
   PASS/FAIL/NOT VERIFIED and complete the migration checklist or explain N/A.
5. Review the diff, CI and audit findings; resolve conversations. After explicit
   merge authorization, squash merge the reviewed PR. Its push to `main` also
   invokes the existing Pages workflow; inspect that result and the fictional demo.
6. After release acceptance and explicit authorization, tag the reviewed `main`
   revision with an annotated `vX.Y.Z` tag and release notes. Pushing that tag is a
   separate authorized action. A tag does not authorize a backend deployment.

## Validation and release status

Local evidence is recorded below; workflow definitions are not evidence of a
successful hosted Actions run. See [dependency review](../DEPENDENCY_SECURITY_REVIEW.md)
for locked vulnerable dependencies and failed online-audit evidence.

| Local verification on Node 24.11.0 | Result |
| --- | --- |
| Workspace TypeScript checks and Vite configuration types | PASS |
| Backend production compilation | PASS |
| Frontend application build | FAIL / environment blocked: Vite/esbuild `spawn EPERM` loading configuration |
| Pages production build | NOT VERIFIED: consolidated command stopped at the application build; unchanged Pages workflow preserved |
| Backend and frontend general suites, run separately after blocked build | PASS; frontend 58 tests, zero failures in either suite |
| SQLite database, authentication/RBAC and Stripe integration, sequential | PASS: 10 + 11 + 9 tests |
| YAML syntax/duplicate keys for CI, Pages and Dependabot; CI structure, script references, Node/pins, isolated service/mock policy | PASS using local PyYAML plus structural assertions; not a full GitHub schema/runner validation |
| Ignore samples and unchanged Pages workflow | PASS; `.env.example` and migration SQL remain trackable |
| Isolated clean-install attempt using copied manifests/lockfile | FAIL / environment blocked: offline cache missing Zod; native hooks not verified |
| Online production/full npm audits | FAIL / environment blocked: registry connection refused; no valid vulnerability total |
| Hosted Actions, disposable MySQL service/migration replay, actionlint | NOT VERIFIED; no local persistent migration was run; actionlint unavailable |

The final aggregate command explicitly scopes `NODE_ENV=production` to the two
build modes, so a development test environment cannot select development React
bundles. Build subprocess restrictions still prevent consolidated sign-off here.

Remaining release blockers include a clean online install/audit, dependency
remediation, successful frontend/application and demo builds, first hosted CI
(including MySQL), configured/verified repository rules, browser acceptance,
Stripe test-mode acceptance, authorized SMTP delivery/deliverability acceptance,
operator reconciliation, backups/restore and the separately reviewed production
runtime/proxy/security profile. Production guards must remain enabled throughout.

Recommended next task: a focused dependency remediation PR for Multer and the
Vite/esbuild chain, with registry access, clean install, full audit and targeted
upload/frontend regression checks. Then obtain the first hosted CI evidence and
finish test-mode browser acceptance. Do not treat governance work as release sign-off.
