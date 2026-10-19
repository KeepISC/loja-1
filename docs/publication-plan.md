# First GitHub CI validation — Task 5.3

Prepared 2026-10-19 for `KeepISC/loja-1`. No staging, branch creation, commit,
push, PR creation, merge, migration, deployment or GitHub setting change was
performed. Commands below are for an explicitly approved operator publication.

## Readiness and current evidence

The work is prepared for a **feature-branch draft PR to obtain hosted CI
evidence**. It is not signed off for merging, release or production. Do not report
CI green until all three hosted jobs pass on the reviewed revision.

- Local branch: `main`, tracking `origin/main`; HEAD and cached upstream both
  `99628dbe7f8c599150ecc876fb4c0fa6f4a578a2`.
- Read-only `git ls-remote --heads origin main` returned that same revision.
  This is a snapshot; fetch again immediately before publication. No existing
  local commits are ahead of that tip, and the index is empty.
- Accumulated changes include Stripe, SQLite/MySQL compatibility, security
  dependencies, Tailwind 4, tests and governance. Existing schemas and a new
  migration SQL file are part of the reviewed source publication; publishing SQL
  does not authorize applying it to a persistent or remote database.
- Last Task 5.2 full tests: 89 backend + 58 frontend PASS, including actual v4 CSS
  compilation. Those unchanged tests were not rerun in this publication review.
- Fresh `npm run verify`: FAIL / environment blocked. Workspace and Vite config
  TypeScript checks and backend compilation passed, but Vite config loading hit
  `spawn EPERM`. Later aggregate tests and Pages build were not reached. Prior
  explicit Pages build had the same blocker. Existing `frontend/dist` is ignored
  and is not evidence that these attempts succeeded.
- Fresh full and production-only npm audits, both with `--offline=false`, failed
  at the advisory endpoint with `ECONNREFUSED 127.0.0.1:9`. No final clean audit
  or vulnerability count can be confirmed. Logs: ignored
  `tmp/publication-verify.log`, `tmp/publication-audit-all.log` and
  `tmp/publication-audit-prod.log`.

## Publication content and sensitive-file review

`docs/publication-files.txt` is the exact allowlist for the accumulated changes.
It includes this plan and the allowlist itself. Do not use `git add .` or `git add
-A`. Rerun the review if files change after approval.

Reviewed tracked/current publication paths for private environments, credentials,
database files, generated clients/builds, logs and outbox/preview data. Reviewed
tracked text and candidate contents for private-key headers, GitHub/AWS/Stripe
credential patterns and password-bearing database URLs, printing only locations.
All eight credential-pattern locations were explicit fictional test/CI fixtures
or a replacement-placeholder MySQL URL. `.env.example` contains placeholders,
empty secret configuration and local defaults. No private `.env` file was read.

No prohibited filename or non-fixture credential match was identified in that
review. This is a targeted review, not a full Git-history or entropy-based secret
scan. Staged content must still be inspected immediately before committing.

Private `.env`, `.env.auth.local`, `.env.mysql.test`, local SQLite databases,
`node_modules`, Prisma clients, build output, logs, temporary/browser state and
private email fixtures/previews remain ignored and absent from the allowlist.
The operator's generated `audit-before.json` is preserved locally and now covered
by `/audit-*.json`; it is deliberately excluded. No existing file was deleted.
If any real secret is discovered, stop publication, revoke/rotate it and review
history privately; a new ignore rule alone does not remediate exposure.

## Workflow review

- `ci.yml`: Node 24; root npm workspaces/lockfile; `npm ci` with npm download
  caching; explicitly generated SQLite client; workspace/config types; backend,
  frontend and distinct Pages-mode builds; general and SQLite integration suites.
- MySQL job: hosted Linux runner and isolated MySQL 8.0 container, bound to
  loopback port 3306; fictional credentials, limited `loja1_test_app` user,
  guarded identity/history checks and sequential database/auth/Stripe tests.
  Its future replay of existing migrations is confined to its disposable service;
  no local/persistent migration was executed or is part of these commands.
- Mock payment/preview email defaults; Stripe and SMTP tests inject mocks; no
  application/production credentials. Read-only repository permission, pinned
  CI checkout/setup actions, disabled persisted Git credentials and bounded jobs.
- Both audit scopes gate high/critical findings and registry errors. Lower
  severities require explicit triage, not silent dismissal.
- `pages.yml` is byte-for-byte unchanged from HEAD: Node 24, frontend checks,
  `npm ci --ignore-scripts`, curated `frontend/dist` artifact and existing Pages
  deployment permissions. Tailwind's platform-specific optional packages must be
  present after that clean Linux install; do not omit optional dependencies.
