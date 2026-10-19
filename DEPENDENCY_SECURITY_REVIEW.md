# Dependency security review

## Tailwind CSS 4 installed verification — 2026-10-19

**The operator has now installed the required v4 packages.** Frontend CSS
compilation and all general tests pass. Full migration/security completion is
still **NOT VERIFIED** because Vite application/Pages builds are blocked by this
environment and the npm advisory endpoint remains inaccessible. Earlier sections
are historical checkpoints, not the final dependency state.

### Final installed and locked versions

| Package | Verified version |
| --- | --- |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| vite | 7.3.7 |
| @vitejs/plugin-react | 4.7.0 |
| react-router-dom / react-router | 7.18.4 / 7.18.4 |
| multer / @types/multer | 2.4.0 / 2.3.0 |

The frontend manifest and lockfile already contained the operator's successful
Tailwind/adapter installation when this resumed task began. No further dependency
installation or lockfile edit was needed. The PostCSS configuration uses the v4
adapter; explicit CSS imports, config loading, source boundaries and theme token
compatibility compile successfully against the actual installed packages.

The old `braces`, `chokidar`, `micromatch`, `fast-glob`, `postcss-nested` and
`postcss-selector-parser` package paths are absent from the final lockfile. This
confirms removal of the dependency paths in the operator's seven-finding report.
It does **not** establish a zero-vulnerability final tree or exclude new advisories.
One fresh online `npm audit --json --offline=false --fetch-retries=0
--fetch-timeout=15000` attempt failed with `ECONNREFUSED 127.0.0.1:9`; remaining
audit counts are unknown. No installation retry loop or force fix was used.

### Additional compatibility fix and test evidence

Inspection of generated v4 CSS found a changed default sans font stack. The
existing JavaScript theme configuration now explicitly retains v3's `ui-sans-serif,
system-ui, sans-serif` plus emoji fallbacks, preserving the existing `font-sans`
class behavior. Per-theme body/heading font variables remain unchanged.

Expanded the actual compilation test to verify the visible-sibling selectors and
top/bottom margin values for each used `v3-space-y-2/3/4/5/6` class, preservation
of the font stack, and removal of unresolved compiler directives/functions. It
continues to verify all four theme selectors, scoped semantic colors, radii,
shadows, focus and reduced motion. Generated `.rounded` remains 0.25rem;
`.shadow-sm` uses the theme's `--shadow-panel`; the hidden outline retains its
forced-colors fallback. Compilation checks pass without changing visual assertions
to skip missing dependencies or weakening application tests.

| Executed check | Result |
| --- | --- |
| Focused frontend suite with installed adapter | PASS: 58/58 |
| Final frontend rerun after font-stack fix and stronger CSS assertions | PASS: 58/58, including real PostCSS/Tailwind compilation |
| `npm test` | PASS: backend 89/89 and frontend 58/58; later font-only change verified by final frontend rerun |
| `npm run verify` (single consolidated attempt in this resumed task) | Both workspace type checks, Vite config types and backend build PASS; frontend build blocked by `spawn EPERM` loading Vite config |
| Application `npm run build` | Executed through `verify`; backend PASS, frontend environment-blocked |
| Separate `npm run build:pages --workspace frontend` | Environment-blocked by the same `spawn EPERM` |
| Inspection of generated CSS and final lockfile paths | PASS for the properties and removed paths described above |
| Fresh `npm audit` | Environment-blocked; no valid final vulnerability totals |
| Clean `npm ci`, browser appearance review, complete consolidated run / hosted CI | NOT VERIFIED |

The font-only follow-up does not affect TypeScript/backend behavior; those passing
checks were not redundantly repeated. Both blocked builds failed during config
loading, before application compilation. Logs are under ignored
`tmp/tailwind4-installed-*.log`; generated CSS inspection is under
`tmp/tailwind4-compiled.css` (captured before the final font override).

Files changed by the migration are listed in the preparation section below. In
this resumed verification, only `frontend/tailwind.config.js`,
`frontend/test/themes.test.mjs` and this report were further edited; the operator's
manifest/lockfile changes and all other existing uncommitted work were preserved.

### Remaining visual and release checks

CSS compilation now verifies the intended tokens and compatibility utilities, but
pixel/interactive parity has not been measured in a browser. Review Classic,
Minimal, Marketplace and Dark on desktop, 390px and 320px: typography, form stack
spacing, border/shadow/radius values, focus/forced colors, navigation, cart motion,
reduced motion and explicit dark color-scheme. Tailwind 4's modern-browser support
floor also remains a compatibility consideration. In Pages mode, check assets,
hash refresh and disabled checkout/admin/order/outbox routes. No theme was removed.

No dependency installation is still required for the currently inspected tree.
In a normal PowerShell terminal with permitted registry access and subprocesses:

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
npm run verify
if ($LASTEXITCODE -ne 0) { throw 'Verification failed; inspect the first failure.' }
npm audit --json --offline=false
npm audit --omit=dev --json --offline=false
git diff --check
```

Inspect the audit JSON and exit statuses; a connection error is not a clean audit.
On a fresh checkout, first run `npm ci --offline=false` and
`npm run db:generate --workspace backend` (generation only, no schema migration).
Only if dependencies are missing, the exact approved installation remains
`npm install 'tailwindcss@^4.3.3' '@tailwindcss/postcss@^4.3.3' --save-dev
--workspace frontend --offline=false`.

**CI readiness:** code/configuration is prepared for the first hosted validation
run, and no known automated test failure remains locally. A green CI result,
successful application/Pages builds and a valid fresh audit have not been
confirmed, so migration/security sign-off and merge/release readiness are pending.
No migration, production activation, commit, push or deployment was performed.

## Tailwind CSS 4 migration preparation — historical checkpoint, 2026-10-19

