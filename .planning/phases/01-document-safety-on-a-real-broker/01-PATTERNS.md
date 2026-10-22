# Phase 1: Document safety on a real broker - Pattern Map

**Mapped:** 2026-10-22
**Files analyzed:** 13 (9 new, 4 modified)
**Analogs found:** 13 / 13 (2 are partial — the mechanism has no existing analog, only the file shape does)

> **Tracked-source gate:** every analog path below was verified with `git ls-files -- <path>`
> (non-empty). No `.gsd/capabilities/**` mirror is involved in this phase. `lib/` (the new
> repo-root directory) is **not** gitignored — checked `.gitignore`; `dist/` is ignored, `lib/` is not.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/stores/pages.svelte.test.ts` | test | event-driven (debounced store + inbound callback) | the probe harness in `01-RESEARCH.md` «Code Examples» + `src/lib/picker-values.test.ts` + `src/lib/utils/debounce.test.ts` | exact (probe-verified 5/5) |
| `src/lib/stores/templates.svelte.test.ts` | test | event-driven | `src/lib/stores/pages.svelte.test.ts` (written first, then copied) | role-match → exact once the sibling exists |
| `src/lib/formulas.svelte.test.ts` | test | event-driven | `src/lib/stores/pages.svelte.test.ts` (sibling) | role-match |
| `src/lib/registry.svelte.test.ts` | test | event-driven | `src/lib/stores/pages.svelte.test.ts` (sibling) | role-match |
| `src/lib/config/adapter-migrate.test.ts` | test | transform (pure in/out) | `src/lib/config/pages-ops.test.ts` + `src/lib/utils/control-write.test.ts:4-13` | exact |
| `lib/adapter-migrate.js` | utility (CJS domain module) | transform | `main.js:22-32, 44-82` (the code being extracted) + `src/lib/config/doc-parse.ts` (parse style) | exact (extraction source) |
| `scripts/www-drift.mjs` | script (CLI) | file-I/O | `scripts/deploy-www.mjs` | role-match (script shape exact; mechanism has no analog) |
| `scripts/build-fingerprint.mjs` | utility (ESM, imported by config + script) | file-I/O | `scripts/deploy-www.mjs:17-27` (`walk()`) | role-match |
| `vite.config.mjs` (modify) | config | — | itself `vite.config.mjs:1-8, 29-35, 51-57` | exact |
| `package.json` (modify) | config | — | itself `package.json:63-71, 72-86` | exact |
| `src/lib/stores/pages.svelte.ts` (modify) | store | event-driven (debounce + socket reconnect) | `src/lib/stores/templates.svelte.ts:69-106` + `src/routes/+layout.svelte:74-102` | exact (sibling store) |
| `main.js` (modify) | adapter entry (CJS, `mode: "once"`) | request-response / one-shot I/O | itself `main.js:22-82` | exact |
| `.planning/PROJECT.md` (modify — D-03 statement) | doc | — | itself §Constraints `.planning/PROJECT.md:94-119` | exact |

---

## Pattern Assignments

### `src/lib/stores/pages.svelte.test.ts` (test, event-driven)

**Analogs:** `src/lib/picker-values.test.ts` (the only existing test that mocks the socket
singleton), `src/lib/utils/debounce.test.ts` (fake timers), `src/lib/stores/history.test.ts`
(`vi.waitFor` on an async store), plus the probe harness reproduced verbatim in
`01-RESEARCH.md` «Code Examples». **This file carries the harness the other three store tests copy.**

**Imports / mock pattern** — the singleton-cannot-be-injected exception
(`src/lib/picker-values.test.ts:1-12`):
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(), getState: vi.fn() },
}));

import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { ... } from "$lib/picker-values.svelte.js";
```
`pages.svelte.ts:8` imports the singleton directly, so this mock is **mandatory**, not a choice.
The phase's version upgrades the factory to `vi.hoisted()` (the probe's shape) because the fake
must survive `vi.resetModules()`.

