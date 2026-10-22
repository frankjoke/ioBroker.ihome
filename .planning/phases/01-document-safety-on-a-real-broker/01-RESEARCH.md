# Phase 1: Document safety on a real broker - Research

**Researched:** 2026-10-22
**Domain:** ioBroker adapter (`main.js`, CJS, `mode: "once"`) + Svelte 5 SPA — four JSON documents persisted as broker states; proving the write guards with store-level tests, extracting an adapter migration helper, and adding a `www/` build-drift guard
**Confidence:** HIGH (the two riskiest assumptions were falsified-or-confirmed by running code this session, not by reading)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The broker is the single source of truth and every client applies an inbound change it is
  affected by. This already holds for all four documents — `src/lib/stores/pages.svelte.ts`,
  `src/lib/stores/templates.svelte.ts`, `src/lib/registry.svelte.js` (deviceList) and
  `src/lib/formulas.svelte.js` (formulaList) each set `st.onUpdate` on their state, replace the
  in-memory model, suppress their own echo by comparing the serialized document to `lastSent`, and
  write back through a debounced `setState`. Phase 1 **proves** this, document by document; it does
  not build it.
- **D-02:** Convergence is required for **all four** documents — deviceList, the display tree
  (`pageList`), `templateList` and `formulaList` — not only `pageList`. The user's framing: "if
  somebody change the device list other instances should see this change immediately, if somebody
  change the UI tree, then the trees for the others should change also like for the formula and
  template lists."
- **D-03:** Two clients writing inside the same ~250 ms debounce window is an **accepted, documented
  limit**: the later `setState` wins and the earlier edit is lost silently. No conflict detection, no
  `updatedAt`-based rebase, no detection channel. The phase records it as a known limit (in the
  phase's docs and, as a product statement, among PROJECT.md's constraints).
  — **Reversibility:** costly — adding detection later means a document-version field in the
  persisted shape plus a rebase path in every writer.
- **D-04:** An inbound change from another client applies **immediately, everywhere**: an open tile
  editor or device form re-renders against the newer document instead of holding a draft. No
  draft/rebase path in any editor.
  — **Reversibility:** costly — adding draft protection later touches every editor that can write.

### the agent's Discretion

- **Test shape** for the four convergence paths — one test per document or a shared harness — and
  where the echo-suppression assertion lives. The existing conventions apply: co-located
  `<module>.test.ts`, `expect.requireAssertions`, injected fakes rather than module mocks (except the
  `$lib/ioBrokerConnect.svelte.js` singleton, which `pages.svelte.ts` imports directly).
- **Where the `www/` drift guard runs** (PERSIST-05) — a Vitest test that rebuilds and diffs, a hash
  manifest checked in CI, or a precondition inside `npm run pack`. Not discussed; the trade-off is
  blocking the release versus warning about it.
- **How the migration logic becomes unit-testable** (PERSIST-04) — extracting the copy/placeholder
  logic out of `main.js` into a pure module (the `src/lib/config/` layer is where pure, testable
  domain logic already lives) versus testing it through mocha with a mocked adapter. Not discussed.
- **Dropped-socket UX and retry** (PERSIST-02) — where "not saved" surfaces (sheet banner, tile-line
  badge, toast) and whether a failed edit is queued for reconnect or dropped. Not discussed. Grounding
  for the planner: `savePages()` currently sets `saveFailed = true` and returns without sending when
  `!ioBroker.connected`, so today the edit is dropped; `getLayoutSaveFailed()` already exposes the
  state for the UI, and `commitLayout()` returns `false` only when the document was never loaded.

### Deferred Ideas (OUT OF SCOPE)

- **Adapter runtime logic driven by config** — "the main adapter will run ioBroker state logic which
  will be configured and managed by a to-be-implemented UI config page/s similar to the current
  visualization configuration." This is the adapter-logic stream; `PROJECT.md` and `STATE.md` already
  record it as deferred to v2 because it is still unspecified, and the current adapter is
  `mode: "once"` (creates the four documents, exits) so it has no runtime behaviour to configure yet.
- **Per-user security** — "we may add later security by user so only special users may configure UI or
  adapter logic, but this should go after main functionality is implemented." Explicitly post-v1.
- **Conflict detection / document-version rebase** — the alternative to D-03; revisit if the accepted
  window bites in practice.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PERSIST-01 | Loading against an absent/unparsable document never writes — seeded display stays in memory, state untouched | Guard already exists (`mayWritePages`, `LoadedPages`); **store-level test harness proven this session** (see *Pattern 1* + *Code Examples*). Pitfalls 1–4 are the traps. |
| PERSIST-02 | A failed/disconnected save shows "not saved" and the edit reaches the broker on the next change or reconnect; stored doc = last successful save, never empty | `getLayoutSaveFailed()` + the banner already exist (`LayoutSheet.svelte:360-363`); the **retry half does not exist** — `savePages` drops the edit. Mechanism options + the one tested reason `emitAsync` lies about success (Pitfall 4). |
| PERSIST-03 | Store write paths (`pages`, `templates`, `formulas`, `sheet`) unit-tested: commit refusal before load, debounce, echo suppression, failure handling | Pure logic is already covered; the **store level is the gap**. Test mechanics proven; the `formulas`/`registry` asymmetry documented (Pitfall 8/9) and raised as an open question about "sheet". |
| PERSIST-04 | Adapter legacy-copy/placeholder logic unit-tested through a pure helper; tile-less seed counts as empty; legacy never deleted while `config.*` is empty | `main.js:22-32` and `main.js:44-82` read verbatim; the **CJS↔TS boundary + `package.json` `files`** constraint decides where the helper can live (Pattern 2, Pitfall 7). |
| PERSIST-05 | A stale `www/` cannot be committed unnoticed — the build/pack path reports it | **Decisive empirical finding:** the build is byte-reproducible once `kit.version.name` is deterministic (`hash(kit.version.name)` is the *sole* root of build nondeterminism). This replaces the fragile normalization approach (Pattern 3, Pitfall 6/10). |

</phase_requirements>

## Summary

Phase 1 is **3/5 a proof phase and 2/5 a small-build phase**. PERSIST-01 and PERSIST-03 are tests
against guards that already exist; the pure logic behind them (`loadPages`, `mayWritePages`,
`migratePageRegistry`) is *already* covered in `src/lib/config/pages-ops.test.ts` and
`src/lib/config/review-fixes.test.ts` — the gap is the **store level**, which is untested today
(`.planning/codebase/CONCERNS.md` → "Store write paths … Priority: High"). PERSIST-02 needs a retry
that does not exist (`savePages` sets `saveFailed` and *drops* the edit — `pages.svelte.ts:112-133`).
PERSIST-04 needs `main.js`'s placeholder/copy logic moved somewhere a unit test can reach it.
PERSIST-05 needs a guard that does not exist and, until this research, had no cheap correct mechanism.

Two things were settled by **running code in this session rather than reading about it**:

1. **The store-level test harness works.** A throwaway `src/lib/stores/__probe.test.ts` (5 tests:
   absent → refusal, unparsable → refusal, debounce → one write, disconnected flush → `saveFailed`,
   inbound apply + echo suppression) passed 5/5 with the `vi.hoisted` + `vi.mock` + `vi.resetModules`
   + dynamic-`import()` pattern. It also surfaced a real semantic trap: inbound changes are **not**
   suppressed before the first local write. The probe was deleted; the tree is back at the verified
   baseline (33 files / 391 tests green). The working harness is reproduced in *Code Examples*.
2. **The `www/` build has exactly one source of nondeterminism, and it is one config line.**
   `node_modules/@sveltejs/kit/src/exports/vite/index.js:247` is
   `const version_hash = hash(kit.version.name);` — the `__sveltekit_<hash>` app prefix, the inlined
   bundle chunk's content hash, `_app/version.json`, `index.html` and `service-worker.js` all derive
   from `version.name`, which **defaults to a timestamp**. Two consecutive builds with the default
   differ in exactly those three files; two consecutive builds with a fixed `version.name` were
   **byte-for-byte identical** across all 11 files. A naive byte-diff drift guard therefore needs *no
   regex normalization* once `version.name` is deterministic — and SvelteKit's own type docs say the
   value "must be deterministic" anyway.