- CI runs on PRs targeting `main`, pushes to `main`, and manual dispatch. A new
  feature-branch push alone does not run this configuration: **open the PR**.
  Pages deploys on `main` pushes/manual dispatch, not feature-branch PRs. Do not
  manually dispatch Pages as part of the first PR validation. A later merge to
  `main` has a demo-deployment side effect and requires separate authorization.

Local YAML/structural validation is not a hosted Actions run. Actionlint and
Linux/platform-specific native-module behavior remain unverified locally.

## Commands after explicit operator approval

In normal PowerShell, first obtain the missing local verification/audit evidence
if network and subprocess access are available. Preserve the dirty tree:

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
npm run verify
# Record the actual result; do not call a partial run PASS.
npm audit --json --offline=false
npm audit --omit=dev --json --offline=false
```

If those remain blocked only by the operator's environment, the operator can
explicitly approve a draft validation PR documenting the blockers. No merge is
authorized by such approval. Use these guarded commands after reviewing the
allowlist/content; they stop if remote `main` has advanced or staging is unexpected.

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
$publishBranch = 'feature/task-5-security-governance-ci'
$approvedBase = '99628dbe7f8c599150ecc876fb4c0fa6f4a578a2'
git status --short
if ((git branch --show-current).Trim() -ne 'main') { throw 'Unexpected branch; review before continuing.' }
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) { throw 'Existing staged work found; preserve it and review separately.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; do not publish against stale tracking data.' }
if ((git rev-parse HEAD).Trim() -ne $approvedBase -or (git rev-parse origin/main).Trim() -ne $approvedBase) {
  throw 'Base changed. Stop and prepare a reviewed integration plan; do not reset, rebase or force push.'
}
git switch -c $publishBranch
if ($LASTEXITCODE -ne 0) { throw 'Branch creation failed; do not reuse or overwrite an existing branch.' }
git add --pathspec-from-file=docs/publication-files.txt
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; inspect the index.' }
$approvedPaths = @(Get-Content -LiteralPath docs/publication-files.txt)
$stagedPaths = @(git diff --cached --name-only)
if ($stagedPaths.Count -eq 0 -or @($stagedPaths | Where-Object { $_ -notin $approvedPaths }).Count -gt 0) {
  throw 'Empty or unexpected staged content; stop and inspect.'
}
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged whitespace check failed.' }
git diff --cached --name-status
git diff --cached --stat
git diff --cached
```

Inspect that exact staged diff locally. Confirm only the placeholder environment
template appears, no private/generated data is staged, and the migration checklist
is completed for the included source schema/SQL. Approval must cover these actual
changes. Then, with explicit commit approval:

```powershell
git commit -m "Add Stripe checkout, security dependency updates and repository CI governance"
if ($LASTEXITCODE -ne 0) { throw 'Commit failed; do not push.' }
git show --stat --oneline HEAD
git status --short
```

With **separate explicit push approval**, publish only the feature branch:

```powershell
if ((git branch --show-current).Trim() -ne $publishBranch) { throw 'Unexpected branch; stop.' }
git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed; stop.' }
if ((git rev-parse origin/main).Trim() -ne $approvedBase) { throw 'Remote main advanced; stop for review.' }
$existingBranch = @(git ls-remote --heads origin "refs/heads/$publishBranch")
if ($LASTEXITCODE -ne 0 -or $existingBranch.Count -ne 0) { throw 'Remote branch exists or lookup failed; stop for review.' }
git push --set-upstream origin "HEAD:refs/heads/$publishBranch"
if ($LASTEXITCODE -ne 0) { throw 'Push rejected/failed; never retry with force.' }
```

Plain push cannot overwrite divergent remote history. If rejected, preserve the
branch/commit, fetch and review remote changes; do not reset or force push. Do not
push `main`, tags or unrelated branches. If the branch already exists from a prior
attempt, inspect it and use an explicitly reviewed follow-up plan.

## First hosted Actions validation

1. After push approval/publication, open a **draft PR** at
   <https://github.com/KeepISC/loja-1/compare/main...feature/task-5-security-governance-ci?expand=1>
   with base `main` and the feature branch as head. Use the PR template; explain
   local build/audit limitations and link the dependency report. Creating a draft
   PR is a separate operator action, not something executed here.
2. Open PR **Checks** or repository **Actions > CI**. Match the branch and commit
   SHA to the reviewed push; a run from another revision is not sign-off. If
   outside-contributor approval is requested, review the workflow before approval.