**Fake-timer pattern** (`src/lib/utils/debounce.test.ts:5-18`) — the debounce in `savePages` is
`setTimeout(..., 250)` (`pages.svelte.ts:115-132`), the same shape:
```ts
vi.useFakeTimers();
d(); d(); d();
expect(n).toBe(0);
vi.advanceTimersByTime(299);
```
The store tests use the async variant — `await vi.advanceTimersByTimeAsync(250)` — because a
flush that awaits `setState` needs the microtask queue drained.

**Top-of-file factory per test file** (repo convention; no shared fixtures module —
`src/lib/stores/devices.test.ts:9-13`):
```ts
beforeEach(() => {
  // A fresh registry object invalidates the module's cache identity check.
  setCanonicalRegistry({ version: 0, updatedAt: 0, devices: [] });
  setObjectSource(null);
});
```

**Full harness to copy** (`01-RESEARCH.md`, «The verified store harness» — passed 5/5, then deleted):
```ts
const h = vi.hoisted(() => {
  const writes: Array<{ id: string; val: unknown }> = [];
  const ioBroker: any = {
    connected: 1,                                                       // else initPages spins 10 s
    objects: { get: () => undefined, size: 0 },                         // registerSlotStateIds
    enums: { getList: () => [{ _id: "enum.rooms.x", common: { name: "X" } }] }, // else 8 s spin
    wait: () => Promise.resolve(),
    getObject: () => Promise.resolve(null),
    emitAsync: () => Promise.resolve(),
    getState: () => Promise.resolve(null),                              // per-test override
    setState: (id: string, val: unknown) => { writes.push({ id, val }); return Promise.resolve(); },
  };
  return { ioBroker, writes };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: h.ioBroker }));

afterEach(() => {
  vi.useRealTimers();
  h.writes.length = 0;
  h.ioBroker.connected = 1;
  h.ioBroker.getState = () => Promise.resolve(null);
});
```
Every `it()` starts with `vi.resetModules();` then `const mod = await import("$lib/stores/pages.svelte.ts");`
— never hoist the store import to file scope (`initPromise` is memoised, `pages.svelte.ts:170-172`).

**Assertion style — the four traps this file must encode** (all four are recorded as Pitfalls 1–4
in `01-RESEARCH.md`):
1. `enums.getList` must be non-empty or `waitForEnumCache` (`pages.svelte.ts:22-29`) spins 8 s of
   real clock, and under fake timers never terminates.
2. `vi.resetModules()` per test, or the second `initPages()` returns the first scenario's promise.
3. `lastSent === null` before the first local write (`pages.svelte.ts:197`) → assert
   `not.toBe(before)` **and** `toEqual(before)`; `toBe` identity only *after* a local write.
4. A disconnected `setState` **resolves** — assert `getLayoutSaveFailed() === true` and
   `writes === []`, never the promise.

**Command it must satisfy:** `npx vitest run src/lib/stores/pages.svelte.test.ts` — the file name
matches `vite.config.mjs:53` `include: ["src/**/*.{test,spec}.{js,ts}"]`, and
`expect.requireAssertions: true` (`:54-56`) means **every `it()` needs ≥1 assertion**.

---

### `src/lib/stores/templates.svelte.test.ts` / `src/lib/formulas.svelte.test.ts` / `src/lib/registry.svelte.test.ts` (test, event-driven)

**Analog:** `src/lib/stores/pages.svelte.test.ts` (the sibling written in wave 1) — same mock, same
fake, same `resetModules` + dynamic import. Only four substitutions differ
(`01-RESEARCH.md` «Code Examples» table):

| Store | module / id | write guard accessor | failure accessor |
|-------|-------------|----------------------|------------------|
| `deviceList` | `$lib/registry.svelte.js` / `ihome.0.config.deviceList` (`devices.svelte.ts:15`) | none — `parseRegistry` success is the gate (`registry.svelte.js:20-37`) | none (`registry.svelte.js:82-94`) |
| `templateList` | `$lib/stores/templates.svelte.ts` / `TEMPLATE_LIST_ID:10` | `isTemplatesWritable()` (`:48-50`) | `getTemplateSaveFailed()` (`:42-44`) |
| `formulaList` | `$lib/formulas.svelte.js` / `FORMULA_LIST_ID` (`stores/formulas.svelte.ts:3`) | none — seeds **and saves** (`formulas.svelte.js:66-72`) | none (`formulas.svelte.js:34-43`) |

