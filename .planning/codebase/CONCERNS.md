---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
<!-- refreshed: 2026-10-22 -->

# Codebase Concerns

**Analysis Date:** 2026-10-22

## Tech Debt

**Vendored WebSocket client:**
- Issue: `src/lib/iobroker.socket.io.js` is a hand-vendored copy of the ioBroker WebSockets client v3.0.4, marked `// @ts-nocheck`, not tracked as an npm dependency.
- Files: `src/lib/iobroker.socket.io.js` (413 lines)
- Impact: no automated upgrade path; upstream protocol fixes must be re-vendored by hand, and the file is invisible to `npm audit` and to type checking.
- Fix approach: pin it as a dependency (or an `overrides`/subtree note) and record the upstream version + a re-vendor procedure in a comment or `docs/`.

**Type-suppression clusters:**
- Issue: 15 `@ts-ignore` / `@ts-expect-error` / `eslint-disable` sites, concentrated rather than incidental.
- Files: `src/lib/tools.svelte.js` (8), `src/lib/localStorage.js` (4), `src/lib/ioBrokerConnect.svelte.js:229`, `src/lib/socket-url.test.ts:6`
- Impact: the untyped legacy `.js` helpers (`tools`, `localStorage`) are where a wrong shape reaches the UI without a compile error.
- Fix approach: port `tools.svelte.js` / `localStorage.js` to `.svelte.ts` with real types; each ignore site is a small, independent fix.

**Formula/transform evaluation via `new Function`:**
- Issue: user-authored expressions are compiled with `new Function` at runtime.
- Files: `src/lib/config/transform-ops.ts:10-11`, `src/lib/config/virtual-ops.ts:118-127`
- Impact: expressions run in page context; a malformed or hostile formula is a code-execution surface for anyone who can write the ioBroker states. The virtual form is wrapped in `try/catch` and `"use strict"`, which bounds crashes but not capability.
- Fix approach: keep the eval but treat document authorship as trusted input (ioBroker permissions), document the trust boundary, and/or evaluate against a sandboxed scope with a whitelist of globals.

**Committed build output (`www/`):**
- Issue: the built SPA is committed (11 tracked files) alongside `src/`.
- Files: `www/**`, `scripts/deploy-www.mjs`
- Impact: `www/` can silently lag `src/` — the shipped UI then differs from the reviewed source, and diffs of generated assets bloat reviews.
- Fix approach: either build in CI/prepack and stop tracking `www/`, or add a check that `www/` matches a fresh `npm run build`.

## Known Bugs

No open bug list is tracked in-repo. Session-level findings live in `docs/progress/handoff-*.md`; the Vitest suite (33 files) is the current regression net.

## Security Considerations

**Trust boundary on document content:**
- Risk: `pageList`/`deviceList`/`templateList`/`formulaList` are free-form JSON in ioBroker states; they carry expressions (`new Function`) and icon URLs, and are rendered without a sanitizing layer.
- Files: `src/lib/config/doc-parse.ts`, `transform-ops.ts`, `virtual-ops.ts`, `src/lib/utils/icon-url.ts`
- Current mitigation: shape-validating parsers per document; icon URL resolution centralized in `icon-url.ts`.
- Recommendations: state explicitly in `docs/` that document authorship is privileged; keep `icon-url.ts` the only place a URL reaches an `<img src>`.

**No app-level authentication:**
- Risk: the SPA authenticates to the broker socket with a namespace name only.
- Files: `src/lib/ioBrokerConnect.svelte.js`
- Current mitigation: access is governed by the ioBroker `web` adapter / broker session; the app is served from the broker origin.
- Recommendations: none needed for the intended deployment, but any future cross-origin hosting would expose the socket.

**Deploy script holds broker credentials:**
- Risk: `scripts/deploy-www.mjs` uploads to the broker's file namespace over the MCP endpoint.
- Files: `scripts/deploy-www.mjs` (151 lines)
- Current mitigation: endpoint comes from `IOBROKER_MCP` env var (defaults to localhost); nothing is hardcoded.
- Recommendations: keep it env-only; never bake a token into the script or the repo.

## Performance Bottlenecks

**Full object/state hydration on connect:**
- Problem: the app requests every object and subscribes to all state changes.
- Files: `src/lib/ioBrokerConnect.svelte.js` (`getAllObjects`, `subscribe *`, `subscribeObjects *`), `src/lib/StateClass.svelte.js`
- Cause: the design keeps the whole broker model live in the browser so the display and pickers can be reactive without per-widget queries.
- Improvement path: scope subscriptions to used states plus the discovery tree on demand; the used-state set already exists (`getUsedStateIds`).

