---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
# Coding Conventions

**Analysis Date:** 2026-10-22

## Naming Patterns

**Files:**
- Kebab-case for modules: `src/lib/config/control-ops.ts`, `src/lib/utils/icon-url.ts`, `src/lib/config/tile-parts.ts`.
- PascalCase for every Svelte component, one component per file: `src/lib/components/display/Tile.svelte`, `src/lib/components/common/Icon.svelte`.
- Runes modules use the `.svelte.ts` / `.svelte.js` suffix: `src/lib/stores/pages.svelte.ts`, `src/lib/theme.svelte.js`, `src/lib/StateClass.svelte.js`.
- Pure config-operation modules end in `-ops`: `src/lib/config/pages-ops.ts`, `layout-ops.ts`, `rule-ops.ts`, `tile-ops.ts`, `history-ops.ts`, `transform-ops.ts`, `virtual-ops.ts`, `template-ops.ts`, `size-ops.ts`, `sort.ts` (exception).
- Tests are co-located and named `<module>.test.ts`: `src/lib/config/format.test.ts`, `src/lib/utils/debounce.test.ts`.
- Legacy/vendored browser clients keep their original dotted names: `src/lib/ioBrokerConnect.svelte.js`.

**Functions:**
- camelCase, always starting with a verb that states intent:
  - `get*` / `set*` for state accessors: `getPageRegistry()`, `setCanonicalRegistry()` in `src/lib/stores/devices.svelte.ts`.
  - `is*` / `has*` / `may*` / `wants*` for predicates: `isLayoutWritable()` (`src/lib/stores/pages.svelte.ts`), `mayWritePages()` (`src/lib/config/pages-ops.ts`), `wantsDeviceConfig()` (`src/lib/pages.js`).
  - `parse*` for untrusted input: `parsePageRegistry()` (`src/lib/config/pages-ops.ts`), `parseDoc()` (`src/lib/config/doc-parse.ts`).
  - `apply*`, `resolve*`, `build*`, `compute*`, `migrate*`, `format*` for transformations: `applyRead()` (`src/lib/utils/transform.ts`), `resolvePage()` (`src/lib/config/pages-ops.ts`), `buildScope()` (`src/lib/config/virtual-ops.ts`).
- Private module helpers are lower-case without prefix but not exported: `claims()`, `badgeColor()`, `registerSlotStateIds()`.
- Test helpers are short and local to the test file: `dev()`, `row()`, `client()`, `fakeClient()`.

**Variables:**
- Boolean variables read as assertions: `saveFailed`, `confirmed`, `pagesLoadKind`, `usedStateCache`, `seen`.
- Module-level constants use UPPER_SNAKE_CASE: `PAGE_LIST_ID`, `DEVICE_LIST_ID`, `PAGE_REGISTRY_VERSION`, `AGO_WARN_MS`, `BADGE_COLORS`, `CONFIG_FOLDER`, `LEGACY_PREFIX`.
- Collection names are plural (`devices`, `pages`, `groups`, `placements`); single records are singular (`device`, `group`, `placement`).
- Cache objects bundle identity + value: `usedStateCache = { reg, ver, ids }` in `src/lib/stores/devices.svelte.ts`.

**Types:**
- PascalCase `interface` / `type` aliases: `Device`, `Control`, `PageRegistry`, `PlacementAnchor`, `HistoryClient`, `FilterableDevice`.
- String unions are lower-case literals: `DeviceType = "Switch" | "Light" | ...` (exception: device types are capitalized), `BadgeTone = "info" | "ok" | "warn" | "danger"`, `HistoryAggregate`.
- Discriminated unions carry a `kind` field: `TransformStep` (`src/lib/types/device.ts`), `HistoryEntry.status` (`src/lib/stores/history.svelte.ts`).
- Optional document fields are `?`, never `| null`, in persisted registry types: `src/lib/types/display.ts`, `src/lib/types/device.ts`.
- Prefer `unknown` at trust boundaries; `any` is allowed deliberately for ioBroker JSON payloads (see ESLint rule below): `ControlCommon` has `[key: string]: any` in `src/lib/types/device.ts`.

## Code Style