**The asymmetry is the requirement, not a bug to paper over** (Pitfall 8/9). Write each store's
test against what that store actually exposes:
- `templates`: same four behaviours as `pages` (refusal, debounce, echo, failure flag).
- `registry`: inbound apply + echo suppression + debounce; an unparsable read leaves the registry
  alone (`registry.svelte.js:123-131` only applies a *parsed* registry, never seeds).
- `formulas`: inbound apply + echo + debounce; the failure case is "logged, not flagged" — and the
  unparsable read **is seeded and written back** (`formulas.svelte.js:66-72` via `migrateLibrary`
  returning `formulas: []`, `src/lib/config/formulas.ts:89-119`). Assert the *current* outcome and
  record it as a follow-up; do not silently encode the gap (RESEARCH Open Question 1).
- `sheet`: `src/lib/stores/sheet.svelte.ts` is 16 lines of open/close UI state with no persistence —
  the sheet's write path **is** `commitLayout`, already covered by the `pages` test
  (RESEARCH Open Question 2).

**Two fake shapes these `.js` stores additionally need** (RESEARCH flags this as an *expectation,
not a verified result* — stand one up and confirm before writing the other on top):
- `registry.svelte.js:110-122` calls `migrateRegistry(parsed)` then `void loadUsedStates()`;
  `formulas.svelte.js:58-65` calls `migrateLibrary(raw)`. Both need the empty-input no-op shape:
  `objects: { get: () => undefined, size: 0 }` plus a device registry whose used-id set is empty.
- `loadUsedStates()` (`src/lib/states.svelte.js:28-47`) is called **fire-and-forget** (`void`) in both
  `.js` stores, so it never blocks `init*`; it does schedule `await new Promise(r => setTimeout(r, 0))`
  per 20-id batch (`:37-47`). Under fake timers that microtask waits for the clock —
  `await vi.advanceTimersByTimeAsync(250)` flushes it. Do not `await` it directly.

---

### `src/lib/config/adapter-migrate.test.ts` (test, transform)

**Analog:** `src/lib/config/pages-ops.test.ts:1-46` (imports + a typed factory + flat `it()` blocks)
and `src/lib/utils/control-write.test.ts:4-13` (the recording fake).

**Imports + factory pattern** (`pages-ops.test.ts:1-26`):
```ts
import { it, expect } from "vitest";
import { backfillEnumFields, ... } from "$lib/config/pages-ops";
import type { Page } from "$lib/types/display";

const dev = (over: Partial<FilterableDevice>): FilterableDevice => ({
  id: "x", name: "X", type: "Light", visibleControls: 1, ...over,
});
```

**This test has no analog for its import target** — it is the first test that imports from
**outside** `src/`, by relative path (`../../lib/adapter-migrate.js`, per RESEARCH Pattern 2). It
carries **no socket mock at all**: the decisions are pure values in, values out. Keep that
property — the moment this test needs a fake adapter, the extraction failed.

**Recording-fake pattern** (`control-write.test.ts:4-13`) if the helper's signature ends up taking a
"current value" object rather than scalars:
```ts
function fakeClient() {
  const writes: unknown[] = [];
  return { writes, setState: (_id: string, value: unknown) => { writes.push(value); return Promise.resolve(); } };
}
```

**Required coverage** (VALIDATION map): `-t "placeholder"` — a tile-less seed counts as empty, a
tile-bearing document never does; `-t "legacy"` — legacy copied when `config.*` is empty, legacy
never deleted while `config.*` is empty.

---

### `lib/adapter-migrate.js` (utility, CJS, transform)

**Analog (extraction source):** `main.js` — the code moves verbatim; the *file shape* has no
existing analog (there is no library module outside `main.js` today).

