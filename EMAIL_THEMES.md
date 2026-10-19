# Email themes

The email renderer now supports Classic, Minimal, Marketplace and Dark. Actual local deliveries, fictional admin/CLI previews and stored-email previews use the same renderer. Theme selection remains in the existing `SiteSetting` configuration, with the same ADMIN-only update endpoint. No dependencies, schema migrations or external email provider were added.

| Theme | Email presentation |
| --- | --- |
| Classic | Original HTML, text and subjects preserved byte for byte for fixed confirmation, delivery, pending and failed fixtures |
| Minimal | Cream background, centered serif wordmark, spacious editorial heading, separate white content area and outlined CTA |
| Marketplace | Navy brand header, blue subtitle strip, inset status/intro panel, compact purchase content and solid blue CTA |
| Dark | Charcoal surfaces, table-based S/M monogram, large headings, lime accents, contact panels and a high-contrast CTA |

Templates use inline CSS, email-safe font fallbacks, fluid tables, explicit background colors and the existing 600px Outlook conditional wrapper. No external images/fonts/stylesheets, JavaScript, layout Grid/Flexbox or animations are needed. CSS for the storefront never enters an email.

## Supported messages

- Purchase confirmation after verified payment.
- Supplier-contact delivery, including the purchase summary and only purchased categories.
- Payment-pending confirmation.
- Failed/cancelled payment confirmation, using the existing confirmation renderer.

All themes retain the same subject, plain text, order metadata, quantities, totals, contact fields, privacy notices and validated links. The shared content renderer escapes dynamic values. Theme styling changes only renderer-created style attributes, never dynamic text or URLs. HTTPS-only links without credentials remain required.

## Preview in the administration area

Start the existing local application. Use ADMIN and open `/admin`. Below **Aparência / Temas**, the email preview shows the active storefront theme and lets you select the message type and HTML/plain text.

Selecting **Pré-visualizar** on a storefront theme updates the sample email without applying that theme. **Cancelar pré-visualização** returns to the saved theme. Loopback-only `?theme=...` storefront previews also work. Applying a theme continues to use the existing ADMIN-only settings infrastructure.

`GET /api/admin/email-preview?type=...` defaults to the saved theme. ADMIN may add `theme=classic|minimal|marketplace|dark` for a read-only override. Invalid IDs, arrays and extra parameters are rejected. Samples use reserved fictional domains; the endpoint reads settings only and never loads real orders/contacts or invokes a provider.

The ADMIN outbox follows the selected storefront preview theme. An authorized order's HTML preview also follows the saved theme; ADMIN can preview another theme, while GUEST cannot override it. Changing themes refreshes an open order-email preview. Paid-order, delivery-status and ownership guards remain in place. HTML remains in an opaque iframe with scripts, remote resources and forms blocked by the existing sandbox/CSP and no top-level navigation permissions.

## Preview files without sending

From the project root:

```powershell
# All four themes, using fictional fixtures without any database access:
npm run preview:emails --workspace backend -- --theme all

# One explicit theme, also fixture-only:
npm run preview:emails --workspace backend -- --theme minimal

# Default to the active theme in the existing local settings:
npm run preview:emails --workspace backend
```

The script prints an `index.html` path in a new temporary directory, linking each HTML preview and its plain-text counterpart. Explicit themes are `classic`, `minimal`, `marketplace`, `dark` or `all`; they never change the live setting. The default requires the existing development configuration and reads only the appearance setting through the existing repository. Like other appearance reads, that repository can initialize its missing settings table additively. It does not read customer/order/contact records.

## Stored deliveries and history

New deliveries capture their rendered HTML plus a presentation document inside the existing versioned body envelope. The presentation document contains the already escaped fields from that delivery, so future previews do not query contacts that may have been edited since delivery. Original sent HTML/text and idempotent delivery behavior are preserved. No extra delivery event occurs.

Historical HTML produced by the previous Classic renderer is recognized by its exact structural markers and re-presented without changing stored records or field values. Historical plain text stays plain text. Unrecognized legacy HTML retains its original appearance rather than guessing its structure. This is the only historical-theme limitation.

The fictional GitHub Pages build still has no administration, checkout, delivery or outbox functionality. Its API allowlist rejects the new preview endpoint and all theme variants without making network requests. No preview sends an email.

## Verification

Consolidated results on 2026-10-17:

| Check | Result |
| --- | --- |
| `npm test` | **PASS — 112 tests: 63 backend, 49 frontend** |
| Backend TypeScript build, run by the test command | **PASS** |
| `npm run typecheck` | **PASS — both projects** |
| Four themes × four preview types | **PASS — 16 combinations**, including content, links and saved/preview HTML consistency |
| Original Classic confirmation/delivery/pending/failed fixtures | **PASS — exact SHA-256 snapshots of HTML, text and subjects captured before changes** |
| Dynamic escaping, unsafe URLs, paid-state gating, ownership and ADMIN-only overrides | **PASS** |
| Email table/inline markup, Outlook wrapper, safe fonts and contrast | **PASS — structural and numeric tests** |
| Public Pages preview/outbox restrictions | **PASS — rejected without network calls** |
| Preview CLI `--theme all` using the compiled backend | **PASS — 16 HTML previews, 16 text alternatives and an index generated** |
| Default CLI active-theme lookup | **PASS — isolated Dark settings database with no customer/order/contact tables; settings and fixture marker unchanged** |
| `git diff --check` | **PASS** |
| Frontend production and Pages builds | **BLOCKED — Vite/esbuild `spawn EPERM` before compilation** |
| Browser and actual Gmail/Outlook/mobile mail-client rendering | **NOT VERIFIED** |

No production frontend artifact or real mail-client acceptance is claimed. The existing restricted environment prevents the Vite build; no repeated browser-launch attempt was made after the earlier Windows IPC/crashpad denial in this session. Review the generated files at narrow and desktop widths and perform mail-client acceptance separately. Tests and CLI checks used fictional, isolated data, and no real email was sent. No commit, push or deployment was performed.

## Files changed

- `backend/src/email-designs.ts`: separate email-compatible layouts and scoped inline styling.
- `backend/src/email-templates.ts`: theme-aware shared renderer; original Classic layout retained.
- `backend/src/email-content.ts`: presentation metadata and read-only re-rendering of stored messages.
- `backend/src/email-preview.ts`: shared fictional fixtures and message types.
- `backend/src/app.ts`: active-theme delivery, protected preview endpoint, themed authorized outbox/order previews.
- `backend/scripts/preview-emails.mjs`: active, explicit and all-theme CLI previews.
- `frontend/src/EmailThemePreview.tsx`: admin message selector and HTML/text preview following storefront selection.
- `frontend/src/App.tsx`: admin preview integration.
- `frontend/src/MarketplacePages.tsx`: outbox/order preview refresh when themes change.
- `backend/test/email-themes.test.mjs`, `backend/test/marketplace.test.mjs`, `frontend/test/email-themes.test.mjs`: rendering, integration, security and demo regressions.
- `README.md`, `EMAIL_THEMES.md`: preview instructions, implementation details and verification.