**Formatting:**
- Prettier 3 with `prettier-plugin-svelte`, configured in `.prettierrc.json`. Only `plugins` and `endOfLine: "auto"` are set, so Prettier defaults apply: 2-space indent, double quotes, semicolons, trailing commas everywhere, ~80-column wrapping, arrow-function parens.
- Multi-line argument lists and object literals keep the trailing comma:
  ```ts
  export function formatNumber(v: unknown, decimals?: number): string {
    const n =
      typeof v === "number"
        ? v
        : typeof v === "string" && v.trim() !== ""
          ? Number(v)
          : NaN;
  ```
  (`src/lib/config/format.ts`)
- Markdown/HTML comments in Svelte templates are used for design rationale, not decoration.

**Linting:**
- ESLint 8 flat config in `eslint.config.mjs`; run with `npm run lint`.
- `prettier/prettier` is an `error` for `**/*.{js,mjs}`, `**/*.{ts,mts}` and `**/*.svelte` — formatting failures fail lint.
- `@typescript-eslint/no-explicit-any` is **off** by design for TS files ("the adapter deals with dynamic ioBroker state/object payloads; `any` is used deliberately at the JSON boundaries").
- `@typescript-eslint/no-require-imports` is off for CommonJS adapter code (`main.js`, `test/`).
- `no-unused-vars` is off inside `.svelte` and `.svelte.js/.svelte.ts` because script variables are referenced from templates/runes.
- `svelte/no-navigation-without-resolve` is off — hash routing uses explicit `{base}/#/...` anchors.
- Ignores: `node_modules/`, `build/`, `www/`, `.svelte-kit/`, `coverage/`, `*.tgz`.

**Type checking:**
- `tsconfig.json` extends `.svelte-kit/tsconfig.json` with `strict: false`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `sourceMap`.
- `verbatimModuleSyntax: true` comes from the SvelteKit base config — type-only imports must use `import type` (or inline `type` specifiers):
  ```ts
  import type { Device, DeviceType } from "$lib/types/device";
  import { num, parseDoc, unwrapDoc } from "$lib/config/doc-parse";
  ```
- Check with `npm run check` (`svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`).

**Language:**
- Identifiers, comments, JSDoc and commit messages are English.
- UI strings are English by default; German appears only as example data in locale-aware logic/tests (e.g. boolean pair `"Aus/Ein"` in `src/lib/config/format.ts`).

## Import Organization

**Order (observed and expected):**
1. Svelte/runtime imports: `import { untrack } from "svelte";`, `import { SvelteMap } from "svelte/reactivity";`
2. `$lib` absolute imports, grouped by concern (types first, then config, then stores/utils):
   ```ts
   import type { Rule, Slot, TileConfig } from "$lib/types/display";
   import { evalActive } from "$lib/config/tile-ops";
   import { openSheet } from "$lib/stores/sheet.svelte.js";
   import SlotRenderer from "./SlotRenderer.svelte";
   ```
   (`src/lib/components/display/Tile.svelte`)
3. Relative imports for sibling components only (`./SlotRenderer.svelte`).
4. Side-effect/global CSS import last (`src/routes/+layout.svelte`).

**Path Aliases:**
- `$lib/*` maps to `src/lib/*` (SvelteKit-generated `.svelte-kit/tsconfig.json`).
- 385 imports use `$lib`; only sibling components and one JSON import (`../../../io-package.json` in `src/routes/settings/+page.svelte`) are relative.
- Tests use `$lib` in 31 of 33 files; a handful of older tests import `./module` (`src/lib/socket-url.test.ts`, `src/lib/utils/icon-url.test.ts`).

**Module shape:**
- **No default exports anywhere** in `src/` — always named exports. `main.js` exports a constructor factory via `module.exports = (options) => new IHome(options)` only in compact mode.
- No barrel/`index.ts` files: import the concrete module.
- Type-only re-exports use `export type`: `export type { SlotRow }` patterns appear via inline `type` in import lists.

## Error Handling

**Core principle: UI/config code never throws on bad input; it falls back.**

**Patterns:**
- Parsers return `null` for unusable documents; callers keep the in-memory copy instead of wiping user config:
  ```ts
  export function parseDoc<T>(raw: unknown, shape: (v: Record<string, unknown>) => T | null): T | null {
    ...
    } catch {
      return null;
    }
  }
  ```
  (`src/lib/config/doc-parse.ts`; same contract in `parsePageRegistry` in `src/lib/config/pages-ops.ts`)