**Source to move — `isPlaceholder`** (`main.js:14-32`, comments included — they carry the "why" the
review needs):
```js
/**
 * The SPA seeds an empty page document when it cannot read one yet (e.g. the
 * dashboard was opened before this migration ran, or a browser still holds the
 * old bundle). Such a placeholder counts as empty here — otherwise the real
 * documents could never come across. A document with any tile is never touched.
 *
 * @param {unknown} val - state value
 */
function isPlaceholder(val) {
  try {
    const doc = typeof val === "string" ? JSON.parse(val) : val;
    if (!doc || doc.seeded !== true || !Array.isArray(doc.pages)) return false;
    return !doc.pages.some((p) => (p.groups || []).some((g) => (g.tiles || []).length));
  } catch {
    return false;
  }
}
```

**Source to move — the copy/keep decision** (`main.js:44-82`), reduced to pure functions:
```js
const current = await this.getStateAsync(target);
if (current?.val == null || isPlaceholder(current.val)) {          // ← pickMigrationValue
  const fromLegacy = await this.getForeignStateAsync(LEGACY_PREFIX + name);
  const fromRoot = await this.getStateAsync(name);
  const source = fromLegacy?.val != null ? fromLegacy : fromRoot;  // oldest first: legacy, then root
  if (source?.val != null) { await this.setStateAsync(target, { val: source.val, ack: true }); }
}
if (await this.getObjectAsync(name)) {                             // ← mayDropRootState
  if ((await this.getStateAsync(target))?.val == null &&
      (await this.getStateAsync(name))?.val != null) {
    this.log.warn(`Keeping ${this.namespace}.${name}: ${target} is empty`);
  } else { await this.delObjectAsync(name); }
}
```

**File-header conventions** (`main.js:1-12`): `"use strict";` first line, `require` for deps, a
block comment stating the *why*, `ROOT`-level `const` for the ids:
```js
"use strict";
const utils = require("@iobroker/adapter-core");
const CONFIG_FOLDER = "config";
const DOCS = ["pageList", "deviceList", "templateList", "formulaList"];
const LEGACY_PREFIX = "0_userdata.0.Test.AiHome.";
```

**Module export convention** (`main.js:92-98`):
```js
if (require.main !== module) { module.exports = (options) => new IHome(options); }
else { new IHome(); }
```
`lib/adapter-migrate.js` is a plain library — `module.exports = { isPlaceholder, pickMigrationValue, mayDropRootState };`
(RESEARCH Pattern 2). **Hard constraint, not style:** `main.js` is CJS with no build step
(`package.json:63`) and Node cannot `require` a `.ts` file (Pitfall 7). JSDoc types only.

**Pure-function style to mirror** (`src/lib/config/doc-parse.ts:1-30` — never throw, `null` means
"the caller keeps what it has"):
```ts
export function unwrapDoc(raw: unknown): unknown { /* { val } | string | plain object */ }
export function parseDoc<T>(raw: unknown, shape: (v: Record<string, unknown>) => T | null): T | null { ... }
```

**Also required:** `package.json:64-71` `files` must gain `"lib/"`, or the tarball's `main.js`
throws `MODULE_NOT_FOUND` on a real broker while `test:package` stays green (Pitfall 7).

---

### `scripts/www-drift.mjs` + `scripts/build-fingerprint.mjs` (script + shared module, file-I/O)

**Analog:** `scripts/deploy-www.mjs` — the repo's only `scripts/*.mjs`, and a close match in shape:
ESM, stdlib-only, top-level await, a local `walk()`, explicit exit codes.

**Script header + walk pattern** (`deploy-www.mjs:1-27`):
```js
#!/usr/bin/env node
// Uploads the built SPA (www/) into the running broker's file storage over the
// ioBroker MCP endpoint, so the web adapter serves it at /ihome/ right away —
// no adapter install, no upload command. ...           ← the "why", 4-6 lines
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.argv[2] || "www";

/** Local build tree, with paths relative to ROOT and POSIX slashes. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const isDir = statSync(abs).isDirectory();
    out.push({ rel: relative(ROOT, abs).split(sep).join("/"), abs, isDir });
    if (isDir) out.push(...walk(abs));
  }
  return out;
}
```

