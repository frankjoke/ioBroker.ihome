---
last_mapped_commit: 7af86a1f0f6d1965506992ef4809514dcb9b078a
last_mapped_at: 2026-10-22
---
# Testing Patterns

**Analysis Date:** 2026-10-22

## Test Framework

**Runner (unit):**
- Vitest 4.1.11 — configured inside `vite.config.mjs` (`test` block), not in a separate `vitest.config.*`.
  ```js
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    expect: {
      requireAssertions: true,
    },
  },
  ```
- No setup files, no globals: tests import `describe/it/expect/vi` explicitly from `"vitest"`.
- `expect.requireAssertions: true` — a test without at least one assertion fails. Never write a test that only calls a function.

**Runner (package/integration):**
- Mocha 12 with `@iobroker/testing` 6.3.1, CommonJS (`test/*.js`), no `.mocharc` file.

**Assertion Library:**
- Vitest's built-in `expect` (`toBe`, `toEqual`, `toContain`, `toBeUndefined`, `toHaveBeenCalledWith`, `not.toThrow`).
- No `node:assert`, no chai/sinon, no snapshot assertions.

**Run Commands:**

```bash
npm test                 # unit + package + integration (the full gate)
npm run test:unit        # vitest run  → 33 files, 391 tests, ~2.4 s
npm run test:package     # mocha test/package.js --exit
npm run test:integration # mocha test/integration.js --exit
npx vitest               # watch mode (no npm script)
npx vitest run src/lib/config/format.test.ts   # one file
npx vitest run -t "matches only what the member asks for"  # one test by name
```

**Verified baseline (2026-10-22):** `npx vitest run` → `Test Files 33 passed (33)`, `Tests 391 passed (391)`, duration 2.42 s.

## Test File Organization

**Location:**
- Co-located with the module under test, in the same directory: `src/lib/config/format.ts` ↔ `src/lib/config/format.test.ts`.
- Unit tests only under `src/`; the Vitest `include` deliberately excludes `test/`.
- 33 test files, 5,897 lines:
  - `src/lib/config/` — 25 files (the bulk of the pure logic)
  - `src/lib/utils/` — 4 files
  - `src/lib/stores/` — 2 files (`devices.test.ts`, `history.test.ts`)
  - `src/lib/` root — 2 files (`picker-values.test.ts`, `socket-url.test.ts`)

**Naming:**
- `<module>.test.ts`, always `.test.ts` (no `.spec.ts` in the repo).
- Test names describe behaviour from the user's point of view: `"writes once and refuses a second press until the first lands"`, `"does not abort the batch when one id fails"`, `"never throws on a bad formula"`.
- Where a test guards a review finding or spec item, the name or a banner comment carries the id: `// ------------------------------------------------- C2: never migrate blind` in `src/lib/config/review-fixes.test.ts`.

**Structure:**

```text
src/lib/config/<module>.ts        # implementation
src/lib/config/<module>.test.ts   # tests, same folder
```

## Test Structure

**Suite Organization — two accepted styles:**

1. **Flat top-level `it()`** (23 of 33 files) with banner comments/blank lines grouping related cases. Used when the file tests one module's operations:
   ```ts
   import { it, expect } from "vitest";
   import { contrastColor, formatAge, formatNumber } from "$lib/config/format";

   it("returns dark text for light colors", () => {
     expect(contrastColor("#ffcc00")).toBe("#1a1a1a");
   });
   it("formats seconds", () => expect(formatAge(now - 5000, now)).toBe("5s"));
   ```
   (`src/lib/config/format.test.ts`)

2. **`describe("<module or function>")` groups** (10 of 33 files) when a file covers several entry points:
   ```ts
   describe("ensureHistory / readHistory", () => {
     it("marks empty when the range has no points", async () => { ... });
   });
   describe("noteLive", () => { ... });
   ```
   (`src/lib/stores/history.test.ts`)

**Patterns:**
- Assertions are direct and specific: `expect(value).toBe("54.3")`, `expect(result).toEqual([...])`; avoid loose truthiness except for booleans.
- Assertions frequently check the no-op/fallback path as well as the happy path (`expect(readHistory(...)).toBeUndefined()`, `expect(client.writes).toEqual([])`).
- Comparisons of full structures use `toEqual` with inline literals, never snapshots.
- Repeated invariants are asserted in the same test when they document one behaviour (e.g. several `expect`s inside the precision test in `src/lib/config/format.test.ts`).
- No `beforeAll`, no global teardown, no test ordering dependencies.

## Mocking