**Configuration prepared; installation, builds and security remediation remain
incomplete. Not ready for a successful first CI run.** This section supersedes
the earlier recommendation to retain Tailwind 3. The operator's new audit reports
7 findings (5 high, 2 moderate), involving the Tailwind 3 braces/chokidar/micromatch/
fast-glob chain and postcss-selector-parser/postcss-nested. That report is the
reason for the now-authorized v4 migration; it is not a fresh final audit.

### Dependency state and installation blocker

The installed/locked frontend Tailwind is **3.4.19**, with no installed
`@tailwindcss/postcss`. A single isolated npm resolution attempt for
`tailwindcss@^4.3.3` and `@tailwindcss/postcss@^4.3.3` failed with registry
`ECONNREFUSED 127.0.0.1:9`. It ran on copied manifests/lockfile under ignored
`tmp/tailwind4-candidate`, with lifecycle scripts disabled, and did not replace
the working dependency installation. No repeated installation retries were made.

The actual workspace manifest and lockfile were left unchanged rather than
inventing package metadata or integrity values. They still require the operator
install command below to become consistent with the prepared v4 configuration.

| Package | Before / actual after | Target after operator installation |
| --- | --- | --- |
| Frontend Tailwind | 3.4.19 / 3.4.19 | npm-resolved patched 4.x, minimum 4.3.3 |
| @tailwindcss/postcss | Missing / missing | Corresponding 4.x PostCSS adapter, minimum 4.3.3 |
| Vite / React plugin | 7.3.7 / 4.7.0, unchanged | Preserve |
| React Router DOM / React Router | 7.18.4 / 7.18.4, unchanged | Preserve |
| Multer / types | 2.4.0 / 2.3.0, unchanged | Preserve |
| Prisma/client, Stripe, Nodemailer | 5.22.0, 23.0.0, 10.1.7, unchanged | Preserve |

### Migration implemented locally

- `frontend/postcss.config.js` uses only the supported `@tailwindcss/postcss`
  integration. The old direct Tailwind plugin and separate Autoprefixer pass are
  removed from the pipeline; v4 handles import resolution and prefixing. No
  extra Vite plugin or backend dependency is introduced.
- `frontend/src/index.css` imports the v4 theme, preflight and utilities styles
  individually, without introducing native cascade layers. Existing local theme,
  storefront, navigation and animation imports retain their prior relative order
  before preflight/utilities; this avoids changing specificity precedence between
  existing component selectors and utilities. Explicit `@config` loads the existing
  semantic color/radius/shadow map rather than replacing the four theme palettes.
- Automatic utility detection is disabled for the utilities import; explicit
  `@source` paths include only frontend `index.html` and `src`. No repository-wide
  scanning or private backend/environment content is introduced.
- Existing pixel breakpoints remain 640/768/1024/1280/1536. JavaScript theme config
  pins the v3 bare/small radius and bare shadow values while retaining all scoped
  CSS-variable colors, control/panel radii and panel/hover shadows.
- `frontend/src/tailwind-compat.css` preserves v3 default uncolored borders,
  placeholders and enabled-button cursor behavior. Existing theme files and
  color-scheme handling are unchanged; Dark remains an explicit selected theme.
- v4 changes the `space-y` selector and moves spacing to the preceding sibling's
  bottom margin. To retain existing layout behavior, a dedicated `v3-space-y-*`
  utility uses the old following-visible-sibling selector and quarter-rem top
  margins. Only these class references in five TSX files were renamed. The used
  `outline-none` reference becomes `outline-hidden`, retaining its invisible outline
  for forced-colors accessibility. No handlers, state, routes or business rules
  were altered by these class substitutions.
- The existing CSS compilation test now loads the actual v4 PostCSS adapter and
  entrypoint with real file paths, checking all four theme selectors, generated
  spacing and semantic color/radius/shadow tokens, focus and reduced-motion rules.
  It fails explicitly when the adapter is absent; no skip or fallback hides that
  missing prerequisite. The test no longer flattens imports with a regex.