**Exit / reporting convention** (`deploy-www.mjs:107-110, 149-151`):
```js
if (init.status !== 200 || !init.session) {
  console.error(`no MCP session from ${BASE} (status ${init.status})`);
  process.exit(1);
}
...
console.log(`${BASE} → ${NS}: ${written} files written, ${removed} stale removed`);
```
`www-drift.mjs` mirrors this: `console.error(...)` + `process.exit(process.env.CI ? 1 : 0)`
(fail CI, warn locally — RESEARCH Pattern 3).

**No existing analog for the mechanism.** There is no build-integrity guard, no hash helper and no
`prebuild` hook anywhere in the repo (verified: `package.json:72-86` has no `pre`/`post` scripts;
`scripts/` holds exactly `deploy-www.mjs`). Take the mechanism from `01-RESEARCH.md` Pattern 3:
`node:crypto` `createHash("sha256")` over sorted `path + content` of `src/**` + `static/**`
(excluding `**/*.(test|spec).[jt]s`), one shared module imported by **both** `vite.config.mjs` and
`scripts/www-drift.mjs` so the hash can never be computed two different ways. Do **not** put it
under `src/` (RESEARCH Open Question 4) — `svelte-check` would type-check a build script as app code.

**Read-only + no credentials:** stdlib file I/O only; unlike `deploy-www.mjs:12` it must not read
`IOBROKER_MCP` or any env var other than `CI`.

---

### `vite.config.mjs` (modify, config)

**Analog:** itself. Three touch points.

**The version block it edits** (`vite.config.mjs:29-35`):
```js
      version: {
        pollInterval: 0,
      },
      output: {
        bundleStrategy: "inline",
      },
```
`pollInterval: 0` stays. Add `name: <deterministic fingerprint>` — `hash(kit.version.name)` is the
sole root of build nondeterminism (RESEARCH Pattern 3).

**ESM import convention at the top** (`vite.config.mjs:1-8`) — the file is already `.mjs` with a
comment explaining *why it is not `svelte.config.js`*; a local import of
`./scripts/build-fingerprint.mjs` fits beside the existing ones.

**The test block must not change** (`vite.config.mjs:51-57`) — new Vitest files fit it as-is:
```js
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{js,ts}"],
    expect: { requireAssertions: true },
  },
```

---

### `package.json` (modify, config)

**Analog:** itself.

**`files` + `main`** (`package.json:63-71`) — add `"lib/"`:
```json
  "main": "main.js",
  "files": ["admin/", "www/", "io-package.json", "LICENSE", "README.md", "main.js"]
```

**Scripts block the hook joins** (`package.json:72-86`) — npm runs `prebuild`/`postbuild`
automatically; `ioBroker/testing-action-adapter@v1` calls `npm run build` when `build: true`
(`.github/workflows/test-and-release.yml:36-40`), which is what makes a **`prebuild`** hook fire
before `www/` is overwritten (Pitfall 6):
```json
    "build": "vite build",
    "pack": "npm run build && npm pack",
```
Add `"prebuild": "node scripts/www-drift.mjs"` — nothing else in the block changes.

---

### `src/lib/stores/pages.svelte.ts` (modify, event-driven store)

**Analog:** `src/lib/stores/templates.svelte.ts` — the same registry pattern, one document over.
Copy its structure; change only the retry.

**The exact block to extend** (`pages.svelte.ts:112-133`) — the drop this phase closes:
```ts
export function savePages(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getPageRegistry());
  saveTimer = setTimeout(() => {
    // A disconnected socket resolves `emitAsync` without sending anything, so a
    // write would look successful while the broker never saw it (review I1).
    if (!ioBroker.connected) {
      saveFailed = true;
      return;                     // ← today the edit is DROPPED (PERSIST-02 gap)
    }
    lastSent = snapshot;
    ioBroker.setState(PAGE_LIST_ID, snapshot)
      .then(() => { saveFailed = false; })
      .catch((e) => { saveFailed = true; console.error("save pages:", e); });
  }, 250);
}
```

**Module state it must respect** (`pages.svelte.ts:70-76`) — no setters exist for these, which is why
the test resets modules instead of the store growing a test hook:
```ts
let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
let saveFailed = $state(false);
let pagesLoadKind = $state<LoadedPages["kind"] | null>(null);
```