**Framework:** Vitest `vi`.

**Primary pattern — inject fakes, do not mock modules:**

```ts
function fakeClient() {
  const writes: unknown[] = [];
  return {
    writes,
    setState: (_id: string, value: unknown) => {
      writes.push(value);
      return Promise.resolve();
    },
  };
}
```

(`src/lib/utils/control-write.test.ts`)

```ts
function client(getHistory: HistoryClient["getHistory"], connected = true): HistoryClient {
  return { connected, getHistory };
}
```

(`src/lib/stores/history.test.ts`)

Store inputs are also injected: `setObjectSource(new Map([...]) as any)` and `setStateSource(...)` in `src/lib/stores/devices.test.ts`; `setCanonicalRegistry({ ... })` reseeds module state.

**Module mocking — one exception:**

```ts
vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(), getState: vi.fn() },
}));
```

(`src/lib/picker-values.test.ts` — the singleton socket module must be replaced before import.)

**What to Mock:**
- Anything that talks to the broker when the module accepts a client (`getHistory`, `setState`, `getObject`).
- The `$lib/ioBrokerConnect.svelte.js` singleton only when the module imports it directly and cannot be injected.
- Timers for debounce/throttle logic (`src/lib/utils/debounce.test.ts`).
- Environment variables with `vi.stubEnv` (`src/lib/socket-url.test.ts`).

**What NOT to Mock:**
- Pure `src/lib/config/*-ops.ts` functions — call them with plain literals and assert the returned values.
- `Date` globally; pass an explicit `now` argument instead (`formatAge(ts, now)`, `writeControl(..., now, ...)`).
- The filesystem/network — there is none in the SPA logic.

## Fixtures and Factories

**Test Data:**
- No fixture directory, no JSON fixtures. Documents and records are built inline as typed object literals.
- Reusable builders are small top-of-file factories using `Partial` overrides:
  ```ts
  const dev = (over: Partial<FilterableDevice>): FilterableDevice => ({
    id: "x",
    name: "X",
    type: "Light",
    visibleControls: 1,
    ...over,
  });
  ```
  (`src/lib/config/pages-ops.test.ts`; same idea in `control-ops.test.ts`, `tile-ops.test.ts`, `tile-parts.test.ts`, `review-fixes.test.ts`)
- Base records for update-style functions are defined once and spread: `row()`, `picked`, `control` (`src/lib/config/control-ops.test.ts`, `src/lib/utils/control-write.test.ts`).

**Location:**
- Factories live at the top of the test file that uses them. Do not create a shared fixtures module unless several test files need the exact same shape.

**State reset:**
- Module state is reset in `beforeEach` or explicitly per test:
  ```ts
  beforeEach(() => {
    setCanonicalRegistry({ version: 0, updatedAt: 0, devices: [] });
    setObjectSource(null);
  });
  ```
  (`src/lib/stores/devices.test.ts`)
  ```ts
  resetWriteLocks();   // called at the start of each locking test
  ```
  (`src/lib/utils/control-write.test.ts`)

## Coverage

**Requirements:** None enforced. No coverage config, no thresholds, no CI coverage step, no coverage badge.

**Tooling:** `@vitest/coverage-v8` is **not** in `devDependencies`; `npx vitest run --coverage` will not work until it is added.

**View Coverage:**

```bash
npm i -D @vitest/coverage-v8
npx vitest run --coverage
```

## Test Types

**Unit Tests (Vitest):**
- Scope: pure logic in `src/lib/config/`, `src/lib/utils/`, and two stores. Node environment (no DOM), no Svelte component rendering.
- 25 config files cover layout/page/rule/tile/template/history/virtual/size/sort/format/units/rooms/state-tree/project/presets-adjacent logic.
- Store tests exercise module-level runes state through its public accessors after seeding via setters.

**Package Tests (Mocha):**
- `test/package.js` calls `tests.packageFiles(path.join(__dirname, ".."))` — validates `package.json`, `io-package.json`, and that referenced files exist.

**Integration Tests (Mocha):**
- `test/integration.js` calls `tests.integration(root, { allowedExitCodes: [0, 11] })` — boots the adapter against a real JS-Controller; exit code 11 is expected for a `"once"` adapter.
- Uses `.releaseconfig.json` / `io-package.json` metadata, not mocks.

**E2E / UI Tests:**
- Not present in the repo. `.playwright-mcp/` is ignored tooling output (`.gitignore`), not a committed suite.
- No Svelte component tests: 39 `.svelte` files, zero `.svelte.test.ts` / `*.test.svelte`.