3. Require successful outcomes for all three uniquely named jobs:
   `Verify / Node 24 + SQLite`, `Integration / MySQL 8`, `Security / npm audit`.
   A skipped/cancelled run or one successful job is insufficient. The PR runs on a
   test merge revision; record the head SHA and run URL in the PR.
4. Open each failed job/step and retain sanitized diagnostics. Use the following
   table to fix the actual cause, then push a new reviewed feature-branch commit
   only with authorization. Do not weaken a check to obtain green status.
5. Verify CI logs show both frontend application and Pages-mode builds and all
   three MySQL suites, without live providers or external DB URLs. Record the
   final run URLs and actual check results. Do not dispatch/merge Pages here.

| Hosted failure | Focused response |
| --- | --- |
| Lockfile mismatch / npm ci failure | Reproduce with clean Node 24/npm install; regenerate manifests/lock together with normal npm; inspect diff. Do not substitute npm install in CI to hide drift. |
| Tailwind/oxide/Lightning CSS missing Linux binary | Confirm optional platform packages in lockfile, clean npm ci and correct runner architecture; do not omit optional deps or patch node_modules. |
| Prisma engine/generation failure | Inspect the generation step and runner network/native dependencies. Keep separate SQLite/MySQL clients; never point tests at hosting or change DB guards. |
| MySQL health/identity/history failure | Inspect service startup and loopback mapping, exact test DB/user/version and checked-in SQL history. Repair disposable setup; no production URL, broad root access, reset/baseline bypass or manual persistent migration. |
| Cross-platform path/case/shell failure | Correct the exact path case, workspace cwd or shell command. Linux paths are case-sensitive. Rerun the affected check after the fix. |
| Genuine build/test regression | Reproduce on Node 24 with the exact lockfile and fix the behavior. Windows spawn EPERM does not prove the Linux runner has the same limitation. |
| Audit advisory or registry failure | Distinguish valid findings from network errors. Update affected dependencies safely and re-audit; do not use force upgrades, continue-on-error or lower the gate. |
| No PR CI run / permissions | Confirm Actions is enabled, PR base is main, workflow exists on the PR revision and required approvals are granted. New workflow manual dispatch may not be available before it exists on the default branch. |
| Future Pages-only failure | Separately authorized main demo deployment: confirm Pages Source/permissions/environment and curated artifact path; never deploy application secrets or backend data. |

## Manual GitHub settings (not enabled/verified here)

- **Actions:** enable workflows, allow needed official actions, default token
  read-only, no Actions PR approval/creation privilege, and approval for untrusted
  external runs. Use disposable hosted runners and the existing free budget.
- **Main ruleset/branch protection:** require PRs, current-base successful checks
  listed above from GitHub Actions, resolved conversations and linear history;
  block deletion and force push; minimize bypasses. Select exact check names after
  their first hosted report. Do not require Pages deployment before PR merge.
- **Solo review:** require zero external approvals while there is only one
  maintainer, with documented self-review. Add one independent approval/stale-review
  dismissal when a trusted second reviewer exists. Confirm CODEOWNERS users/team
  write access before enabling owner-review requirements.
- **Merge settings:** squash merge, automatic branch deletion, automatic merging
  disabled. Merge authorization must account for the existing main Pages trigger.
- **Dependencies:** dependency graph, Dependabot alerts/security PRs and the
  checked-in weekly npm/Actions updates; no automatic major updates/auto-merging.
  Dependabot configuration takes effect once present on the default branch;
  a feature-branch file alone does not prove it is active.
- **Secret scanning:** enable scanning, push protection and private reporting when
  included at no additional cost. Review alerts privately and rotate exposures.
  CodeQL JS/TS default setup is recommended only where already available free;
  do not purchase/enable a paid plan or trial to complete this task.
- **Pages:** retain Source = GitHub Actions and the existing main/environment
  restrictions. No production/backend deployment or new app secrets.

Plan/visibility-dependent availability and detailed recommendations are documented
in [governance](github-governance.md#manual-github-configuration). Primary references:
[branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches),
[GitHub security setup](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository),
[workflow run inspection](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history).

Remaining merge/release blockers: first successful hosted CI (including clean
Linux installs/MySQL), verified full/application/Pages builds, valid fresh audits,
manual theme/demo and Stripe test-mode/authorized SMTP acceptance, and confirmation
of repository controls. Source publication for validation does not enable the
application's production profile or authorize a persistent database migration.