- Result objects carry a value plus an error message, never an exception:
  ```ts
  export interface VirtualResult { value: unknown; error?: string }
  export function evaluateVirtual(expr: string, scope: Scope): VirtualResult {
    ...
    } catch (e) {
      return { value: undefined, error: e instanceof Error ? e.message : String(e) };
    }
  }
  ```
  (`src/lib/config/virtual-ops.ts`; same `{ value, error }` shape in `runStep`/`previewTransform` in `src/lib/config/transform-ops.ts`)
- Silent catch only for best-effort reads, with a comment or an explicit `catch {` and a safe fallback:
  ```ts
  try {
    const raw = g.localStorage?.getItem(HOST_KEY);
    ...
  } catch {
    hostPort = "";
  }
  ```
  (`src/lib/utils/icon-url.ts`)
- Async persistence catches and records failure for the UI instead of rejecting to the caller:
  ```ts
  ioBroker.setState(PAGE_LIST_ID, snapshot)
    .then(() => { saveFailed = false; })
    .catch((e) => { saveFailed = true; console.error("save pages:", e); });
  ```
  (`src/lib/stores/pages.svelte.ts`; exposed via `getLayoutSaveFailed()`)
- Write paths validate preconditions and return a boolean instead of throwing:
  `writeControl()` returns `false` for non-writable/unavailable/no-stateId controls (`src/lib/utils/control-write.ts`).
- Guard rails are explicit: `mayWritePages()` / `isLayoutWritable()` prevent writing a document before a successful read or seed (`src/lib/config/pages-ops.ts`, `src/lib/stores/pages.svelte.ts`).
- Adapter lifecycle uses `async`/`await` with ioBroker `*Async` calls and `this.log.info/warn` (`main.js`).

## Logging

**Framework:** `console` in the SPA; `this.log` in the adapter (`main.js`).

**Patterns:**
- Browser logs are `console.error`/`console.warn`, prefixed with a short context followed by a colon and the error:
  - `console.error("save pages:", e)` (`src/lib/stores/pages.svelte.ts`)
  - `console.error("initFormulas:", e)` (`src/lib/formulas.svelte.js`)
  - `console.warn("Failed to set state:", e)` (`src/lib/utils/control-write.ts`)
- Socket layer prefixes messages with `[Socket]`: `console.warn("[Socket] disconnected", r)` (`src/lib/ioBrokerConnect.svelte.js`).
- Adapter logs user-visible operations: `this.log.info(\`Copied ${name} to ...\`)`, `this.log.warn(\`Keeping ...\`)` (`main.js`).
- No logging framework, no log levels/abstraction; do not add one for feature code.

## Comments

**When to Comment:**
- Explain **why**, not what. Comments justify a non-obvious decision, a compatibility constraint, or a spec reference:
  ```ts
  // The ioBroker client is imported directly (never injected through a module
  // global): Vite HMR can hand this module two instances...
  ```
  (`src/lib/stores/pages.svelte.ts`)
- Spec/requirement references are embedded in prose and comments: `(A23)`, `(A66)`, `(spec §4.1)`, `(review C1)`, `(review I1)`. Keep them when editing nearby code.
- Long modules use banner separators to mark sections:
  ```ts
  // ------------------------------------------------------------------- pages
  // ---------------------------------------------------------------- sections
  ```
  (`src/lib/config/pages-ops.ts`, `src/lib/stores/devices.svelte.ts`)
- Test files use the same banner style with the behaviour under test: `// ------------------------------------------------- C2: never migrate blind` (`src/lib/config/review-fixes.test.ts`).

**JSDoc/TSDoc:**
- Every exported non-trivial function has a JSDoc block describing behaviour and edge cases:
  ```ts
  /**
   * A reading at a set precision: round a number (or a numeric string) to
   * `decimals` digits and drop trailing zeros ...
   */
  export function formatNumber(v: unknown, decimals?: number): string {
  ```
  (`src/lib/config/format.ts`)
- Svelte props are documented inline inside the `$props()` type:
  ```ts
  let { value, size = 24, dim = false, owner }: {
    /** A material-symbols name or an image path/URL (A23). */
    value?: string;
    ...
  } = $props();
  ```
  (`src/lib/components/common/Icon.svelte`)
- Adapter methods use JSDoc for parameters: `@param {unknown} val - state value` (`main.js`).

## Function Design

**Size:** Small, single-purpose pure functions. Most ops functions are 5–30 lines; the largest modules (~500 lines) are organized by banner sections.