## Common Patterns

**Timer Testing:**

```ts
vi.useFakeTimers();
const d = debounce(() => n++, 300);
d(); d(); d();
expect(n).toBe(0);
vi.advanceTimersByTime(299);
expect(n).toBe(0);
vi.advanceTimersByTime(1);
expect(n).toBe(1);
vi.useRealTimers();
```

(`src/lib/utils/debounce.test.ts`)

**Async Store Testing — poll with `vi.waitFor`, never `sleep`:**

```ts
ensureHistory(client(async () => []), "a.0.empty", spec);
await vi.waitFor(() =>
  expect(readHistory("a.0.empty", spec)?.status).toBe("empty"),
);
```

(`src/lib/stores/history.test.ts`)

**Error Testing:**

```ts
ensureHistory(client(async () => { throw new Error("no history adapter"); }), "a.0.err", spec);
await vi.waitFor(() => expect(readHistory("a.0.err", spec)?.status).toBe("error"));
expect(readHistory("a.0.err", spec)?.error).toContain("no history adapter");
```

Also: `expect(() => noteLive(...)).not.toThrow();` and "never throws" tests for `applyRead` with a bad formula (`src/lib/utils/transform.test.ts`).

**Environment / global stubbing:**

```ts
function setLocation(href: string): void {
  const url = new URL(href);
  // @ts-expect-error the test runs without a DOM; the helper only reads these
  globalThis.location = { protocol: url.protocol, hostname: url.hostname, search: url.search };
}
afterEach(() => vi.unstubAllEnvs());
```

(`src/lib/socket-url.test.ts`)

**Mock call assertions:**

```ts
expect(ioBroker.emitAsync).toHaveBeenCalledWith("getState", "a.0.one");
expect((ioBroker as any).getState).not.toHaveBeenCalled();
```

(`src/lib/picker-values.test.ts`)

**Test naming with comments:** assert the intent in a trailing comment when the input is deliberately odd: `expect(matchesMember(d, {})).toBe(false); // Review Focus 1` (`src/lib/config/pages-ops.test.ts`).

## CI and Gates

- `.github/workflows/test-and-release.yml` runs on every push/PR (skips on `[skip ci]`):
  - `check-and-lint`: `ioBroker/testing-action-check@v2` with Node 24 and `lint: true` (runs `npm run check` + `npm run lint`).
  - `adapter-tests`: `ioBroker/testing-action-adapter@v1` with `build: true`, matrix Node 22.x and 24.x.
- Local prerequisite: Node >= 18 (`package.json` `engines`). CI builds the SPA before the adapter tests.
- A change is expected to pass `npm run lint`, `npm run check`, and `npm test`.

## Coverage Gaps

**Untested source modules (no adjacent test file):**
- Broker/socket layer: `src/lib/ioBrokerConnect.svelte.js`, `src/lib/StateClass.svelte.js`, `src/lib/iobroker.socket.io.js` (vendored), `src/lib/localStorage.js`, `src/lib/serviceWorkerComm.js`, `src/lib/pages.js`.
- Stores: `src/lib/stores/pages.svelte.ts`, `src/lib/stores/templates.svelte.ts`, `src/lib/stores/formulas.svelte.ts`, `src/lib/stores/sheet.svelte.ts`.
- Helpers: `src/lib/theme.svelte.js`, `src/lib/time.svelte.js`, `src/lib/tools.svelte.js`, `src/lib/registry.svelte.js`, `src/lib/formulas.svelte.js`, `src/lib/states.svelte.js`, `src/lib/picker-state.svelte.js`, `src/lib/utils.ts`, `src/lib/utils/ids.ts`, `src/lib/utils/json.ts`, `src/lib/config/doc-parse.ts`, `src/lib/config/presets.ts`.
- Adapter: `main.js` is covered only indirectly by the integration test; its migration/placeholder logic has no unit test.
- UI: all 39 Svelte components (display, config, layout, discovery, common) have no automated tests.

**Risk:** the persistence layer (`pages.svelte.ts`, `templates.svelte.ts`) and the migration in `main.js` are the highest-risk untested paths — they write user configuration, and a regression can silently overwrite documents. When changing them, add a unit test for the pure part (move logic into `src/lib/config/*-ops.ts`) and rely on the integration test only for startup.

**Priority:** High — `src/lib/stores/pages.svelte.ts` write guards; Medium — `main.js` placeholder/migration logic; Low — presentational Svelte components.

---

*Testing analysis: 2026-10-22*