Official references: [PostCSS installation](https://tailwindcss.com/docs/installation/using-postcss),
[upgrade differences](https://tailwindcss.com/docs/upgrade-guide),
[explicit config/source/utility directives](https://tailwindcss.com/docs/functions-and-directives).
Tailwind 4 raises browser requirements (Safari 16.4+, Chrome 111+, Firefox 128+);
older-browser parity is not promised by this migration.

Files changed in this session: `frontend/postcss.config.js`,
`frontend/tailwind.config.js`, `frontend/src/index.css`, new
`frontend/src/tailwind-compat.css`, `frontend/src/App.tsx`,
`frontend/src/MarketplacePages.tsx`, `frontend/src/AuthPages.tsx`,
`frontend/src/AccountManagement.tsx`, `frontend/src/EmailThemePreview.tsx`,
`frontend/test/themes.test.mjs`, and this report. Pre-existing uncommitted changes
were preserved. No application behavior, database schema or backend implementation
was changed in this migration session.

### Actual verification

| Check | Result |
| --- | --- |
| Focused frontend suite, final version | 57/58 PASS; CSS integration FAIL because @tailwindcss/postcss is not installed |
| `npm run verify` (once after application/config fixes) | Workspace and Vite config TypeScript PASS; backend build PASS; frontend build FAIL / `spawn EPERM` while loading Vite config; later checks not reached |
| `npm test`, separately because aggregate stopped before tests | Backend 89/89 PASS; frontend FAIL only on missing adapter. Final focused frontend rerun confirms 57/58 after test cleanup |
| Application production build | Attempted through the aggregate's `npm run build`; frontend blocked by `spawn EPERM` |
| GitHub Pages build | Attempted separately; same `spawn EPERM` blocker |
| Whitespace and migrated outline/spacing references | PASS; all four original theme files retained |
| `npm audit --json --offline=false --fetch-retries=0 --fetch-timeout=15000` | FAIL / registry advisory endpoint `ECONNREFUSED`; no valid final vulnerability count |
| v4 CSS compilation, clean installation, desktop/mobile visual parity and browser acceptance | NOT VERIFIED until the dependency installation and builds can run |

The previous operator count of 7 has **not** been remediated or independently
re-audited here. Final counts and any residual transitive findings are unknown.
Do not claim the configuration edits alone remove vulnerable packages from the
lockfile. Backend tests use temporary fictional data and mock providers. No
database migration, commit, push, production activation or deployment occurred.

### Exact operator continuation (normal PowerShell)

Use a terminal with permitted npm registry access and working process creation.
Review the existing dirty tree; let npm update manifests and lockfile together.
Do not use `npm audit fix --force` or migrate the database to validate frontend CSS.

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
git status --short
npm install 'tailwindcss@^4.3.3' '@tailwindcss/postcss@^4.3.3' --save-dev --workspace frontend --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Tailwind 4 installation failed; stop here.' }
npm ls tailwindcss '@tailwindcss/postcss' vite '@vitejs/plugin-react' react-router-dom multer
if ($LASTEXITCODE -ne 0) { throw 'Resolve dependency or peer errors first.' }
git diff -- frontend/package.json package-lock.json
npm ci --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Clean installation failed.' }
npm run db:generate --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'Client generation failed; do not run migrations.' }
npm test --workspace frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend or CSS compilation regression remains.' }
# Includes typecheck, both production builds (application/Pages), all general
# tests and sequential SQLite integrations. Run it once after any necessary fixes.
npm run verify
if ($LASTEXITCODE -ne 0) { throw 'Consolidated verification failed.' }
npm audit --json --offline=false
npm audit --omit=dev --json --offline=false
git diff --check
```

Inspect both audit JSON results and their exit statuses; a registry error is not
a clean audit. Record exact final versions and every remaining advisory here.
After valid builds, compare Classic/Minimal/Marketplace/Dark at 320px, 390px and
desktop widths: fonts, semantic/state colors, borders/radii/shadows, stacked forms,
menus, focus/forced colors, cart animation/reduced motion and dark color-scheme.
In the Pages preview, check asset paths, hash-route refresh and disabled
checkout/admin/order/outbox routes. Successful builds, a fresh audit and this
appearance review are required before declaring migration/security completion.

## Final compatibility verification — 2026-10-19

**Not ready for a successful first GitHub Actions run.** Multer 2 and the
Router/Vite corrections are now present, but Tailwind remains **4.3.3**, contrary
to the intended 3.x state. The manifest, lockfile and installed package agree on
4.3.3. The current CSS regression therefore remains reproducible. This section
supersedes the earlier checkpoints below; it is not a clean security sign-off.

### Final observed versions

All listed package versions were checked against both the root lockfile and
installed package metadata. No dependency versions changed during this final
verification session, and package-lock.json was not edited.

| Package | Version before and after this session | Verification |
| --- | --- | --- |
| React Router DOM / React Router | 7.18.4 / 7.18.4 | Public StaticRouter imports and all Router-dependent frontend tests execute |
| Tailwind CSS | 4.3.3 | Fails the existing v3 PostCSS compilation test; 3.x is not installed |
| Vite | 7.3.7 | Frontend and React plugin now resolve the same deduplicated supported version |
| React Vite plugin | 4.7.0 | Its peer range includes Vite 7; no plugin upgrade/config rewrite needed |
| Multer / @types/multer | 2.4.0 / 2.3.0 | Upload and TypeScript compatibility passed |
| PostCSS / Autoprefixer | 8.5.30 / 10.6.1 | Existing configuration retained; Tailwind major remains the blocker |
| esbuild | 0.28.2 | Unchanged |
| Prisma / @prisma/client | 5.22.0 / 5.22.0 | Unchanged; schemas and migration files not edited |
| Stripe / Nodemailer | 23.0.0 / 10.1.7 | Unchanged; mocked backend regressions passed |

### Necessary changes made

- Added `limits.fieldArrayIndexLimit: 0` to the existing Multer configuration in
  `backend/src/app.ts`. The endpoint accepts zero text fields. Kept memory storage,
  one file, two parts, the 2 MiB limit, MIME filter, server-side byte signatures,
  role/CSRF checks, generated filenames and sanitized HTTP 400 errors unchanged.
  Current Multer and its installed TypeScript declarations support this limit.
- Added two focused regressions in `backend/test/marketplace.test.mjs`: missing
  boundary/truncated multipart and oversized array-index fields fail with the
  sanitized error; a client-aborted upload leaves no file/category change and the
  server remains usable. Both use fictional fixtures and local test sockets.
- Added root `verify` as an alias for the existing `verify:ci`, because the task's
  requested `npm run verify` command did not exist. Existing CI and its command
  remain intact, with no database migration added to local verification.
- Updated this report. No Tailwind/theme/CSS, frontend application, authentication,
  payment, Prisma schema or GitHub workflow implementation was changed.

The four themes remain configured as before; successful rendering/token tests do
not establish CSS compatibility while the Tailwind compilation test fails.
Router 7 is intentionally retained for the security reason recorded in the
preceding regression task below. Vite 7.3.7 now satisfies the existing React
plugin's peer range. The old Vite 8/plugin mismatch is absent from `npm ls`.
No deprecation warning was observed during these build attempts, but they stopped
before completion, so a warning-free production build is **not verified**.

### Executed verification

Node 24.11.0 / npm 11.13.0. Ignored local evidence is under
`tmp/final-compat-*.log`; no private environment/DB/email artifacts were published.

| Check | Actual result |
| --- | --- |
| Focused upload suite (`--test-name-pattern=S04`) | PASS: 4/4, including valid/rejected/oversized/unauthorized, malformed and aborted uploads |
| Frontend suite | 57 PASS, 1 FAIL out of 58; sole failure is Tailwind 4 invoked as the v3 PostCSS plugin |
| `npm run verify`, executed once after fixes | FAIL overall; both workspace type checks, Vite config types and backend compilation PASS; frontend build blocked by `spawn EPERM` loading Vite config |
| Separate Pages build, because aggregate stopped before it | FAIL / environment blocked by the same `spawn EPERM` |
| Backend full suite, run separately with redundant build hook skipped | PASS: 89/89 using mocked Stripe/email and temporary SQLite fixtures |
| `npm ls` for Router, Tailwind, Vite/plugin and Multer/types | PASS / exit 0; exact versions and Vite deduplication confirmed |
| Online `npm audit --json --offline=false --fetch-retries=0 --fetch-timeout=15000` | FAIL / registry advisory endpoint `ECONNREFUSED 127.0.0.1:9` |
| Complete consolidated run, clean npm install, visual acceptance, SQLite/MySQL integration suites after final fixes | NOT VERIFIED; aggregate did not reach its later test commands; no migrations run |

The published-version fixes for the previously named Multer/Vite/esbuild issues
are present in this installation, but the complete remaining vulnerability count
is **unknown** because the online audit failed. No new zero-vulnerability result
is claimed. The prior operator audit is not a substitute for auditing the final
tree. No repeated registry installation attempts were made after this failure.

### Exact remaining operator action

Run the following in normal PowerShell with permitted npm access and working
subprocess execution. It restores Tailwind 3 while preserving the existing four
themes and PostCSS configuration. npm must update the manifest and lockfile
together; do not edit lockfile integrity values or use audit-force/peer bypasses.

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
git status --short
npm install 'tailwindcss@3' --save-dev --workspace frontend --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Tailwind 3 installation failed; do not claim compatibility.' }
npm ls react-router-dom react-router tailwindcss vite '@vitejs/plugin-react' multer '@types/multer'
if ($LASTEXITCODE -ne 0) { throw 'Resolve package/peer errors before continuing.' }
git diff -- frontend/package.json package-lock.json
npm ci --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Clean installation failed.' }
npm run db:generate --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'SQLite client generation failed; do not run db push or migrations.' }
# Includes both production build modes, all general tests and SQLite integration.
npm run verify
if ($LASTEXITCODE -ne 0) { throw 'Verification failed; inspect the first failure.' }
npm audit --json --offline=false
# Inspect the returned report and command status. Registry failures are not zero.
npm audit --omit=dev --json --offline=false
git diff --check
```

Record the actual installed Tailwind 3 patch and valid final full/production audit
results here. Review any findings rather than upgrading unrelated majors. Verify
the theme/cart/hash routes and disabled private Pages routes in a permitted
browser. With those checks passing, the branch is a candidate for its first
hosted Actions run; hosted MySQL/clean-run evidence remains to be obtained.
Current blockers are the known CSS test failure, unverified builds and unavailable
audit. No migration, production activation, commit, push or deployment occurred.

## Task 5.2 regression repair — 2026-10-19

**Partial repair; not ready for a green first CI run.** Seven obsolete Router
server imports were repaired. Tailwind/Vite dependency corrections still require
the operator's network-enabled PowerShell. No manifest or lockfile was changed in
this regression-repair session, and no zero-vulnerability result is claimed.
All previously uncommitted work was preserved.

### Exact observed versions before / after this repair

| Package / resolution | Before | Actual after | Decision |
| --- | --- | --- | --- |
| react-router-dom / react-router | 7.18.4 / 7.18.4 | 7.18.4 / 7.18.4 | Retain security-patched v7; fix test imports |
| tailwindcss | 4.3.3 | 4.3.3 | Pending: resolve latest published 3.x using npm, then audit that actual tree |
| frontend's direct vite | 8.3.4 | 8.3.4 | Pending: align with patched 7.x, at least 7.3.7 |
| root vite, resolved by React plugin | 7.3.7 | 7.3.7 | Preserve; already satisfies installed plugin's peer range |
| @vitejs/plugin-react | 4.7.0 | 4.7.0 | Supports Vite 4/5/6/7, not 8; no plugin major upgrade needed with Vite 7 |
| multer | 1.4.5-lts.2 | 1.4.5-lts.2 | Unexpected unresolved security blocker: manifest, lockfile and installed tree all still use v1 |
| esbuild | 0.28.2 | 0.28.2 | Preserve; not affected by the previously named <=0.24.2 advisory |

The operator-reported zero audit result could not be reproduced in this managed
environment. `audit-before.json` is an existing historical report with 11 findings
(6 high, 5 moderate); it is not evidence of the final installed tree's audit status.
No existing operator artifact was overwritten or deleted.

### Why Router 7 is retained

The requested preference for v6 has a security exception: upstream
[GHSA-wrjc-x8rr-h8h6](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6)
lists affected React Router versions `>=6.0.0,<7.18.0`, with fixes `>=7.18.0`.
Returning to v6 would reintroduce a published open-redirect concern. A v6 patch
for another advisory alone does not resolve this one. Installed 7.18.4 is retained.

Changed `StaticRouter` imports from `react-router-dom/server.js` to the public
`react-router-dom` export in `auth`, `email-themes`, `navigation`, `pages`,
`storefront`, `themes` and `workflow` frontend test files. The new export was
verified against the actual installation. No assertions were removed and no
application/authentication/Stripe behavior changed.

### Tailwind / Vite compatibility

The existing PostCSS plugin, JavaScript Tailwind configuration, semantic theme
tokens and `@tailwind base/components/utilities` are v3 code. Restore Tailwind 3
through npm instead of performing a v4 CSS/theme migration. Preserve Classic,
Minimal, Marketplace and Dark configurations and tests. Do not install the v4
PostCSS adapter or replace directives as part of this focused repair.

The app declares no `esbuild` option in `vite.config.ts`. React plugin 4.7.0 emits
it from its config hook and resolves its own root Vite 7 while the frontend invokes
Vite 8. Its peer range excludes Vite 8. Align the frontend on Vite `^7.3.7`, the
patched 7.x floor for
[GHSA-rq7h-c2jc-7f22](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22),
rather than adding a new plugin major or suppressing warnings with a config
rewrite. This keeps a security-fixed Vite line compatible with Node 24 and the
installed React plugin. Actual warning removal awaits an executable build.

### Verification actually executed

| Check | Result |
| --- | --- |
| Baseline frontend suite before import repair | FAIL: obsolete server.js subpath is not exported |
| Frontend suite after import repair | 57 PASS / 1 FAIL out of 58; only Tailwind/PostCSS compilation remains failing |
| Focused frontend build | FAIL / environment blocked: Vite externalize-deps encounters `spawn EPERM` loading config |
| Final `npm run verify:ci`, once after the import edits | Workspace types, Vite config types and backend compilation PASS; frontend build FAIL / `spawn EPERM`; later suites/Pages build not reached |
| `npm ls react-router-dom react-router tailwindcss vite @vitejs/plugin-react multer` | Exit 0; confirms separate frontend Vite 8.3.4 and plugin Vite 7.3.7 resolutions |
| Online npm metadata and `npm audit --json --offline=false` | FAIL / registry `ECONNREFUSED 127.0.0.1:9` |
| Offline cached Router 6 / Tailwind 3 metadata | Unavailable; no cached response. No repeated online installs attempted |
| Backend full suites, SQLite/MySQL integrations, clean install and Pages build after dependency repair | NOT VERIFIED in this session; no dependency repair could be installed |

The successful frontend cases exercise authentication/payment helpers, SSR
rendering, theme views, navigation, Pages isolation and shared storefront behavior.
The CSS compilation failure means theme styling is not signed off. Browser
acceptance and builds remain required; passing tests do not prove visual parity.

### Exact operator commands (normal network-enabled PowerShell)

Run from the existing workspace, preserving its dirty tree. These commands are
pending work, not results. `tailwindcss@3` selects the latest published compatible
major instead of guessing a cached patch. Keep Router 7.18.4; do not install v6.
No force/legacy-peer workaround is needed.

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
git status --short
npm install 'tailwindcss@3' 'vite@^7.3.7' --save-dev --workspace frontend --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Dependency repair failed; inspect the diff before continuing.' }
npm ls react-router-dom react-router tailwindcss vite '@vitejs/plugin-react' multer
if ($LASTEXITCODE -ne 0) { throw 'Resolve dependency or peer errors first.' }
git diff -- frontend/package.json package-lock.json
npm test --workspace frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend regression remains.' }
npm run build --workspace frontend
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
npm run verify:ci
if ($LASTEXITCODE -ne 0) { throw 'Consolidated verification failed.' }
npm audit --json --offline=false
# Inspect returned JSON: registry errors are not a valid audit, even if offline
# output previously said zero. Findings also return a nonzero exit status.
npm audit --omit=dev --json --offline=false
git diff --check
```

The unchanged Multer v1 finding is a separate publishing blocker. Follow the
major-version compatibility review below to install `multer@^2.3.0` through npm,
set its minimum field-array limit, and validate uploads before the final audit.
Do not silently declare this tree remediated based on the operator's earlier audit.
Once all updates are complete, validate a clean `npm ci`, both frontend build modes
and the guarded sequential MySQL suites without migrations, and record exact
resolved versions/audit totals here. Only then assess first-CI readiness; do not
waive the existing audit gate to make CI green. No database, production, commit,
push or deployment action was performed.

## Task 5.2 — 2026-10-19 (blocked: registry access)

**No dependency remediation completed.** Root/workspace manifests and lockfile
are byte-for-byte unchanged from the start of Task 5.2, verified by SHA-256.
No security issue is claimed fixed. Earlier uncommitted changes remain intact.

The online full-tree and production-only audits were attempted again with
`--offline=false --fetch-retries=0 --fetch-timeout=15000`. Both failed at the npm
advisory endpoint with `ECONNREFUSED 127.0.0.1:9`. This managed PowerShell process
does not have the network access of an ordinary operator terminal. Do not treat
offline audit output or these failures as zero vulnerabilities. Additional direct
and transitive findings, their current severities and total counts are unknown.

### Confirmed version concerns and reachability

| Dependency / advisory | Scope | Before / current | Affected range | First relevant patch | Severity / application reachability |
| --- | --- | --- | --- | --- | --- |
| Multer / GHSA-535w-7cp7-47q4 | Direct production dependency | 1.4.5-lts.2 | <2.3.0 | 2.3.0 | High (7.5). Multipart parsing is used by the Admin category-image endpoint after role/CSRF checks. Existing zero text fields and file/size limits constrain this particular field attack; no production exploit reproduced and this is not a waiver for other Multer DoS issues. |
| Vite / GHSA-rq7h-c2jc-7f22 | Direct development dependency | 5.4.21 | <=6.4.3; 7.0.0–7.3.6; 8.0.0–8.1.5; 8.2.0–8.2.3; 8.3.0–8.3.2 | 6.4.4 (also 7.3.7, 8.1.6, 8.2.4, 8.3.3) | Moderate (6.3). Requires a matching imported/host file path, readable non-denied file and non-Windows dev server. Current local dev is loopback/Windows; not reproduced. Linux development remains relevant. Static Pages assets do not run Vite's server. |
| Vite > esbuild / GHSA-67mh-4wv8-2f99 | Transitive development dependency | 0.21.5 | <=0.24.2 | 0.25.0 | Moderate (5.3). Affects esbuild's standalone serve API. Application/Vite configuration uses Vite builds/server rather than esbuild serve directly; no reachable serve API identified. This does not make the locked version patched. |

Primary sources: [Multer advisory](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4),
[Vite advisory](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22),
[esbuild advisory](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).
The independent root esbuild 0.28.2 does not replace Vite's nested 0.21.5 copy.
The historical report below also records earlier Multer/Vite advisories; this
table deliberately does not claim to enumerate the whole dependency tree.

### Major-version compatibility review (before attempting installation)

No compatible 1.x Multer or 5.x Vite patch fixes the named advisories. The smallest
proposed major transitions are Multer `^2.3.0` and Vite `^6.4.4`, subject to the
complete online audit. These are candidate fixes, not installed/resolved versions.

- Multer 2 retains `memoryStorage()`, `single('image')`, file filters, limits and
  callback middleware used here. The locked `@types/multer` is already 2.3.0.
  Configure `limits.fieldArrayIndexLimit: 0` with the upgrade, because this upload
  accepts no text fields; version 1 does not implement that protection. Recheck
  valid/rejected/oversized/unauthorized, malformed and aborted multipart uploads,
  cleanup and server liveness before accepting the major transition.
- Vite 6 is the closest patched major, avoiding an unnecessary Vite 7/8 migration.
  The locked React plugin 4.7.0 declares Vite 6 support; no plugin/React major
  change is indicated. Review Vite 6's JSON/CSS/Sass and resolve/build changes;
  this project uses React/TypeScript, Tailwind/PostCSS and no configured Sass or
  custom esbuild plugins. Preserve base/hash routes, curated Pages assets,
  environment isolation and proxy/loopback settings. Verify both build modes and
  Vite config types. Resolve esbuild through Vite's own dependency range; do not
  force an incompatible transitive override or downgrade root esbuild.
- Keep Node 24, Prisma/client 5.22.0, Stripe 23.0.0 and Nodemailer 10.1.7 unchanged
  unless the actual audit requires a separate justified update. Client generation
  and integration tests are permitted; database migrations are not.

Compatibility sources: [Multer 2.3 API](https://github.com/expressjs/multer/tree/v2.3.0),
[Vite 5-to-6 migration](https://v6.vite.dev/guide/migration),
[Vite 6.4.4 package](https://github.com/vitejs/vite/blob/v6.4.4/packages/vite/package.json).

### Installation attempts and before/after result

After recording the major-version implications above, copied the three manifests
and lockfile into ignored `tmp/security-5.2-candidate` and attempted each change
with npm `--package-lock-only --ignore-scripts --no-audit --no-fund --offline=false
--fetch-retries=0 --fetch-timeout=15000`. Multer and Vite resolution both failed
with registry `ECONNREFUSED`. No speculative versions, integrity values or partial
dependency changes were copied back. The root working installation was preserved.

| Package | Before | After this task | Resolved? |
| --- | --- | --- | --- |
| Multer | 1.4.5-lts.2 | 1.4.5-lts.2 | No |
| Vite | 5.4.21 | 5.4.21 | No |
| Vite's nested esbuild | 0.21.5 | 0.21.5 | No |
| Root esbuild | 0.28.2 | 0.28.2 | Not affected by the named esbuild advisory |
| Prisma/client, Stripe, Nodemailer | 5.22.0, 23.0.0, 10.1.7 | Unchanged | No general clean-security claim |

Repeated both full/production online audits after verification: both again failed
with `ECONNREFUSED`. Before and after totals are **unknown**, not zero; no valid
audit delta can be computed. Other vulnerabilities may exist. Logs are local under
ignored `tmp/security-5.2-*.log`; never publish private environment or DB files.

### Verification on the unchanged dependency tree

Node 24.11.0, npm 11.13.0. These results do not validate the proposed upgrades.

| Check actually executed | Result |
| --- | --- |
| Focused `S04` upload tests in `backend/test/marketplace.test.mjs` | PASS: 2/2, valid/rejected/MIME/size/authorization checks |
| `npm run typecheck` | PASS: backend and frontend |
| `npm test` | PASS: backend 87/87, frontend 58/58; backend built by its existing pretest hook |
| `npm run build` | Backend PASS; frontend FAIL / environment blocked by Vite/esbuild `spawn EPERM` |
| `npm run build:pages --workspace frontend` | FAIL / environment blocked by the same `spawn EPERM` |
| SQLite database/auth/Stripe suites, sequential with redundant build hooks skipped | PASS: 10/10 + 11/11 + 9/9 |
| MySQL database/auth/Stripe suites, sequential with redundant build hooks skipped | PASS: 10/10 + 11/11 + 9/9 |
| Online audits before/after; candidate lockfile resolution | FAIL / environment blocked by npm registry connection refusal |
| Clean `npm ci` on patched dependencies, patched-parser malformed/aborted requests, upgraded Vite builds/browser acceptance | NOT VERIFIED: replacement dependencies could not be resolved/installed |

MySQL suites preflighted the guarded MySQL 8.0 target
`localhost:3306/loja1_test` as `loja1_test_app`. They verified existing migration
history/checksums and exercised fictional fixtures; no migrations were applied.
SQLite integration used temporary fixtures. Payments and SMTP used injected mocks.
The repeated identical backend commands in the task were consolidated into the
backend run inside `npm test`; the distinct database/auth/Stripe integrations each
ran separately. No repeated unchanged backend-only suite was needed.

### Exact operator steps in a normal PowerShell terminal

Use a terminal with permitted npm registry access and working subprocess creation.
Do not bypass an organization's proxy/firewall or paste credentials into commands.
The commands below are a recovery procedure, **not evidence of executed fixes**.
Stop local app/email-worker processes before integration tests. Keep the existing
ignored MySQL test configuration private and the already migrated test DB intact.

First retain valid full/production audit evidence. This helper accepts exit 1
only when npm returned a real vulnerability report; registry errors are rejected.

```powershell
Set-Location -LiteralPath 'C:\Projects\Projeto 50k'
git status --short
node --version
npm --version
# Require Node 24.7+ within the 24.x line.
node -e "const [m,n]=process.versions.node.split('.').map(Number); if(m!==24||n<7)process.exit(1)"
if ($LASTEXITCODE -ne 0) { throw 'Use Node.js 24.7 or newer within 24.x.' }

$auditFolder = Join-Path (Get-Location) 'tmp/security-5.2-evidence'
New-Item -ItemType Directory -Path $auditFolder -Force | Out-Null
function Save-DependencyAudit {
  param([string]$Name, [switch]$Production)
  $auditArgs = @('audit', '--json', '--offline=false', '--fetch-retries=0', '--fetch-timeout=30000')
  if ($Production) { $auditArgs += '--omit=dev' }
  $auditLines = & npm @auditArgs
  $auditExit = $LASTEXITCODE
  $auditText = $auditLines -join [Environment]::NewLine
  [IO.File]::WriteAllText((Join-Path $auditFolder ($Name + '.json')), $auditText, [Text.UTF8Encoding]::new($false))
  $report = $auditText | ConvertFrom-Json
  if ($auditExit -notin @(0, 1) -or $report.error -or -not $report.metadata.vulnerabilities) {
    throw "No valid online audit for $Name; restore permitted registry access before continuing."
  }
  return $report.metadata.vulnerabilities
}
$beforeAll = Save-DependencyAudit 'before-all'
$beforeProduction = Save-DependencyAudit 'before-production' -Production
$beforeAll
$beforeProduction
```

Read all findings, including packages beyond the three named advisories. Review
the documented major transitions before using these candidate updates. If a newer
advisory requires a different patch, choose its smallest compatible fixed version
after reviewing it. Let npm generate both manifests and lockfile; do not hand-edit
lock integrity data, add broad overrides or use `npm audit fix --force`.

```powershell
npm install 'multer@^2.3.0' --workspace backend --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Multer installation failed; inspect the diff before continuing.' }
npm install 'vite@^6.4.4' --save-dev --workspace frontend --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Vite installation failed; inspect the diff before continuing.' }
git diff -- backend/package.json frontend/package.json package-lock.json
npm ls multer vite esbuild '@vitejs/plugin-react' '@prisma/client' prisma stripe nodemailer
if ($LASTEXITCODE -ne 0) { throw 'Resolve missing/invalid/peer dependencies before continuing.' }
```

With Multer 2.3+ installed, update only the existing upload limits in
`backend/src/app.ts` to include `fieldArrayIndexLimit: 0` (keep all existing limits,
filter, authorization and file-signature checks). Add focused malformed/truncated
and aborted-upload regressions with server-liveness/cleanup assertions against the
new parser; these tests and that compatibility guard have **not** been added here.
Then perform clean installation and verification. Client generation below is not
a schema migration; do not run `db:push`, `mysql:migrate` or `mysql:validate`.

```powershell
npm ci --offline=false --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Clean install failed.' }
npm run db:generate --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'SQLite client generation failed.' }
npm run mysql:generate --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'MySQL client generation failed; do not change target guards.' }
npm run build --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'Backend compilation failed.' }
node --import ./backend/test/source-loader.mjs --test --test-isolation=none '--test-name-pattern=S04|multipart|upload' backend/test/marketplace.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Focused upload checks failed.' }
# Includes workspace + Vite config types, both production build modes, general
# backend/frontend tests, and sequential SQLite database/auth/Stripe integration.
npm run verify:ci
if ($LASTEXITCODE -ne 0) { throw 'Consolidated verification failed; do not claim a successful build.' }
# Guarded existing MySQL DB only; run sequentially, never migrate for this task.
npm --ignore-scripts run test:mysql --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'MySQL database suite failed.' }
npm --ignore-scripts run test:auth:mysql --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'MySQL auth suite failed.' }
npm --ignore-scripts run test:stripe:mysql --workspace backend
if ($LASTEXITCODE -ne 0) { throw 'MySQL Stripe suite failed.' }
$afterAll = Save-DependencyAudit 'after-all'
$afterProduction = Save-DependencyAudit 'after-production' -Production
'Before full tree:'
$beforeAll
'After full tree:'
$afterAll
'Before production:'
$beforeProduction
'After production:'
$afterProduction
git diff --check
```

Inspect full saved JSON reports for advisory IDs, affected/resolved package paths,
fix recommendations and unexpected manifest/lockfile changes. Apply additional
confirmed patch/minor fixes individually as required, then rerun affected checks
and audits. A lower total alone does not establish that all relevant issues closed.
Run permitted browser checks on the app and Pages demo, especially assets/hash
refresh, theme/cart behavior and blocked demo checkout/admin routes. Keep all
runtime production guards intact; test builds do not authorize deployment.

### Publishing and GitHub rules recommendation

Task 5.2 remains incomplete. Do not describe the governance changes as dependency
remediated or release-ready. Resume in the permitted terminal, resolve high/critical
findings and explicitly triage remaining severities, validate clean install and
both builds, then update this report with actual before/after evidence. Preserve
the npm audit CI gate; do not add exceptions merely to pass CI. With explicit
commit/push authorization, publish a reviewable feature branch/PR, inspect the first
hosted CI results and only then require the reported check names in `main` rules.
A push/merge to `main` invokes the existing Pages deployment, so account for that
separately before authorizing publication. No GitHub settings, paid services,
commit, push, tag, deployment or database migration was performed in Task 5.2.

## Task 5.1 update — 2026-10-19

**Status: unresolved. No dependency upgrades were made.** The older review below
is historical; its audit counts are not a current clean result.

Both current online commands were retried with `--offline=false`,
`--fetch-retries=0` and a bounded timeout:

- `npm audit --json`: **FAIL / environment blocked**, advisory endpoint returned
  `ECONNREFUSED 127.0.0.1:9`.
- `npm audit --omit=dev --json`: **FAIL / environment blocked**, same registry error.

The current vulnerability total and complete transitive findings remain unknown.
An isolated `npm ci --ignore-scripts --offline --no-audit --no-fund` using copied
workspace manifests/lockfile under ignored `tmp/governance-ci-install` failed with
`ENOTCACHED` (Zod tarball unavailable), plus Windows cleanup `EPERM` warnings.
The working root dependency installation was preserved. This was not a successful
clean install or verification of native install hooks.

Locked versions were inspected without changing the lockfile:

| Locked dependency path | Version | Attention required |
| --- | --- | --- |
| backend > multer | 1.4.5-lts.2 | Production upload DoS; current upstream field-index advisory affects versions below 2.3.0. Requires a separately reviewed major upgrade and malformed/aborted upload checks. |
| frontend > vite | 5.4.21 | Development-server file disclosure; 5.x is affected by the cited advisories and needs a planned compatible maintained-version upgrade. |
| frontend > vite > esbuild | 0.21.5 | Development-server cross-origin response disclosure below 0.25.0; update the Vite parent. The separate root esbuild 0.28.2 does not replace Vite's nested copy. |

Upstream evidence rechecked for this task:
[Multer field-index DoS](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4),
[Vite file disclosure](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22),
[esbuild cross-origin disclosure](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).
These are confirmed dependency-version concerns, not a complete audit or a claim
that a production exploit was reproduced.

The new `Security / npm audit` CI check gates high/critical findings in both
production and full dependency trees; registry failures also fail. It is expected
to require remediation on this lockfile, not an exception or `continue-on-error`.
Moderate/low advisories still require documented triage. Weekly Dependabot PRs
cover npm workspaces and Actions with automatic major version updates excluded;
major-only security fixes require manual priority. No `npm audit fix --force`,
override, automatic merge, billing change or remote setting change was performed.

## Historical review — 2026-10-17

Status: incomplete; dependency installation and live npm audits are blocked by this environment. No vulnerabilities have been fixed in this session. Existing uncommitted work was preserved, and package manifests and the lockfile were left unchanged.

## Audit evidence

- Ran `npm audit --json` and `npm audit --omit=dev --json`. Both reported zero, but `npm config get offline` returned `true`. These are **not valid clean security results**.
- Retried both with `--offline=false`. Both failed with `ECONNREFUSED 127.0.0.1:9` while contacting the registry advisory endpoint.
- The reported original 11 vulnerabilities (5 moderate, 6 high) could not be independently reproduced or fully enumerated. The remaining count is unknown; do not interpret the offline results as remediation.
- `npm install multer@^2.3.0 --workspace backend --offline --ignore-scripts --no-audit` failed with `ENOTCACHED`.
- The online installation retry with `--offline=false --fetch-retries=0` failed with the same refused connection. No dependency changes resulted.

## Confirmed vulnerable dependency paths

These findings compare the installed/locked versions with upstream advisories; this table is not a substitute for the unavailable full audit.

| Dependency path | Scope | Installed | Finding / next action |
| --- | --- | --- | --- |
| backend → multer | Direct production | 1.4.5-lts.2 | Multiple upload denial-of-service advisories. Upgrade to a stable 2.x release at least 2.3.0, then re-audit. |
| frontend → vite | Direct development | 5.4.21 | Development-server file disclosure advisories. The cited fixes are unavailable on 5.x; evaluate the smallest compatible maintained upgrade after obtaining the full audit. |
| frontend → vite → esbuild | Transitive development | 0.21.5 | Cross-origin development-server response disclosure; patched in esbuild 0.25.0. Prefer updating its Vite parent over forcing an incompatible transitive override. |

References:

- [Multer memory leak affecting versions below 2.0.0](https://github.com/expressjs/multer/security/advisories/GHSA-44fp-w29j-9vj5).
- [Multer malformed-request denial of service below 2.1.1](https://github.com/expressjs/multer/security/advisories/GHSA-5528-5vmv-3xc2).
- [Multer field-index denial of service below 2.3.0](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4).
- [Vite Windows path disclosure; patched branches start at 6.4.3 / 7.3.5 / 8.0.16](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff).
- [Subsequent Vite disclosure; fixes include 6.4.4 / 7.3.7](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22).
- [esbuild cross-origin disclosure below 0.25.0](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99).

## Multer compatibility review

`backend/src/app.ts` uses `memoryStorage()`, `single('image')`, a MIME filter, a 2 MiB limit, one file, zero text fields, and callback-based error handling mapped to HTTP 400. It validates file signatures before writing a random server filename. The [Multer 2.3.0 API](https://github.com/expressjs/multer/tree/v2.3.0) retains those APIs; no structural migration was identified. The installed `@types/multer` is already 2.3.0 and exposes `limits.fieldArrayIndexLimit`. When upgrading, set that limit to zero because this endpoint accepts no text fields, as recommended by the field-index advisory. This review does not establish runtime compatibility with an uninstalled version.

## Verification on the existing dependency tree

- **PASS** — `npm run typecheck`: backend and frontend.
- **PASS** — backend build via `npm run build`.
- **FAIL / environment blocked** — frontend build via `npm run build`: `spawn EPERM` launching Vite's esbuild service.
- **PASS** — 64 focused regressions, zero failures:

```powershell
node --import ./backend/test/source-loader.mjs --test --test-isolation=none backend/test/marketplace.test.mjs backend/test/security.test.mjs frontend/test/workflow.test.mjs frontend/test/security.test.mjs
```

Coverage includes valid/rejected/oversized/unauthorized uploads, authentication and session rotation, persistent guest access, CSRF, ownership, checkout replay, payment gating and delivery. Tests use isolated fictional SQLite data. These results apply to Multer 1.4.5-lts.2, not the proposed upgrade. A fresh `npm ci` was not attempted because the replacement packages are unavailable and it would remove the working dependency installation.

## Resume checkpoint

1. Restore permitted npm registry access and rerun both audits with `--offline=false --json`; retain the complete direct/transitive findings.
2. Run `npm install multer@^2.3.0 --workspace backend --offline=false`, allowing npm to update the manifest and lockfile together, and add the field-index limit described above.
3. Apply audited patch/minor updates within existing ranges. Evaluate Vite separately because 5.x lacks the cited security fixes; verify plugin peer compatibility and migration requirements. Do not use `npm audit fix --force` or guess lockfile integrity values.
4. Rerun clean installation, both audits, focused regressions, TypeScript checks and both builds with working subprocess permissions. Add focused malformed/aborted multipart regressions against the upgraded parser.
5. Report the actual residual audit findings, distinguishing production and development dependencies. Do not claim any package is unaffected solely because these regressions pass.

No commit, push, deployment, remote migration or production-data modification was performed.
