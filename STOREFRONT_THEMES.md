# Storefront themes

Four themes use the same products, routes, cart store, add-to-cart feedback and checkout operations. No dependencies were added.

| Theme | Storefront | Category navigation | Cart |
| --- | --- | --- | --- |
| Classic | Original header, hero, cards, detail and cart pages; original palette and styles | Original catalogue and detail links | Original full page and mobile shortcut |
| Minimal | Centered wordmark, editorial introduction, large two-column product images, serif headings | Collection tabs, search and price ordering; compact mobile menu | Slide-out side drawer and spacious full page |
| Marketplace | Search-first header, compact introduction, sidebar and dense product grid with full-width add actions | Sidebar on desktop, scrolling category rail on mobile; search and price ordering | Header cart opens a desktop panel / mobile bottom sheet; full cart with summary |
| Dark | Monogram navigation, oversized typography, category tiles, featured split card and secondary cards | Numbered category tiles, search and price ordering; mobile tile grid | Floating total opens an animated panel; full cart with separate item panels |

New components use `sf-*` classes; each palette is scoped to its `data-theme` value. Classic keeps the original storefront component markup and original CSS tokens (renamed from `modern-minimal`). The existing admin appearance panel now offers four choices with different visual summaries. Theme IDs are validated on both sides of the existing settings API.

## Preview locally without a backend

The safest way to compare the designs is the fictional Pages build. From the project root:

```powershell
npm run build:pages --workspace frontend
npm run preview:pages --workspace frontend
```

Open one of these URLs after a successful build:

- Classic: <http://127.0.0.1:4173/loja-1/?theme=classic#/>
- Minimal: <http://127.0.0.1:4173/loja-1/?theme=minimal#/>
- Marketplace: <http://127.0.0.1:4173/loja-1/?theme=marketplace#/>
- Dark: <http://127.0.0.1:4173/loja-1/?theme=dark#/>

The local preview toolbar switches themes without reloading or clearing the cart. It survives client-side navigation and keeps the preview ID in the URL for refresh. Choose **Terminar prévia** to return to the configured theme. Preview selection is kept in tab memory and the URL, never in cart/customer storage or the backend. Query previews are accepted only on `localhost`, `127.0.0.1` and `[::1]`; the public GitHub Pages host ignores them. Put `?theme=…` before the `#` in Pages URLs.

The ordinary local application also supports `http://127.0.0.1:5173/?theme=minimal` (and the other three IDs) after starting the existing backend/frontend. The query selects a local presentation only; it cannot enable demo/admin/payment capabilities.

## Change the shared local storefront

Start the existing full application with `npm run dev`. Use ADMIN, open `/admin`, then **Storefront Theme / Aparência / Temas**:

1. Select **Pré-visualizar** on a theme. Follow catalogue, category and cart routes to inspect it.
2. Select **Cancelar pré-visualização** to return to the saved theme, or **Aplicar tema** to activate it for all visitors of this backend.
3. Check another GUEST session. New visits read the saved setting; open sessions refresh on focus and every 30 seconds. Leaving ADMIN cancels its unsaved preview.

End a query-based local preview before checking a shared setting; local query previews take precedence. The existing development ADMIN identity remains a local mock account, with the existing server-side role guard.

`GET /api/appearance` reads the setting and `PUT /api/admin/appearance` accepts only `classic`, `minimal`, `marketplace` or `dark` from an authorized ADMIN. Classic is the fallback for new or unknown settings. For databases from the previous version, reads map `modern-minimal` to Classic, `dark-premium` to Dark and `vibrant-commerce` to Marketplace without rewriting the stored value. Applying a theme updates only the existing `SiteSetting` theme entry. No schema migration or database reset is required.

The static public demo continues to use Classic by default, hash routing and the `/loja-1/` asset prefix. It has no backend requests, administration, checkout, payments, orders or contact delivery. A shared choice in the local database cannot affect a static GitHub Pages deployment. No public theme activation mechanism was added.

## Review checklist

At desktop widths (1440px) and mobile widths (390px and 320px), compare each theme:

- Open/close navigation with keyboard and Escape; inspect focus and ensure no horizontal page overflow.
- Browse categories and details; use category filters, search, price ordering and empty results in each new theme. Follow catalogue section links in the Pages hash router and refresh a detail URL.
- Add two categories, repeat an addition, switch themes during feedback, open/close the quick cart, remove an item, and open the full cart. Verify the same selection and total throughout.
- Check dialog focus containment, Escape, close-button focus restoration, outside clicks and scrolling. Check the Minimal drawer, Marketplace panel/sheet and Dark floating panel.
- Emulate reduced motion; ensure cart updates still complete and animations stop. Check sticky headers, safe-area clearance and floating cart/feedback at narrow widths.
- Confirm every demo checkout remains disabled and direct admin/order/checkout/delivery visits remain unavailable in every theme. Confirm no backend requests and no cart/customer storage access in the Pages build.
- In the full local application, apply all four themes as ADMIN, inspect another visitor, reload/restart the backend, and confirm GUEST updates are denied and products/orders/contacts are preserved.

## Verification — 2026-10-17

| Check | Result |
| --- | --- |
| Backend tests, including compiled backend build | **PASS — 40 tests** |
| Frontend tests, final targeted rerun | **PASS — 47 tests** |
| Both TypeScript projects (`npm run typecheck`) | **PASS** |
| In-process Tailwind/PostCSS compilation and all four palette contrast checks | **PASS**, included in frontend tests |
| Classic stylesheet compared with the original Git version | **PASS**, identical apart from the theme selector name |
| `git diff --check` | **PASS** |
| Local production frontend build | **BLOCKED** before compilation: Vite/esbuild `spawn EPERM` |
| Pages production build | **BLOCKED** before compilation: Vite/esbuild `spawn EPERM` |
| Vite development preview | **BLOCKED** by the same environment restriction |
| Desktop/mobile browser rendering and interaction checks | **NOT VERIFIED**: Chrome headless fails with Windows IPC/crashpad `Access is denied` |

The consolidated test run passed all 40 backend tests. A prior demo assertion rejected the new, permitted Marketplace header search form; it now checks that blocked route content contains no forms, while continuing to reject purchase/contact controls and privileged navigation throughout the page. The subsequent complete frontend rerun passed all 47 tests. No backend source changed after its passing run.

Coverage includes four distinct theme structures, filtering/search/ordering, empty/error states, cart membership and totals across presentations, preview host/ID validation, URL updates without reload or storage, server-side ADMIN restrictions, persistence across fresh backend instances, legacy settings without rewriting records, and demo route safeguards in all four themes. Responsive CSS and reduced-motion rules are checked structurally; these checks do not establish visual/mobile acceptance, actual dialog keyboard behavior or browser animation quality.

No current production artifact, screenshot or browser acceptance pass is claimed. Run the preview commands in a normal local PowerShell session that permits esbuild and Chrome, then complete the checklist above. Existing generated artifacts, if present, must not be treated as builds of this change. Nothing was committed, pushed, deployed or changed in remote infrastructure. Tests used isolated fictional data rather than the project database.
