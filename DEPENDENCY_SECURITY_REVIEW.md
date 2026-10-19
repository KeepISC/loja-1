# Dependency security review — 2026-10-17

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