**Parameters:**
- Data first, options last; optional knobs get defaults: `formatAge(ts, now = Date.now())`, `writeControl(client, control, value, now = Date.now(), options = {})`.
- Dependency injection for anything touching the broker: `HistoryClient` (`src/lib/stores/history.svelte.ts`), `WriteClient`-shaped object in `src/lib/utils/control-write.ts`.
- Inputs are typed `unknown` when parsing external/JSON data, then narrowed inside.
- Overrides in tests/updates are `Partial<T>`: `applyPickedState(row: Control, picked: Control, ...)`.

**Return Values:**
- New values only; inputs are never mutated. This is explicit in `src/lib/config/tile-ops.ts`: "Every op returns a new value (input never mutated)".
- `null` / `undefined` for "no result", `{ value, error }` for evaluation, `boolean` for "did the action happen".
- `void` for fire-and-forget persistence (`savePages()`, `commitLayout()` returns boolean).

**Composition:**
- Pure ops modules in `src/lib/config/` never import `ioBroker` directly, so they are unit-testable.
- When a deep copy is needed use `deepCopy()` (`src/lib/utils/json.ts`); it preserves `undefined` instead of turning it into `null` and handles Svelte `$state` proxies.

## Module Design

**Exports:**
- Named exports only. Types exported alongside the functions that use them (`export interface HistoryEntry`, `export type BadgeTone`).
- Public surface of a module is its exported functions; private helpers stay unexported.
- Aliases exist where a semantic name reads better: `export const getDevicesEnriched = _devicesEnriched;` (`src/lib/stores/devices.svelte.ts`) and `export const previewTransform = runStep;` (`src/lib/config/transform-ops.ts`).

**State (Svelte 5 runes):**
- Module-level state uses runes and is exposed through getter/setter functions, not exported bindings:
  ```ts
  let pageRegistry = $state<PageRegistry>(emptyRegistry);
  export function getPageRegistry(): PageRegistry { return pageRegistry; }
  export function setPageRegistry(reg: PageRegistry): void { ... }
  ```
  (`src/lib/stores/pages.svelte.ts`)
- Use `SvelteMap`/`SvelteSet` from `svelte/reactivity` when a reactive collection is needed: `src/lib/stores/history.svelte.ts`, `src/lib/stores/devices.svelte.ts`.
- Legacy `readable` stores with 50 ms polling remain in `src/lib/stores/devices.svelte.ts` (`canonicalRegistryStore`, `devicesEnrichedStore`) for components using `$`-style reads. New code should use the rune accessors.
- Stores are singletons at module scope (one registry per app), but broker clients are injected or imported directly per module — never assigned to a mutable module global that HMR could duplicate.

**Svelte component conventions:**
- Always `<script lang="ts">` and runes (`$state`, `$derived`, `$effect`, `$props`); 39 components, zero `createEventDispatcher`.
- Props are destructured from a single `$props()` call with an inline type and JSDoc; defaults live in the destructuring.
- Child-to-parent communication is callback props: `onModalClose`, `onDetail`, `onpick` etc. (`src/lib/components/display/Tile.svelte`).
- Event handlers use Svelte 5 attributes (`onclick`), not `on:click`: 129 `onclick=` usages, 0 `on:click`.
- Content composition uses snippets and `{@render}` (13 usages): `src/lib/components/common/ConfirmModal.svelte`.
- State that must not be tracked uses `untrack` (`src/lib/components/display/Tile.svelte`, `src/lib/stores/history.svelte.ts`).
- Styles are component-scoped `<style>` blocks; colors, radii, fonts, shadows come from the design tokens in `src/app.css` (`var(--text-muted)`, `var(--border-color)`, `var(--border-radius-pill)`, `var(--font-mono)`). Do not hard-code hex values in components.
- Dynamic per-instance variables are passed as CSS custom properties via `style:` directives (`style:--enum-color`, `style:--chart-height`).
- Theme switching is a `dark` class on `<html>`, via `src/lib/theme.svelte.js`; derive colors from `:root` tokens so both themes work.
- `$effect` is used for narrow synchronization; avoid effects that write state derived from other state (see the page-pick comment in `src/routes/+page.svelte`).

**Adapter / CommonJS (`main.js`, `test/*.js`, `scripts/*.mjs`):**
- `"use strict";`, `require()` allowed, 2-space indent, double quotes.
- Adapter class extends `utils.Adapter`, registers `ready`/`unload` handlers in the constructor.
- Node scripts use ESM `.mjs` (`scripts/deploy-www.mjs`) and process-level error handling.

---

*Convention analysis: 2026-10-22*