**Primary recommendation:** (a) add three co-located store tests mirroring each module name
(`pages.svelte.test.ts`, `templates.svelte.test.ts`, `registry.svelte.test.ts`,
`formulas.svelte.test.ts`) using the proven harness; (b) add a self-contained reconnect retry inside
`pages.svelte.ts` so `savePages` stops dropping edits, then test the *retry* rather than the promise;
(c) extract `isPlaceholder` + the copy decision from `main.js` into a **CommonJS** module outside
`src/` that `main.js` and a Vitest test both `require`/`import`, and add it to `package.json` `files`;
(d) make `kit.version.name` a deterministic fingerprint of the build inputs and hook a **pre-build**
fingerprint check into the `build` script — pre-build because CI builds *before* it tests
(`testing-action-adapter` order: install → build → unit tests), so any post-build check is blind to
the very staleness it is meant to catch.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Guarded document write / refusal before a successful load (PERSIST-01) | Browser / Client — SPA store (`pages.svelte.ts`, `templates.svelte.ts`) | — | The guard is a client-side state machine (`LoadedPages["kind"]`); the broker has no notion of "not loaded yet". |
| "Not saved" surface + retry (PERSIST-02) | Browser / Client — store owns the flag, `LayoutSheet.svelte` renders it | Broker (socket reconnect event) | The retry decision must live where `saveFailed` and the snapshot live; the *trigger* is the socket's own reconnect. |
| Cross-client convergence (D-01/D-02) | Broker — the state's `onUpdate` fan-out is the transport | Browser / Client — each store applies + echo-suppresses | The broker is the single source of truth (locked D-01); each client only decides "is this mine?". |
| Store write paths under unit test (PERSIST-03) | Build / CI tier (Vitest, `environment: "node"`) | — | Node env, no DOM, no socket: the whole capability is prove-by-test. |
| Legacy copy / placeholder detection (PERSIST-04) | API / Backend — `main.js` (`mode: "once"`, CJS) | Build / CI tier (the pure helper's test) | The adapter owns `config.*` and the one-time copy; the SPA never performs it. |
| `www/` drift guard (PERSIST-05) | Build / CI tier — `package.json` build hooks + `vite.config.mjs` | — | It is a build-integrity property; no runtime tier is involved. |
| Accepted ~250 ms concurrent-write window (D-03) | Documentation / product statement (`PROJECT.md` constraints) | — | Accepted limit, not an enforcement point; there is deliberately no runtime owner. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | 4.1.11 (installed) | Store-level tests, the migration helper's test, the drift fingerprint test | Already the repo's unit runner (`vite.config.mjs:51-57`); `vi.hoisted` + `vi.resetModules` are core APIs, no new dependency. |
| mocha + `@iobroker/testing` | 12.0.3 / 6.3.1 (installed) | Untouched: `test/package.js`, `test/integration.js` remain the lifecycle layer | The integration test needs a real js-controller; the phase must not move that burden into Vitest. |
| `node:crypto` + `node:fs` + `node:path` | Node 24.22.1 | Build-input fingerprint for PERSIST-05 | Stdlib only — the repo's constraint is "exactly one runtime dependency" (`PROJECT.md` §Constraints). |
| `@sveltejs/kit` | 2.70.3 (installed) | `version.name` becomes the deterministic build fingerprint | Its own type docs require a deterministic value; the source shows it is the sole root of build nondeterminism. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:child_process` (`git rev-parse HEAD`) | stdlib | Alternative fingerprint source | Only if the planner prefers a commit ref over a source hash — but see Pitfall 10 (a commit ref changes on *every* commit and turns the diff guard into a permanent false positive). |
| `svelte/reactivity` (`SvelteSet`) | 5.55.3 | Only if a new module needs a reactive set | Not needed by any recommended change. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deterministic `version.name` + fingerprint check | Rebuild-and-diff with **token normalization** | Verified to work, but needs three regexes (`\d{13}` version, `__sveltekit_[a-z0-9]+`, `bundle\.[A-Za-z0-9_-]{8}\.js` — this last one only because the version is *inside* the chunk, so its content hash moves). Three patterns that a SvelteKit upgrade can silently invalidate, turning the guard into a false-positive generator. Costs ~18 s per run (measured). |
| Pure helper in a CJS module outside `src/` | Extract into `src/lib/config/*.ts` and have `main.js` require the built output | `main.js` is plain CommonJS and Node cannot `require` a `.ts` file; there is no build step for `main.js`. The repo's own convention in `.planning/codebase/TESTING.md` says "move logic into `src/lib/config/*-ops.ts`" — **that advice does not hold across the CJS boundary** and must be adapted, not followed literally. |
| Vitest test for the drift check | mocha test in `test/` | The Vitest `include` is `["src/**/*.{test,spec}.{js,ts}"]` (`vite.config.mjs:53`); a repo-root test needs the mocha layer or a config change. `src/build-drift.test.ts` fits the existing include with **no config change** — CONTEXT's note that a repo-root test needs a config change is true, but a `src/`-rooted one does not. |
| Store tests via injected clients (the repo's usual pattern) | Keep `vi.mock("$lib/ioBrokerConnect.svelte.js")` | Not a choice: `pages.svelte.ts:8`, `templates.svelte.ts:5`, `registry.svelte.js:6`, `formulas.svelte.js:5` all import the singleton directly. `picker-values.test.ts:3-5` is the established exception. |

**Installation:**

```bash
# Nothing to install. This phase adds zero packages — see the audit below.
```

**Version verification:** All versions above were read from the working tree this session
(`node --version` → `v24.22.1`; `npx vitest --version` → 4.1.11 via `vite.config.mjs` /
`package.json`; `npx mocha --version` → 12.0.3; `node -e "require('@sveltejs/kit/package.json').version"`
→ 2.70.3). No version was taken from training data.

## Package Legitimacy Audit

> **Required** whenever this phase installs external packages. Run the Package Legitimacy Gate protocol before completing this section.

**This phase installs no external packages.** Every mechanism recommended here uses what is already in
`package.json` (`vitest`, `mocha`, `@sveltejs/kit`) or the Node standard library (`node:crypto`,
`node:fs`, `node:path`). The gate therefore has nothing to verify; it was **evaluated and found
empty**, not skipped.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| — (none added) | — | — | — | — | — | — |

**Packages removed due to `[SLOP]` verdict:** none
**Packages flagged as suspicious `[SUS]`:** none

Explicitly **not** added, despite being adjacent to this phase's goals:

- `@vitest/coverage-v8` — coverage tooling is deferred to v2 (`REQUIREMENTS.md` → QUAL-01). PERSIST-03
  is satisfied by named behaviours, not by a coverage number.
- Any file-hashing or diffing package — `node:crypto` covers it. `PROJECT.md` §Constraints: "No new
  runtime dependency without a reason."

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | ✓ | v24.22.1 | — |
| npm | scripts, pre/post hooks | ✓ | 12.2.1 | — |
| git | optional (only if the guard compares against `HEAD`) | ✓ | 2.55.0.vfs.0.10 | Fingerprint check needs no git |
| Vitest | PERSIST-01/02/03/05 tests | ✓ | 4.1.11 | — |
| mocha | `test:package`, `test:integration` (unchanged) | ✓ | 12.0.3 | — |
| `npm run build` | PERSIST-05 guard | ✓ | ~18 s wall clock (measured: 6.32 s Vite + adapter-static) | — |
| Live ioBroker broker `192.168.178.9:8082` | Success criteria 1, 2, 3 (manual UAT) | ✓ — probed this session, `HTTP 200` on `/ihome/index.html` | js-controller 7.2.5 | **None.** Criteria 1–3 ride a real socket against a real broker; there is no in-repo automation for them. |
| js-controller (local, for `test:integration`) | the `npm test` gate | via `@iobroker/testing` (downloads/boots its own) | — | Run `npm run test:unit && npm run test:package` locally and let CI run the integration leg. |

**Missing dependencies with no fallback:**
- A live broker for criteria 1–3. These are **manual-only** verification items — plan them as explicit
  operator steps (with the exact state ids and the expected before/after), not as an automated task.

**Missing dependencies with fallback:**
- None blocking. `git` is present but the recommended guard does not need it.

## Architecture Patterns

### System Architecture Diagram

Two flows matter: the **document flow** (what this phase proves) and the **build flow** (what
PERSIST-05 guards). Read them as separate lanes.

```
  ┌─ BROKER (ioBroker js-controller) ────────────────────────────────────────────┐
  │  ihome.0.config.pageList / deviceList / templateList / formulaList  (json)   │
  │  0_userdata.0.Test.AiHome.*   ← legacy originals, read-only after migration  │
  └───────▲───────────────────────────┬───────────────────────┬──────────────────┘
          │ setState (debounced 250ms)│ stateChange           │ getForeignState
          │                           ▼                       │
  ┌───────┴──────────────────────────────────────┐            │
  │ SPA (browser tab A)                          │            │
  │  commitLayout() ─► mayWritePages(kind)? ──no─► REFUSE      │
  │        │ yes                                 │            │
  │        ▼                                     │            │
  │  setPageRegistry(next)                       │            │
  │  savePages() ─► [250ms debounce]             │            │
  │        │                                     │            │
  │        ├─ ioBroker.connected? ─no─► saveFailed=true, DROP │
  │        │ yes                          (PERSIST-02 gap)    │
  │        ├─ lastSent = snapshot                │            │
  │        └─ ioBroker.setState(PAGE_LIST_ID) ───┼────────────┘
  │                                              │
  │  initPages() ─► getState().onUpdate ─────────┘
  │        │            │
  │        │            └─ parse ok? ─no─► ignore (keep memory)
  │        │                 │ yes
  │        │                 └─ JSON.stringify(parsed) === lastSent?
  │        │                       ├─ yes ─► ECHO, ignore          ← D-01
  │        │                       └─ no  ─► setPageRegistry(parsed) ← D-04 (immediate)
  │        ▼
  │  loadPages(raw, seed) ─► {loaded | seeded | absent | invalid}
  │        │
  │        ├─ absent/invalid ─► seed stays in MEMORY, mayWritePages=false  ← PERSIST-01
  │        └─ loaded/seeded ─► writable
  └──────────────────────────────────────────────────────────────────────────────┘

  ┌─ ADAPTER (main.js, mode: "once", CJS, exits) ────────────────────────────────┐
  │  onReady, for each DOCS name:                                                │
  │    setObjectNotExists(config.<name>)                                         │
  │    current = getState(config.<name>)                                         │
  │      current?.val == null  OR  isPlaceholder(current.val)?                   │
  │        ├─ yes ─► read legacy 0_userdata.0.Test.AiHome.<name>                 │
  │        │         else read old root state <name>                             │
  │        │         └─ source?.val != null ─► setState(config.<name>, source)   │
  │        └─ no  ─► leave the real document alone                    ← PERSIST-04 │
  │    if old root state <name> exists:                                          │
  │      config empty AND root non-empty? ─► KEEP root (+ warn)                  │
  │      else                             ─► delObject(root)                     │
  └──────────────────────────────────────────────────────────────────────────────┘

  ┌─ BUILD / CI TIER ────────────────────────────────────────────────────────────┐
  │  src/**  ─► npm run build ─► www/ (11 tracked files, shipped in the tarball) │
  │  prebuild  ─► drift check: fingerprint(committed www/_app/version.json)      │
  │                       == fingerprint(src/**, static/**)?                     │
  │                 ├─ no  ─► REPORT  (CI: fail · local: warn)  ← PERSIST-05     │
  │                 └─ yes ─► proceed                                            │
  │  vite build ─► www/ (byte-reproducible iff version.name is deterministic)    │
  └──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/lib/stores/
├── pages.svelte.ts          # unchanged except the retry in savePages
├── pages.svelte.test.ts     # NEW — PERSIST-01, PERSIST-02, PERSIST-03 (pageList)
├── templates.svelte.test.ts # NEW — PERSIST-03 (templateList)
lib/                          # NEW directory (repo root, CJS, shipped)
└── adapter-migrate.js       # NEW — pure placeholder/copy decision (PERSIST-04)
src/lib/config/
└── adapter-migrate.test.ts  # NEW — Vitest test for lib/adapter-migrate.js
src/lib/
├── registry.svelte.test.ts  # NEW — PERSIST-03 (deviceList convergence + write)
└── formulas.svelte.test.ts  # NEW — PERSIST-03 (formulaList convergence + write)
scripts/
└── www-drift.mjs            # NEW — PERSIST-05 fingerprint check
main.js                      # shrinks to adapter plumbing; requires lib/adapter-migrate.js
vite.config.mjs              # version.name becomes the deterministic fingerprint
package.json                 # files += "lib/", scripts: prebuild hook
```

Note the deliberate asymmetry with `.planning/codebase/TESTING.md`'s advice: the store tests live
under `src/lib/stores/` (co-located, matching the include glob) but the *adapter* helper must live
outside `src/` because `main.js` cannot load TypeScript (Pitfall 7).

### Pattern 1: Store-level test harness (PROVEN this session — 5/5 green)

**What:** Test a module-level runes store that imports the `ioBroker` singleton, whose `init*` is
memoised per module instance, whose saves are debounced, and whose inbound path is a callback assigned
onto the state object returned by `getState`.

**When to use:** Every one of the four document stores. It is the only pattern that works, because the
singleton cannot be injected.

**The four moving parts that make it work:**
1. `vi.hoisted(...)` — a mutable fake that survives `vi.resetModules()`, so a hoisted `vi.mock` factory
   can close over it.
2. `vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: h.ioBroker }))` — the same exception
   `picker-values.test.ts:3-5` already uses.
3. `vi.resetModules()` + `await import("$lib/stores/pages.svelte.ts")` — the ONLY way to reset
   `initPromise`, `lastSent`, `pagesLoadKind` and `saveTimer`, none of which have setters.
4. `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(250)` — drives the debounce.

**The fake must satisfy `initPages` entirely** — see Pitfall 1 for why `enums` and `connected` are not
optional even though the test never asserts on them.

```ts
// Source: verified in this session — a throwaway probe of exactly this shape passed 5/5,
// then was deleted. Reproduced here as the harness the planner should build on.
const h = vi.hoisted(() => {
  const writes: Array<{ id: string; val: unknown }> = [];
  const ioBroker: any = {
    connected: 1,                                                        // else initPages spins 10 s
    objects: { get: () => undefined, size: 0 },                          // registerSlotStateIds
    enums: { getList: () => [{ _id: "enum.rooms.x", common: { name: "X" } }] }, // else waitForEnumCache spins 8 s
    wait: () => Promise.resolve(),
    getObject: () => Promise.resolve(null),
    emitAsync: () => Promise.resolve(),
    getState: () => Promise.resolve(null),                               // per-test override
    setState: (id: string, val: unknown) => { writes.push({ id, val }); return Promise.resolve(); },
  };
  return { ioBroker, writes };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: h.ioBroker }));

it("refuses every write when the document was absent", async () => {
  vi.resetModules();
  const mod = await import("$lib/stores/pages.svelte.ts");
  await mod.initPages();
  expect(mod.isLayoutWritable()).toBe(false);
  expect(mod.commitLayout(doc)).toBe(false);
  expect(h.writes).toEqual([]);          // PERSIST-01: no write reaches the broker
});
```

### Pattern 2: A pure helper both the adapter and a Vitest test can load

**What:** Move the decision out of `main.js` into a module with no adapter dependency, so the decision
becomes a pure function of `(currentVal, legacyVal, rootVal)` and the *adapter* keeps only the I/O.

**When to use:** PERSIST-04. The decision itself is already pure — `isPlaceholder(val)` only parses and
inspects (`main.js:22-32`) — so the extraction is mechanical.

**The hard constraint (not a style choice):** `main.js` is CommonJS with no build step
(`package.json:63` `"main": "main.js"`, and the handoff records that `"type": "module"` was deliberately
dropped). Node cannot `require` a `.ts` file. So the helper must be `.js` in CJS, and it must be listed
in `package.json` `files` (`package.json:64-71` currently ships `admin/`, `www/`, `io-package.json`,
`LICENSE`, `README.md`, `main.js` — **nothing else**).

Shape that satisfies both:

```js
// lib/adapter-migrate.js — CommonJS, no adapter dependency
"use strict";

/** A tile-less seed counts as empty, so the real document still comes across. */
function isPlaceholder(val) { /* moved verbatim from main.js:22-32 */ }

/** Which value should land in config.<name>? null = write nothing. */
function pickMigrationValue({ current, legacy, root }) { /* ... */ }

/** May the old root state be deleted? Never while config.<name> is empty. */
function mayDropRootState({ current, root }) { /* ... */ }

module.exports = { isPlaceholder, pickMigrationValue, mayDropRootState };
```

The Vitest test imports it by relative path (`../../lib/adapter-migrate.js`) and carries no adapter
mock at all — the decisions are pure values in, values out.

### Pattern 3: Build fingerprint guard — deterministic `version.name` + a pre-build check

**What:** Make the build output a pure function of the sources, then compare the fingerprint recorded
in the committed bundle against the fingerprint the sources compute now.

**Why this shape and not a rebuild-and-diff:** see Pitfall 6 — CI runs `npm run build` *before*
`npm run test:unit`, so any check that runs after the build sees a fresh `www/` and can never observe
staleness. The check must run **before** the build, which means it cannot rebuild.

**The three lines of evidence that make this work:**
- `node_modules/@sveltejs/kit/src/exports/vite/index.js:247` — `const version_hash = hash(kit.version.name);` (the app prefix is a hash of the version name, not random).
- `node_modules/@sveltejs/kit/types/index.d.ts:886` — *"The current app version string. If specified, this must be deterministic (e.g. a commit ref rather than `Math.random()` or `Date.now().toString()`), otherwise defaults to a timestamp of the build."*
- Two builds with a **fixed** `version.name` were byte-for-byte identical (all 11 files, `diff -r` silent); two builds with the default differed in exactly `_app/version.json`, `index.html`, `service-worker.js`.

```js
// scripts/www-drift.mjs (sketch) — stdlib only
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// MUST match the hash that vite.config.mjs puts into version.name, or the guard
// reports drift forever. Keep this function in ONE place and import it from both.
export function buildFingerprint() {
  const files = ["src", "static"]                     // + vite.config.mjs if the planner wants it
    .flatMap((dir) => walk(dir))
    .filter((p) => !/\.(test|spec)\.[jt]s$/.test(p))  // test files are not in the bundle
    .sort();
  const h = createHash("sha256");
  for (const p of files) h.update(p).update(readFileSync(p));
  return h.digest("hex").slice(0, 16);
}

// check: committed version.json vs the fingerprint the sources produce now
const recorded = JSON.parse(readFileSync("www/_app/version.json", "utf8")).version;
const now = buildFingerprint();
if (recorded !== now) {
  console.error(`www/ is stale: built from ${recorded}, src/ is now ${now}`);
  process.exit(process.env.CI ? 1 : 0);   // fail CI, warn locally
}
```

Wiring (npm runs `prebuild`/`postbuild` around `npm run build`, and
`testing-action-adapter` calls `npm run build` when `build: true` — verified from its `action.yml`):

```json
"prebuild": "node scripts/www-drift.mjs",
"build": "vite build",
"pack": "npm run build && npm pack"
```

### Anti-Patterns to Avoid

- **Asserting echo suppression by object identity before the first write.** Before any local write
  `lastSent === null`, and `pages.svelte.ts:197` is `if (lastSent !== null && lastSent === asString) return true;` — so the *first* inbound change is always applied, even when the content is identical.
  A `toBe` identity assertion fails there (it did, in the probe). Assert `not.toBe` + `toEqual` before
  the first write, and `toBe` (identity) only *after* a local write.
- **Testing the disconnected path through `.then()`/`.catch()`.** A disconnected `emitAsync` returns
  `void 0` (`ioBrokerConnect.svelte.js:364-369`), which makes `setState` *resolve* — so a naive
  failure test passes for the wrong reason. Assert the guard's observable (`getLayoutSaveFailed()` and
  `writes === []`), never the promise's settlement.
- **Writing the drift check as a post-build Vitest test.** It will be green in CI no matter what,
  because CI builds first. It is still worth having for developers who run `npm test` without
  building — but it must not be the *only* guard.
- **Putting the new adapter helper under `src/`.** `main.js` cannot import it and the tarball would
  not ship it.
- **Using a git commit ref as the fingerprint.** Every commit then changes `index.html`, so the
  committed `www/` is stale by construction on every commit.
- **Leaving `www/` out of a guard that also covers `static/`.** A favicon change alters the shipped
  bundle without touching `src/` at all; whatever the fingerprint hashes must include `static/`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resetting module-level store state between tests | A `__resetForTests()` export, or one test file per scenario | `vi.resetModules()` + dynamic `import()` | Adding a test-only reset export puts test scaffolding in shipped code; the stores' state (`initPromise`, `lastSent`, `pagesLoadKind`, `saveTimer`) is exactly what production should never expose. |
| Sharing a mutable fake with a hoisted mock | Re-declaring `vi.mock` per file, or a `globalThis` stash | `vi.hoisted()` | `vi.mock` factories are hoisted above imports, so they cannot close over ordinary top-level `const`s. `vi.hoisted` is the supported hook. |
| Debounce/timer waiting | `await new Promise(r => setTimeout(r, 300))` | `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(250)` | The repo already does this in `src/lib/utils/debounce.test.ts`; a real-timer sleep is flaky on a OneDrive folder. |
| Polling an async store | `await sleep(...)` | `await vi.waitFor(() => expect(...))` | Established in `src/lib/stores/history.test.ts`. |
| Hashing a directory | A hand-rolled checksum / mtime comparison | `node:crypto` `createHash("sha256")` over sorted path+content | mtimes are unreliable here (OneDrive sync rewrites them); content hashing is what "matches a build of `src/`" actually means. |
| Proving the migration with a hand-mocked `utils.Adapter` in mocha | A fake adapter harness re-implementing `setObjectNotExistsAsync`/`getStateAsync`/`getForeignStateAsync` | The pure helper + `test/integration.js` | `@iobroker/testing` already boots a real js-controller for the lifecycle; a second mocked-adapter harness re-implements it and proves less. |
| Detecting a stale `www/` | A checked-in hash manifest of every built file | The `version.name` fingerprint (Pattern 3) | The bundle is 419 KB of inlined JS; a per-file manifest is 11 more entries to keep in sync and still needs a build to validate. |

**Key insight:** in this repo the two "hard" problems — testing a singleton-coupled runes store and
detecting a stale committed build — are both already solved by the platform (Vitest's module registry
and SvelteKit's `version.name`). The custom solution in each case is *worse* and *larger*.

## Runtime State Inventory

> This is not a rename/refactor phase, so no identifier is being replaced. The categories are answered
> anyway, because the phase's own subject matter (a migration and a committed build artifact) lives in
> exactly these places.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No renamed key. Phase-relevant state on the live broker (`192.168.178.9`, js-controller 7.2.5): `ihome.0.config.pageList` = 3 pages / 26 tiles, `.deviceList` = 12 devices, `.templateList` = empty, `.formulaList` = seeded; legacy `0_userdata.0.Test.AiHome.*` retained as a backup. | None (read-only for this phase). Criteria 1–3 are *manual observations* of these states. |
| Live service config | The broker's own file namespace `ihome/` holds the deployed SPA (11 files) — written by `scripts/deploy-www.mjs` over the MCP endpoint, **not** in git but generated from `www/`. | None this phase; PERSIST-05 governs the git side, `deploy:www` (INSTALL-04) the broker side. |
| OS-registered state | None — this repo registers no scheduled task, service, pm2 process or launchd unit. | None. |
| Secrets/env vars | `IOBROKER_MCP` (read by `scripts/deploy-www.mjs`, env-only, defaults to localhost); `.env` / `.env.*` gitignored (dev socket URL); no SOPS keys. | None — no key or variable is renamed. |
| Build artifacts | `www/` — **11 tracked files** (`git ls-files www`), shipped in the tarball via `package.json:66`; `.svelte-kit/` and `*.tgz` are gitignored. | **This is the phase's target.** PERSIST-05 adds the guard that stops `www/` lagging `src/`. |

**The canonical question** — *after every file in the repo is updated, what runtime systems still have
the old string cached, stored, or registered?* Here: nothing is renamed; the equivalent question is
*whether the committed `www/` still corresponds to `src/`*, and the answer today is "unknown, silently" —
which is the gap PERSIST-05 closes.

## Common Pitfalls

### Pitfall 1: `waitForEnumCache()` / the `connected` wait hang the store test

**What goes wrong:** `initPages` first waits up to 10 s for `ioBroker.connected`, then `await
waitForEnumCache()` — and `waitForEnumCache(ms = 8000)` is a **real-clock** loop:
`while (Date.now() < until) { … await ioBroker.wait(200); }` (`pages.svelte.ts:22-29`). With a mock whose
`enums` is missing, the loop spins the full 8 s of wall clock per test — and under `vi.useFakeTimers()`
`Date.now()` is frozen, so it never terminates (an `await` on an already-resolved promise is a
microtask, which does not advance the fake clock).

**Why it happens:** the loop's exit condition is satisfied by the *enum cache*, not by time. A mock that
only stubs `getState`/`setState` leaves it unsatisfiable.

**How to avoid:** make the fake satisfy both gates up front — `connected: 1` and
`enums.getList: () => [{ … }]` returning a non-empty array. Then neither loop ever iterates.

**Warning signs:** a test file that hangs, or a suite that takes 8–20 s instead of ~0.5 s.

### Pitfall 2: `initPromise` is memoised — a second `init*()` in the same file silently no-ops

**What goes wrong:** each store sets `let initPromise = null` at module scope and returns the cached
promise on the second call (`pages.svelte.ts:170-172`, `templates.svelte.ts:109-111`,
`registry.svelte.js:16,96-97`, `formulas.svelte.js:13,45-46`). Two `it()` blocks that both call
`initPages` with different mocked reads will see the *first* scenario's result.

**Why it happens:** memoisation is the production behaviour (multiple callers race to init once).

**How to avoid:** `vi.resetModules()` at the top of every test, then `await import(...)` — the module
registry reset is what makes a fresh `initPromise`. Never hoist the store import to file scope.

**Warning signs:** the second test in a file asserts against the first test's document; tests pass
individually and fail in sequence, or vice versa.

### Pitfall 3: Echo suppression is *not* identity before the first local write

**What goes wrong:** asserting `expect(getPageRegistry()).toBe(before)` after an inbound change that
carries the *same* document fails before any local write has happened.

**Why it happens:** the guard is `if (lastSent !== null && lastSent === asString) return true;`
(`pages.svelte.ts:197`, identical in `templates.svelte.ts:132`, `registry.svelte.js:114`,
`formulas.svelte.js:62`). `lastSent` starts `null`, so the first inbound change is always applied —
`setPageRegistry(parsed)` stores a **fresh parse object** (content-equal, identity-different).

**How to avoid:** split the assertion in two. Before the first write: `not.toBe(before)` **and**
`toEqual(before)`. After a local write has set `lastSent`: `toBe(mine)` (identity — nothing was re-seated).

**Warning signs:** "expected … to be … // serializes to the same string" — Vitest's own hint that only
identity differs. This exact failure appeared in the probe and is recorded in `Code Examples`.

### Pitfall 4: A disconnected `setState` *resolves* — so failure tests can pass for the wrong reason

**What goes wrong:** a test that drops the connection and then asserts "the save failed" via the promise
chain will observe a *success*.

**Why it happens:** `emitAsync` returns `void 0` when not connected
(`ioBrokerConnect.svelte.js:364-369`), and `setState` is `async … return emitAsync("setState", …)`
(`ioBrokerConnect.svelte.js:510-520`) — so `setState(...)` resolves with `undefined`. `.then()` runs, and
`.catch()` never does. `pages.svelte.ts:118-121` guards against exactly this ("A disconnected socket
resolves `emitAsync` without sending anything, so a write would look successful while the broker never
saw it (review I1)").

**How to avoid:** assert the **guard's observable** — `getLayoutSaveFailed() === true` and
`writes.length === 0` — not the promise. And when adding the PERSIST-02 retry, make sure the retry does
not reintroduce reliance on the promise's settlement.

**Warning signs:** a test asserting `saveFailed === false` after a "failed" write; a mock whose
`setState` rejects while the real one would resolve.

### Pitfall 5: Windows CRLF — never compare working-tree bytes to git blobs

**What goes wrong:** a drift guard that byte-compares the working `www/` against `git show HEAD:www/…`
reports drift on a clean tree.

**Why it happens:** `git config core.autocrlf` is **`true`** in this checkout and the repo has **no
`.gitattributes`** — git stores LF and checks out CRLF, so the blob and the file differ on every line.
`git` emits the warning itself (`"LF will be replaced by CRLF the next time Git touches it"`).

**How to avoid:** prefer the fingerprint design (Pattern 3), which reads only the working tree. If a
git comparison is ever used, normalise line endings first (`\r\n` → `\n`).

**Warning signs:** a guard that fails on `main` with a clean checkout.

### Pitfall 6: CI builds *before* it runs unit tests — a post-build guard is blind

**What goes wrong:** a drift check wired as `postbuild` or as a Vitest test looks correct locally and
does nothing in CI.

**Why it happens:** `ioBroker/testing-action-adapter@v1` runs, in order: `npm ci` → **`npm run build`**
(when `build: true`, which this workflow sets) → `extra-tests` → **`npm run test:unit`** →
`npm run test:integration`. By the time any test runs, `www/` has already been rebuilt from `src/`, so
"committed vs fresh" is indistinguishable. `testing-action-check@v2` runs `npm ci` → type check → lint →
`npm run test:package` and **does not build at all** — a cheaper place to observe the committed state.

**How to avoid:** put the PERSIST-05 check in the **`prebuild`** hook so it fires on the
action's `npm run build` step, before the output is overwritten. Optionally also add
`extra-tests: node scripts/www-drift.mjs` to the workflow (it still runs post-build, so it is a
developer-nudge, not the gate).

**Warning signs:** the guard passes in CI on a commit whose `www/` is visibly stale.

### Pitfall 7: `main.js` cannot load TypeScript, and new files are not shipped by default

**What goes wrong:** extracting the migration helper into `src/lib/config/adapter-migrate.ts` — the
location `.planning/codebase/TESTING.md` recommends — produces a `MODULE_NOT_FOUND` at adapter start
and a silently-incomplete npm tarball.

**Why it happens:** two independent facts. (a) `main.js` is plain CommonJS run directly by
js-controller (`package.json:63`, `"main": "main.js"`); Node cannot `require` a `.ts` file and there is
no build step for it. (b) `package.json:64-71` ships only `admin/`, `www/`, `io-package.json`, `LICENSE`,
`README.md`, `main.js` — a helper in `lib/` is invisible to the tarball unless added to `files`.

**How to avoid:** helper as `.js`/CJS outside `src/`, required by `main.js`, listed in `files`, and
imported by the Vitest test through a relative path. `test/integration.js` runs from the *repo*, not the
tarball, so it will **not** catch a missing `files` entry — check it deliberately.

**Warning signs:** `npm test` green locally but `npm run pack` produces a tarball whose `main.js` throws
on a real broker; `test:package` (46 checks) stays green because it only validates the files it knows.

### Pitfall 8: `formulas` writes on an *empty or unreadable* read — the guard `pageList` got, it never got

**What goes wrong:** a test asserting "an unreadable document is never overwritten" for all four stores
fails for `formulaList`, and the failure is a genuine data-safety gap, not a test bug.

**Why it happens:** `formulas.svelte.js:66-72` — `const lib = migrateLibrary(st.value); if (lib.formulas.length) … else { setFormulaLibrary(seedLibrary()); saveFormulas(); }`. `migrateLibrary`
returns `formulas: []` for garbage (it JSON-parses in a `try`, and on failure sets `val = null` —
`src/lib/config/formulas.ts:90-119`), so an **unparsable** `formulaList` is seeded *and written back*.
That is the same class of defect as the incident that overwrote the migrated documents twice
(handoff 2026-10-22, "Incidents to know about"). `registry.svelte.js` is safer: it only applies a
parsed registry and never seeds.

**How to avoid:** decide the scope **before** writing the tests. Either (a) prove-and-document the
current asymmetry (CONTEXT: "Phase 1 **proves** this … it does not build it"), or (b) add the same
load-kind guard to `formulas`. Raising it as an open question is mandatory either way; a test that
silently encodes the gap is worse than no test.

**Warning signs:** the PERSIST-03 test for formulas starts wanting to assert "no write on an unreadable
read" and cannot.

### Pitfall 9: `saveFailed` exists for only two of the four documents

**What goes wrong:** PERSIST-03's "failure handling" is asserted uniformly across `pages`, `templates`,
`formulas`, `sheet` and only two of them have a failure *state*.

**Why it happens:** `getLayoutSaveFailed()` (`pages.svelte.ts:82-84`) and `getTemplateSaveFailed()`
(`templates.svelte.ts:42-44`) are the only two. `saveFormulas` (`formulas.svelte.js:34-43`) and
`saveRegistry` (`registry.svelte.js:82-94`) have **no** `connected` guard and **no** failure flag;
`saveRegistry` even logs `"[registry] setState OK"` in `.then()` — which, per Pitfall 4, fires even when
nothing was sent.

**How to avoid:** write each store's failure test against what that store actually exposes (a flag for
pages/templates; "the error is logged and the write is dropped" for formulas/registry) and record the
difference. Do not silently widen PERSIST-02's "shows 'not saved' in the editor" beyond the editor.

**Warning signs:** a plan task that says "add failure handling to all four stores" — that is new
behaviour, and CONTEXT scopes this phase to proof.

### Pitfall 10: A naive `www/` diff always reports drift

**What goes wrong:** a guard that hashes or diffs the committed `www/` against a fresh build reports
drift on an unchanged tree.

**Why it happens:** with the default `version.name`, every build embeds a new `Date.now()` timestamp into
`_app/version.json`, `index.html` and `service-worker.js`; the inlined bundle chunk's content-hash
filename moves with it too (`bundle.BkS3BnI9.js` → `bundle._yCq9_2B.js`). Measured: 8 differing
characters × 8 occurrences in `index.html`, 1 line in `service-worker.js`, the whole of `version.json`.

**How to avoid:** make `version.name` deterministic first (Pattern 3). Then the build is byte-reproducible
and no normalization is needed. If the planner keeps the timestamp, three regexes are required —
`\d{13}`, `__sveltekit_[a-z0-9]+`, `bundle\.[A-Za-z0-9_-]{8}\.js` — and a SvelteKit upgrade can
invalidate them silently.

**Warning signs:** the guard's failure message cannot be distinguished from real drift; a first CI run
that is red on an untouched branch.

## Code Examples

### The verified store harness (5/5 green, then deleted)

```ts
// Source: a throwaway probe run in this session against src/lib/stores/pages.svelte.ts.
// Verbatim working shape — the planner should start from this file skeleton.
import { it, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const writes: Array<{ id: string; val: unknown }> = [];
  const ioBroker: any = {
    connected: 1,
    objects: { get: () => undefined, size: 0 },
    enums: { getList: () => [{ _id: "enum.rooms.x", common: { name: "X" } }] },
    wait: () => Promise.resolve(),
    getObject: () => Promise.resolve(null),
    emitAsync: () => Promise.resolve(),
    getState: () => Promise.resolve(null),
    setState: (id: string, val: unknown) => {
      writes.push({ id, val });
      return Promise.resolve();
    },
  };
  return { ioBroker, writes };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: h.ioBroker }));

const doc = { version: 1, updatedAt: 1, pages: [{ id: "p", title: "P", groups: [] }] };

afterEach(() => {
  vi.useRealTimers();
  h.writes.length = 0;
  h.ioBroker.connected = 1;
  h.ioBroker.getState = () => Promise.resolve(null);
});

// ---- PERSIST-01: an absent read refuses every write -------------------------
it("refuses every write when the document was absent", async () => {
  vi.resetModules();
  const mod = await import("$lib/stores/pages.svelte.ts");
  await mod.initPages();
  expect(mod.isLayoutWritable()).toBe(false);
  expect(mod.commitLayout(doc)).toBe(false);
  expect(h.writes).toEqual([]);
});

// ---- PERSIST-01: an unparsable read refuses every write ---------------------
it("refuses every write when the document is unparsable", async () => {
  vi.resetModules();
  h.ioBroker.getState = () => Promise.resolve({ value: "{not json" });
  const mod = await import("$lib/stores/pages.svelte.ts");
  await mod.initPages();
  expect(mod.isLayoutWritable()).toBe(false);
  expect(mod.commitLayout(doc)).toBe(false);
  expect(h.writes).toEqual([]);
});

// ---- PERSIST-03: debounce, then exactly one write ---------------------------
it("debounces, then writes once with the serialized document", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  h.ioBroker.getState = () =>
    Promise.resolve({ value: JSON.stringify(doc), onUpdate: undefined });
  const mod = await import("$lib/stores/pages.svelte.ts");
  await mod.initPages();
  expect(mod.isLayoutWritable()).toBe(true);
  mod.commitLayout({ ...doc, updatedAt: 2 });
  expect(h.writes).toEqual([]);                       // nothing before the debounce elapses
  await vi.advanceTimersByTimeAsync(250);
  expect(h.writes.length).toBe(1);
  expect(h.writes[0].id).toBe("ihome.0.config.pageList");
  expect(JSON.parse(h.writes[0].val as string).updatedAt).toBe(2);
});

// ---- PERSIST-02 (today's behaviour): the edit is DROPPED --------------------
it("drops the edit and reports failure when disconnected at flush time", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  h.ioBroker.getState = () =>
    Promise.resolve({ value: JSON.stringify(doc), onUpdate: undefined });
  const mod = await import("$lib/stores/pages.svelte.ts");
  await mod.initPages();
  h.ioBroker.connected = 0;                           // socket drops inside the window
  mod.commitLayout({ ...doc, updatedAt: 3 });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.writes).toEqual([]);
  expect(mod.getLayoutSaveFailed()).toBe(true);
});

// ---- PERSIST-03: inbound apply + echo suppression ---------------------------
it("applies an inbound change but suppresses its own echo", async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const state: any = { value: JSON.stringify(doc) };
  h.ioBroker.getState = () => Promise.resolve(state);
  const mod = await import("$lib/stores/pages.svelte.ts");
  await mod.initPages();
  expect(typeof state.onUpdate).toBe("function");

  // Before the first local write `lastSent === null`, so an identical inbound
  // change is re-seated: content-equal, identity-different.  ← Pitfall 3
  const before = mod.getPageRegistry();
  state.onUpdate(null, { val: JSON.stringify(doc) });
  expect(mod.getPageRegistry()).not.toBe(before);
  expect(mod.getPageRegistry()).toEqual(before);

  const inbound = { version: 1, updatedAt: 9, pages: [{ id: "other", title: "Other", groups: [] }] };
  state.onUpdate(null, { val: JSON.stringify(inbound) });
  expect(mod.getPageRegistry().pages[0].id).toBe("other");   // D-04: applied immediately

  // Own echo: a local write, then the broker replaying it back.
  mod.commitLayout({ ...inbound, updatedAt: 10 });
  await vi.advanceTimersByTimeAsync(250);
  expect(h.writes.length).toBe(1);
  const mine = mod.getPageRegistry();
  state.onUpdate(null, { val: h.writes[0].val });
  expect(mod.getPageRegistry()).toBe(mine);                  // identity: nothing re-seated
});
```

The same skeleton drives the other three stores with these substitutions:

| Store | module | state id | read-kind accessor | failure accessor |
|-------|--------|----------|--------------------|------------------|
| `deviceList` | `$lib/registry.svelte.js` | `ihome.0.config.deviceList` (`DEVICE_LIST_ID`, `stores/devices.svelte.ts:15`) | none — `parseRegistry` success is the only gate | none |
| `pageList` | `$lib/stores/pages.svelte.ts` | `ihome.0.config.pageList` (`PAGE_LIST_ID:33`) | `isLayoutWritable()` | `getLayoutSaveFailed()` |
| `templateList` | `$lib/stores/templates.svelte.ts` | `ihome.0.config.templateList` (`TEMPLATE_LIST_ID:10`) | `isTemplatesWritable()` | `getTemplateSaveFailed()` |
| `formulaList` | `$lib/formulas.svelte.js` | `ihome.0.config.formulaList` (`FORMULA_LIST_ID`, `stores/formulas.svelte.ts:3`) | none — seeds and saves (Pitfall 8) | none |

Note `registry.svelte.js` and `formulas.svelte.js` also call `loadUsedStates()` / `migrateRegistry()` on
the inbound path, so their fake needs shapes that make those no-ops — the probe's
`objects: { get: () => undefined, size: 0 }` plus an empty device registry *should* be sufficient,
because `loadUsedStates` filters against `getUsedStateIds()`. **This is an expectation, not a verified
result:** the probe exercised `pages.svelte.ts` only, so the two `.js` stores must be stood up once and
confirmed before the other test files are written on top of the same fake.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Date.now()`-timestamp `version.name` (SvelteKit default) | A deterministic `version.name` (`hash(kit.version.name)` drives the app prefix and the chunk hash) | SvelteKit has documented the requirement for several majors; this repo still uses the default | Build becomes byte-reproducible; a drift guard stops needing regex normalization |
| `vi.mock` factories closing over module-scope `const`s (fails — factories are hoisted) | `vi.hoisted()` for shared mutable fake state | Vitest 0.31+ (present in 4.1.11) | Makes `vi.resetModules()` + dynamic `import()` viable for singleton-coupled stores |
| Store state reset by adding test-only setters (`setCanonicalRegistry`, `setObjectSource`) | `vi.resetModules()` + re-`import` where no setter exists | Vitest 4 module-registry semantics | Covers stores that deliberately expose no setter (`pages`, `templates`) |
| `mode: "once"` adapter that exits after the migration | unchanged this phase | — | Criteria 1–3 must be observed across a **manual** adapter start (`Instances → play`), not a running process |
| Committed `www/` with no guard | Committed `www/` + fingerprint guard (this phase) | — | Closes the "shipped UI differs from reviewed source" concern in `CONCERNS.md` |

**Deprecated/outdated:**
- Anything that relies on the SvelteKit build being nondeterministic: the timestamp in `_app/version.json`
  is not a stable identifier, and the handoff's "`version.json` parity" deploy check (INSTALL-04) keeps
  working with a source fingerprint but *silently becomes vacuous* if the version is frozen to a constant.
  Choose a **source-derived** fingerprint, not a literal.
- `src/lib/iosocket`-era assumptions: `src/lib/iobroker.socket.io.js` is a hand-vendored client
  (`@ts-nocheck`, not a dependency) — irrelevant here, but do not expect `npm audit` or types to cover it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `CI` is set to `"true"` by GitHub Actions in the composite action's bash steps, so the guard can warn locally and fail in CI from one script | Pattern 3, Anti-Patterns | If false, the guard either never blocks CI (warn everywhere) or blocks every local build after a `src` edit. **Verify with one line of `echo $CI` in a workflow step before relying on it, or invert the default (fail everywhere) and accept a noisy local build.** |
| A2 | The live broker `192.168.178.9` stays reachable for the manual criteria 1–3 | Environment Availability | Criteria 1–3 cannot be verified; the phase's UAT step must be deferred, and the plan needs a fallback (a second local js-controller). |
| A3 | `kit.version.name` may be any string without breaking the deploy/version-parity check (INSTALL-04) or runtime update handling | Pattern 3, State of the Art | `pollInterval: 0` already disables runtime version polling, so the exposure is the deploy check and SvelteKit's error-recovery full-page navigation — both keep working with a source fingerprint. **Product-level confirmation is still owed.** |
| A4 | PERSIST-03's "`sheet`" write path means the layout sheet's writes through `commitLayout`, because `src/lib/stores/sheet.svelte.ts` persists nothing | Phase Requirements, Pitfall 9 | If the requirement means a *separate* sheet document, the phase is missing a store that does not exist — see Open Question 2. |
| A5 | Test files under `src/**` are not part of the bundle, so excluding `**/*.test.ts` from the build fingerprint is correct | Pattern 3, Anti-Patterns | If a test file did enter the bundle, the fingerprint would miss a real build change. Verified indirectly: the current build's only JS is inlined from `src/routes`, and adding a unit test has never altered `www/`. |
| A6 | The store tests can rely on `$lib/stores/devices.svelte.ts` being import-safe under the mocked socket (it takes its caches by injection and imports no socket module) | Pattern 1 | If wrong, `pages.svelte.ts`'s import of `registerProgramStateId` would pull a second socket consumer into the test. The probe imported `pages.svelte.ts` (which imports it) successfully, so this held. |

## Open Questions

1. **Does PERSIST-01's "an absent or unparsable document" cover all four documents, or `pageList` only?**
   - What we know: success criterion 1 names `ihome.0.config.pageList`; PERSIST-01's wording says "a
     document" and describes "the seeded display". Only `pageList` has a write guard. `formulaList`
     actively writes on an unreadable read (Pitfall 8); `deviceList` neither seeds nor writes on a bad
     read; `templateList` has a guard but no seed.
   - What's unclear: whether proving the asymmetry is enough, or whether PERSIST-01 obliges fixing
     `formulas` too.
   - Recommendation: **prove the guard for `pageList`** (that is what the criterion measures), and
     **write the `formulas` behaviour down as an explicit test asserting the current outcome plus a
     recorded follow-up** — that is a proof, not a silent acceptance. If the user wants the guard
     extended, it is a small change (a load-kind flag mirroring `templatesLoadKind`) and should be its
     own task.

2. **What is PERSIST-03's `sheet` write path?**
   - What we know: `src/lib/stores/sheet.svelte.ts` is 16 lines of open/close UI state with no
     persistence; the layout sheet writes documents exclusively through `commitLayout`
     (`LayoutSheet.svelte` calls it at lines 263, 285, 312, 336, 338, 389, 424, 444, 478, 488, 508,
     551, 562, 579, 596, 725) and through `saveRegistry` (lines 180, 197).
   - What's unclear: whether "sheet" is shorthand for the sheet's write path (→ already covered by the
     `pages` test) or a fifth document that does not exist.
   - Recommendation: treat "sheet" as the sheet→`commitLayout` path; add one test that calls
     `commitLayout` the way the sheet does (a refusal case through the sheet's entry point is already
     the `pages` refusal test) and note the interpretation in the plan.

3. **Does the failed edit get queued, or re-sent from live state on reconnect?**
   - What we know: `savePages` serialises the **whole** registry on every flush
     (`pages.svelte.ts:114`), so "the edit reaches the broker on the *next change*" already holds by
     construction — the next commit re-sends everything. What does not exist is any **reconnect** path.
   - What's unclear: whether to queue the failed snapshot or simply retry the current registry on a
     timer, and where "not saved" surfaces beyond the sheet's existing banner.
   - Recommendation: a self-contained retry in the store (a scheduled re-flush while `saveFailed`), since
     it is testable with the fake-timer harness and needs no component coupling. The alternative — an
     exported `flushPendingSave()` called from the `$effect` that already watches
     `ioBroker.connected` in `+layout.svelte:74-102` — is also viable but moves a store concern into a
     component.

4. **Where exactly should the fingerprint function live?**
   - What we know: `vite.config.mjs` must compute it (to become `version.name`) and
     `scripts/www-drift.mjs` must recompute it (to check). Two copies will drift.
   - Recommendation: one module, e.g. `scripts/build-fingerprint.mjs`, imported by both. Note that
     `vite.config.mjs` is ESM (`.mjs`) and so is the script, so the import is clean — but it must not
     live under `src/`, or `svelte-check` will type-check a build script as app code.

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` (the file does not exist), so
> this section is included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (unit, `environment: "node"`); mocha 12.0.3 + `@iobroker/testing` 6.3.1 (package/integration) |
| Config file | `vite.config.mjs` `test` block (lines 51-57) — no separate `vitest.config.*`, no setup files, no globals |
| Quick run command | `npx vitest run src/lib/stores/pages.svelte.test.ts` |
| Full suite command | `npm test` (`test:unit` → `test:package` → `test:integration`) |
| Verified baseline | `npx vitest run` → **33 files / 391 tests passed**, 1.94 s · `npm run test:package` → **46 passing** (both re-run this session after the probe was removed) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PERSIST-01 | Absent read → `isLayoutWritable()` false, `commitLayout` returns false, zero `setState` | unit | `npx vitest run src/lib/stores/pages.svelte.test.ts -t "absent"` | ❌ Wave 0 |
| PERSIST-01 | Unparsable read → same refusals, document left in memory | unit | `npx vitest run src/lib/stores/pages.svelte.test.ts -t "unparsable"` | ❌ Wave 0 |
| PERSIST-01 (manual) | Delete/corrupt `ihome.0.config.pageList` on the broker; open the dashboard; the seeded display shows and the state is byte-identical after | manual-only — needs a real socket + browser; no in-repo automation path | (operator step; confirm via the broker's Objects tab before/after) | ❌ — manual by design |
| PERSIST-02 | Disconnected flush → `getLayoutSaveFailed()` true, zero writes | unit | `npx vitest run src/lib/stores/pages.svelte.test.ts -t "disconnected"` | ❌ Wave 0 |
| PERSIST-02 | After reconnect the pending edit lands; `lastSent` bookkeeping keeps echo suppression intact | unit | `npx vitest run src/lib/stores/pages.svelte.test.ts -t "reconnect"` | ❌ Wave 0 |
| PERSIST-02 (manual) | Stop the broker mid-edit → "not saved" in the sheet; restart → the edit lands; stored doc = last successful save, never empty | manual-only (real socket drop) | (operator step) | ❌ — manual by design |
| PERSIST-03 | `pages`: refusal before load, debounce, echo suppression, failure | unit | `npx vitest run src/lib/stores/pages.svelte.test.ts` | ❌ Wave 0 |
| PERSIST-03 | `templates`: same four behaviours (`isTemplatesWritable`, `getTemplateSaveFailed`) | unit | `npx vitest run src/lib/stores/templates.svelte.test.ts` | ❌ Wave 0 |
| PERSIST-03 | `formulas`: inbound apply + echo suppression + debounce; failure is "logged, not flagged" (Pitfall 9) | unit | `npx vitest run src/lib/formulas.svelte.test.ts` | ❌ Wave 0 |
| PERSIST-03 | `deviceList`: inbound apply + echo suppression + debounce; unparsable read leaves the registry alone | unit | `npx vitest run src/lib/registry.svelte.test.ts` | ❌ Wave 0 |
| PERSIST-04 | Tile-less seed counts as empty; a tile-bearing document never does | unit | `npx vitest run src/lib/config/adapter-migrate.test.ts -t "placeholder"` | ❌ Wave 0 |
| PERSIST-04 | Legacy copied when `config.*` is empty; legacy never deleted while `config.*` is empty | unit | `npx vitest run src/lib/config/adapter-migrate.test.ts -t "legacy"` | ❌ Wave 0 |
| PERSIST-04 (manual) | Start `ihome.0` against a broker holding only legacy documents; real documents appear in `config.*`, legacy states intact | manual-only — requires an adapter start (`Instances → play`) | `npm run test:integration` covers *start*, not the copy outcome | ❌ — manual by design |
| PERSIST-05 | Committed `www/` fingerprint == `src/` fingerprint | unit or build-hook | `node scripts/www-drift.mjs` (and `npm test` if wired as a test) | ❌ Wave 0 |
| PERSIST-05 | The build path reports drift (CI fails, local warns) | build hook | `npm run build` on a deliberately stale tree | ❌ Wave 0 |
| Regression net | Every existing test still passes | unit + package | `npm test` | ✅ 33 files / 391 tests + 46 package checks |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (≈2 s) — plus `npx vitest run <the file you touched>` while iterating.
- **Per wave merge:** `npm run test:unit && npm run test:package` (≈3 s), and `npm run lint && npm run check` (the repo's stated rule is that every change passes `lint`, `check` and `test`).
- **Phase gate:** `npm test` green (unit + package + integration) before `/gsd-verify-work`, plus the three manual broker observations above.

### Wave 0 Gaps

- [ ] `src/lib/stores/pages.svelte.test.ts` — PERSIST-01, PERSIST-02, PERSIST-03 (pageList); carries the harness every other store test copies
- [ ] `src/lib/stores/templates.svelte.test.ts` — PERSIST-03 (templateList)
- [ ] `src/lib/formulas.svelte.test.ts` — PERSIST-03 (formulaList)
- [ ] `src/lib/registry.svelte.test.ts` — PERSIST-03 (deviceList)
- [ ] `lib/adapter-migrate.js` (+ `package.json` `files` entry) — PERSIST-04 helper
- [ ] `src/lib/config/adapter-migrate.test.ts` — PERSIST-04 test
- [ ] `scripts/www-drift.mjs` (+ shared fingerprint module) — PERSIST-05 check
- [ ] `vite.config.mjs` — deterministic `version.name`
- [ ] `package.json` — the `prebuild` hook (and `files` if `lib/` is added)
- [ ] No framework install needed: Vitest 4.1.11 and mocha 12.0.3 are present; `expect.requireAssertions` is already on, so **every new test must contain at least one assertion** or it fails.

*(No shared fixtures module is needed — the repo's convention is a top-of-file factory per test file.)*

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` (the file does not exist) → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture / trust boundaries | yes | Document authorship is privileged (ioBroker ACL decides who can write `ihome.0.config.*`); this phase's tests lock in "never overwrite what you could not read", which is the *availability/integrity* half of that boundary. Keep the statement in `docs/` as `CONCERNS.md` recommends. |
| V2 Authentication | no | No app-level auth by design (`PROJECT.md` §Out of Scope); the broker/`web` adapter owns access. |
| V3 Session Management | no | — |
| V4 Access Control | no (this phase) | Per-user security is explicitly deferred to post-v1. |
| V5 Input Validation | **yes** | The per-document shape validators (`parsePageRegistry`, `parseTemplateRegistry`, `parseRegistry`, `migrateLibrary`) are the control. This phase's tests must assert that invalid input is **rejected without a write** — that is the requirement, and it is also what stops the validator's absence from becoming data loss. |
| V6 Cryptography | **yes (marginal)** | The only crypto introduced is `node:crypto` `createHash("sha256")` for the build fingerprint. Never hand-roll a hash; SHA-256 for a non-adversarial integrity check is appropriate and is not used for secrecy. |
| V7 Error handling & logging | yes | The `saveFailed` flag and the refusal `console.error` paths must be asserted, not assumed (Pitfall 4). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unreadable/absent state read → empty document written back (data destruction) | Denial of Service / Tampering | Guarded write (`mayWritePages`) + a test asserting zero `setState` on an absent/unparsable read. **This literally happened twice** (handoff 2026-10-22, "Incidents to know about"). |
| Second tab / second client silently overwriting a newer document | Tampering | **Accepted** (`D-03`): the later `setState` wins inside the ~250 ms debounce window. Document it as a product limit; do not let the research imply it is mitigated. |
| `new Function` evaluation of document expressions (`transform-ops.ts:10-11`, `virtual-ops.ts:118-127`) | Elevation of Privilege | Out of scope for Phase 1; the boundary is "anyone who can write the states". Do not weaken it by adding any new write path — in particular, do not introduce a *new* writer for a document that lacks a guard (Pitfall 8). |
| Committed build output diverging from reviewed source | Tampering | PERSIST-05's fingerprint guard. Ship-what-you-reviewed. |
| Secrets in the deploy script | Information Disclosure | Unchanged: `IOBROKER_MCP` is env-only; `www-drift.mjs` must read no credentials (stdlib file I/O only). |

## Sources

### Primary (HIGH confidence)

- `src/lib/config/pages-ops.ts:381-395` — the `LoadedPages` union and `mayWritePages` (read verbatim this session)
- `src/lib/stores/pages.svelte.ts:82-93, 112-133, 140-161, 170-219` — the save guard, the debounce, the disconnect drop, the inbound handler (read verbatim)
- `src/lib/stores/templates.svelte.ts:34-50, 69-106, 128-149` — the second guarded document (read verbatim)
- `src/lib/registry.svelte.js:82-94, 96-142` and `src/lib/formulas.svelte.js:34-43, 45-72` — the two unguarded documents (read verbatim)
- `main.js:22-32, 44-82` — `isPlaceholder` and the `onReady` copy/delete decision (read verbatim)
- `src/lib/ioBrokerConnect.svelte.js:360-369, 510-520` — `emitAsync` returns `void 0` when disconnected; `setState` wraps it (read verbatim)
- `src/lib/components/layout/LayoutSheet.svelte:83, 86, 360-369` — the existing "not saved" / "not editable" badges (read verbatim)
- `node_modules/@sveltejs/kit/src/exports/vite/index.js:247` — `const version_hash = hash(kit.version.name);` (read verbatim)
- `node_modules/@sveltejs/kit/types/index.d.ts:884-893` — `version.name` "must be deterministic … otherwise defaults to a timestamp of the build" (read verbatim)
- `vite.config.mjs:29-35, 51-57` · `package.json:25-27, 63-71, 72-86` — the build config, the test include, `files`, `engines`, scripts (read verbatim)
- `https://raw.githubusercontent.com/ioBroker/testing-action-adapter/master/action.yml` — the CI step order: install → build → extra-tests → unit → integration (fetched this session)
- `https://raw.githubusercontent.com/ioBroker/testing-action-check/master/action.yml` — install → type check → lint → `test:package`, and `type-checking` defaults to `false` while this workflow only sets `lint: true` (fetched this session)
- **Empirical runs this session:** the 5/5 store-harness probe; two builds with a fixed `version.name` byte-for-byte identical; the `version.name` cross-check isolating exactly 3 changed files; `npx vitest run` 33/391; `npm run test:package` 46 passing; `node --version` v24.22.1; `git config core.autocrlf` = true; broker probe `HTTP 200`

### Secondary (MEDIUM confidence)

- `.planning/codebase/TESTING.md` and `.planning/codebase/CONCERNS.md` (mapped at `7af86a1`) — baseline counts, conventions, gap priorities
- `docs/progress/handoff-2026-10-22-iobroker-visual-adapter.md` — the two overwrite incidents, the live broker's contents, the gates

### Tertiary (LOW confidence)

- None. Every claim above is either read from a source-of-truth file this session, fetched from an
  authoritative action definition, or produced by a command run this session.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no packages are added; every version was read from the working tree or run.
- Architecture: **HIGH** — the guard, the debounce, the disconnect drop, the echo suppression and the adapter migration were all read verbatim, and the test harness that exercises them was executed.
- Pitfalls: **HIGH** — Pitfalls 1–4 and 10 are backed by failures or hangs observed in this session's probe and builds; 5–9 are backed by verbatim reads plus the CI action definitions.
- Drift-guard mechanism (PERSIST-05): **HIGH on the facts, MEDIUM on the product decision** — `hash(kit.version.name)` and the byte-reproducibility were both verified, but changing `version.name`'s semantics is a product choice (A3).
- Criteria 1–3: **MEDIUM** — they are manual and depend on a live broker (A2).

**Research seams unavailable:** `gsd-tools.cjs` / `gsd_run` are not present in this environment (no
`gsd-core/bin`, nothing on `PATH`), so the `research-plan`, `classify-confidence`,
`research-store` and `package-legitimacy` seams could not be invoked. Confidence tiers above were
assigned by hand from the source hierarchy, and the Package Legitimacy Audit reports the evaluated-but-
empty result rather than a tool verdict.

**Research date:** 2026-10-22
**Valid until:** 2026-11-21 (30 days) for the store/migration work; **re-verify the SvelteKit
`version.name` findings if `@sveltejs/kit` is upgraded** (currently 2.70.3) — `hash(kit.version.name)`
at `src/exports/vite/index.js:247` is an internal implementation detail, not a public contract, so a
major bump could change how the app prefix is derived. The *fallback* (rebuild-and-diff with the three
normalization patterns in Pitfall 10) does not depend on it, and neither does the fingerprint check
itself once `version.name` is set explicitly, because SvelteKit writes the configured string verbatim
into `_app/version.json` (verified: `{"version":"probe-fixed"}`).