**History fetch per readable store:**
- Problem: chart series are fetched from `getHistory` and then appended to from live updates.
- Files: `src/lib/stores/history.svelte.ts`, `src/lib/components/display/TileChart.svelte`
- Cause: each tile with history owns its own fetch/cache cycle.
- Improvement path: deduplicate by state id and share one series per id across tiles.

## Fragile Areas

**`src/lib/ioBrokerConnect.svelte.js` (541 lines):**
- Files: `src/lib/ioBrokerConnect.svelte.js`
- Why fragile: single module owns connect/reconnect, RPC timeouts, cache hydration, inbound event fan-out and `setState` stamping; every store depends on it.
- Safe modification: change one concern per edit; the boot path is described step-by-step in `ARCHITECTURE.md` → Data Flow.
- Test coverage: no unit test for this module (it needs a live socket).

**Document migration paths:**
- Files: `src/lib/config/pages-ops.ts`, `src/lib/config/doc-parse.ts`, `src/lib/registry.svelte.js`, `src/lib/formulas.svelte.js`
- Why fragile: legacy page shapes are migrated on load (`migrateLibrary`, placement migration); a bad migration corrupts the user's dashboard document.
- Safe modification: add a migration case + a Vitest case in `pages-ops.test.ts` together; never migrate in place without a parse-validate pass.
- Test coverage: covered for the current shapes (`pages-ops.test.ts`, `review-fixes.test.ts`), but older/unknown shapes are not enumerated.

**Service-worker shell cache:**
- Files: `src/service-worker.js`
- Why fragile: hashed assets are precached but the shell deliberately is not, and navigations are network-first with `cache: "no-cache"`; the cached shell is only an offline fallback.
- Safe modification: keep the shell out of the precache list — that decision is documented in-file and was made to stop stale shells surviving deploys.
- Test coverage: none (no SW test).

**Repo location under a synced OneDrive folder:**
- Files: repository root `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
- Why fragile: cloud sync can lock files mid-`git` operation and does not belong in a build/output path (`www/`, `node_modules/`).
- Safe modification: prefer a local-only path for heavy builds; avoid running builds while a sync pass is active.

## Scaling Limits

**Browser-resident broker model:**
- Current capacity: works for typical home installations (thousands of states).
- Limit: `getAllObjects` + `subscribe *` + one reactive wrapper per state grow linearly with installation size; large installations (tens of thousands of objects) will show slow first paint and high memory.
- Scaling path: lazy/on-demand object loading for the pickers, subscription scoping (see Performance Bottlenecks).

## Dependencies at Risk

**Node engine range vs. toolchain:**
- Risk: `package.json` declares `"node": ">= 18.0.0"` while Vite 7 requires Node 20.19+/22.12+; CI runs 22.x and 24.x.
- Impact: a contributor on Node 18 gets a build failure that the manifest says is supported.
- Migration plan: raise `engines.node` to match Vite's floor.

**`@iobroker/adapter-core` is the only runtime dependency:**
- Risk: low, but the adapter's `once` mode and `utils.Adapter` lifecycle are pinned to its API.
- Impact: a major bump changes lifecycle hooks used by `main.js`.
- Migration plan: `test/integration.js` (mocha, real js-controller) is the guard; run it before bumping.

**Vendored socket client (see Tech Debt):** cannot be upgraded by `npm update`.

## Missing Critical Features

**No coverage measurement:**
- Problem: no coverage tool installed; coverage claims can only be made by file matching.
- Blocks: any objective gate on "domain layer is fully tested".

**No component/E2E test layer for the SPA:**
- Problem: 39 `.svelte` files have zero tests; `test/integration.js` covers the adapter lifecycle, not the UI.
- Blocks: regression safety for the display renderer, layout sheet and config forms.

## Test Coverage Gaps

**UI components:**
- What's not tested: all of `src/lib/components/**` (renderer, layout sheet, config editors, discovery).
- Files: `src/lib/components/**` (39 `.svelte`)
- Risk: layout/selection regressions reach users unnoticed.
- Priority: High

**Store write paths:**
- What's not tested: `stores/pages.svelte.ts`, `stores/templates.svelte.ts`, `stores/formulas.svelte.ts`, `stores/sheet.svelte.ts` (only `devices.test.ts` and `history.test.ts` exist).
- Files: `src/lib/stores/*.svelte.ts`
- Risk: debounced writes and guarded commits can corrupt or drop document edits.
- Priority: High

**Adapter lifecycle:**
- What's not tested: `main.js` legacy-copy and placeholder detection in the unit suite (only via `test/integration.js`, which needs a js-controller).
- Files: `main.js`, `test/integration.js`
- Risk: state creation/removal regressions only surface at instance start.
- Priority: Medium

---

*Concerns analysis: 2026-10-22*