**The two existing accessors the retry must keep honest** (`pages.svelte.ts:82-93`) — the retry's
observable is these, never the promise (Pitfall 4):
```ts
export function getLayoutSaveFailed(): boolean { return saveFailed; }
export function isLayoutWritable(): boolean { return mayWritePages(pagesLoadKind); }
```

**Reconnect-trigger analog** if the retry is driven from the component layer instead
(`src/routes/+layout.svelte:74-102`) — the existing `$effect` that already watches `ioBroker.connected`:
```svelte
  $effect(() => {
    if (!ioBroker.connected) return;
    setStateSource(ioBroker.states);
    setObjectSource(ioBroker.objects);
    void reloadUsedStates();
```
RESEARCH Open Question 3 recommends the **store-side self-contained retry** (testable with the
fake-timer harness, no component coupling); the `$effect` route is the viable alternative and moves
a store concern into a component. Either way: `savePages` already serialises the **whole** registry
(`:114`), so "the next change re-sends everything" holds by construction — only the reconnect path
is missing.

**Do not widen this phase.** PERSIST-02 is `pages` only; `templates` has its own flag, and
`registry`/`formulas` have neither a `connected` guard nor a failure flag (Pitfall 9).

---

### `main.js` (modify, adapter entry)

**Analog:** itself. It shrinks to plumbing; the decision moves to `lib/adapter-migrate.js`.

**Import + call shape to keep** (`main.js:3-12, 44-65`): `"use strict"` header, `require` beside the
existing one, `DOCS`/`LEGACY_PREFIX` constants stay, and the `for (const name of DOCS)` loop keeps
`setObjectNotExistsAsync` → `getStateAsync` → decide → `setStateAsync` with the `this.log.info`
line intact.

**Keep the module export guard unchanged** (`main.js:92-98`) — `@iobroker/testing` relies on the
compact-mode export.

---

### `.planning/PROJECT.md` (modify, doc — D-03)

**Analog:** itself §Constraints (`.planning/PROJECT.md:94-119`), bullet style with a bolded lead-in:
```
- **Persistence**: ioBroker states are the database — four `ihome.0.config.*` JSON documents. No
  external DB, no server-side code.
- **Deployment**: `www/` is committed because GitHub installs do not build the frontend, so it must
  be rebuilt before committing UI changes; ...
```
Add the accepted ~250 ms concurrent-write window as a constraint bullet in that style. The Key
Decisions table (`:127-137`) already carries the matching `www/` drift row ("⚠️ Revisit — it can
silently drift from `src/` (Phase 1 adds the guard)") — update that row's outcome rather than adding
a duplicate.

---

## Shared Patterns

### A. The store-test harness (applies to all four store tests)
**Source:** `src/lib/picker-values.test.ts:3-5` (mock), `src/lib/utils/debounce.test.ts:5-18`
(timers), `01-RESEARCH.md` «Code Examples» (the full verified probe).
Four moving parts, no deviations: `vi.hoisted()` → `vi.mock("$lib/ioBrokerConnect.svelte.js", …)` →
`vi.resetModules()` + `await import(...)` per test → `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(250)`.
Never add a `__resetForTests()` export (RESEARCH «Don't Hand-Roll»); the state the tests need to
reset is exactly what production must not expose.

### B. Injected factory, not module mock
**Source:** `src/lib/stores/devices.test.ts:9-13`, `src/lib/utils/control-write.test.ts:4-13`.
Every test file declares its own top-of-file factory (VALIDATION: "No shared fixtures module is
needed"). The socket singleton is the **single** exception (Shared Pattern A).

### C. The socket surface a fake must imitate
**Source:** `src/lib/ioBrokerConnect.svelte.js:360-369` and `:510-520`.
```js
export function emitAsync(event, ...data) {
  if (!ioBroker.connected || !socket) { console.warn(...); return void 0; }   // ← resolves!
}
export async function setState(id, val) { ...; return emitAsync("setState", id, val); }
```
A disconnected `setState` **resolves with `undefined`** — a mock that rejects instead is lying about
production and will make failure tests pass for the wrong reason (Pitfall 4).

### D. Pure-domain module style (`lib/adapter-migrate.js`, and any helper)
**Source:** `src/lib/config/doc-parse.ts:1-30`, `src/lib/config/pages-ops.ts:381-415`,
`src/lib/formulas.svelte.js:66-72`.
Union return for a decision (`LoadedPages`), never throw, `null` = "caller keeps memory", the *why*
in the JSDoc rather than the code:
```ts
export type LoadedPages =
  | { kind: "loaded"; registry: PageRegistry }
  | { kind: "seeded"; registry: PageRegistry }
  | { kind: "absent"; registry: null }
  | { kind: "invalid"; registry: null };
export function mayWritePages(kind: LoadedPages["kind"] | null): boolean {
  return kind === "loaded" || kind === "seeded";
}
```

### E. Guard-then-write, in that order, everywhere
**Source:** `pages.svelte.ts:140-150` (`commitLayout`), `templates.svelte.ts:96-106`,
`registry.svelte.js:82-94`, `formulas.svelte.js:34-43`.
Every write path is: refuse (log, return `false`) → replace the in-memory model → debounce → guard
`connected` → `lastSent` → `setState`. The guided-write refusal message is a `console.error` with
the document's state id in it — keep the wording (the phase's tests assert the refusal, not the text).

### F. Test-file naming and the include glob
**Source:** `vite.config.mjs:51-57`.
Co-located `<module>.test.ts`, flat `it()` or `describe()` groups, **no globals** (import `{it, expect, vi}`
from vitest explicitly), `expect.requireAssertions: true` → a test with zero assertions fails.
A repo-root Vitest test would need a config change; the Wave 0 list deliberately keeps every new
test under `src/**` for that reason.

---

## No Analog Found

| File | Role | Data Flow | Reason / where the pattern comes from instead |
|------|------|-----------|-----------------------------------------------|
| `scripts/www-drift.mjs` | script | file-I/O | **Mechanism** has no analog: no build-integrity guard, no hashing helper, no CI hook exists. File *shape* copies `scripts/deploy-www.mjs`. Use `01-RESEARCH.md` Pattern 3 (fingerprint of `src/` + `static/`, `prebuild` hook, `process.exit(process.env.CI ? 1 : 0)`). |
| `scripts/build-fingerprint.mjs` | utility | file-I/O | No module is shared between build config and scripts today. One module, imported by `vite.config.mjs` and `scripts/www-drift.mjs`, outside `src/` (RESEARCH Open Question 4). |
| `lib/adapter-migrate.js` | utility | transform | No CJS library module exists outside `main.js`, and `lib/` is a new directory. Extraction source is `main.js:22-32, 44-82`; the `.js`/CJS placement is a hard constraint, not a preference. |
| `src/lib/stores/pages.svelte.test.ts`'s PERSIST-02 **retry** records | test | event-driven | No reconnect path exists in any store (`savePages` drops the edit). The *test* pattern is Shared Pattern A; the *behaviour* comes from RESEARCH Open Question 3 — assert through `getLayoutSaveFailed()` + `writes`, never the promise. |
| `"prebuild"` script in `package.json` | config | — | No npm lifecycle hooks exist in the repo yet (`package.json:72-86`). The hook name and its CI effect come from `01-RESEARCH.md` Pattern 3 / Pitfall 6. |

---

## Metadata

**Analog search scope:** repo root (`main.js`, `vite.config.mjs`, `package.json`), `scripts/`,
`test/`, `src/lib/stores/`, `src/lib/config/`, `src/lib/utils/`, `src/lib/`, `src/routes/`,
`.github/workflows/`, `.planning/PROJECT.md`.
**Files scanned:** ~35 (13 read in full, remainder by grep/ls); 13 classified targets matched to
git-tracked analogs (verified with `git ls-files`).
**Pattern extraction date:** 2026-10-22
**Re-verify if:** `@sveltejs/kit` is upgraded (the `hash(kit.version.name)` finding is an internal
detail, not a public contract) — the fingerprint check itself survives an upgrade, the byte
reproducibility claim does not.
