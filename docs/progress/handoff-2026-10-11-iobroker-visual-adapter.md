# Handoff — ioBroker Visual Interface adapter

**Date:** 2026-10-11
**Project:** `C:\Users\franz\OneDrive\MyProgs\KI\iobroker-visual-adapter`
**Session focus:** Built two features — **virtual states** and **reusable formula
templates** — plus device-edit/device-list polish. User smoke-tested the dew-point case
in the browser; it works.

## State of the codebase

- **Now a git repo** (was not before). Branch `main`, **no remote** (no GitHub/GitLab).
  Repo-local identity: `Commander <commander@example.com>`.
- `.gitignore` excludes `node_modules/`, `.svelte-kit/`, `www/`, `.playwright-mcp/`,
  `graphify-out/`.
- Working tree clean. Everything is merged to `main`.
- Specs/plans (docs/superpowers):
  - `specs/2026-10-10-virtual-states-design.md` + `plans/2026-10-10-virtual-states.md`
  - `specs/2026-10-10-formula-templates-design.md` + `plans/2026-10-10-formula-templates.md`
- The knowledge graph is current (`graphify update .` was run); regenerate after edits.

## What was built this session

### 1. Virtual states (read-only computed/aggregate controls)
- `Control.kind?: "state" | "virtual"` (absent ⇒ state). A virtual control stores
  `virtual: { expr, precision? }` and has no `stateId`.
- Engine `src/lib/config/virtual-ops.ts`: `sanitizeLabel`, `buildScope` (locals = the
  device's state controls by sanitized label + helper API), `computeVirtual`,
  `evaluateVirtual` (`new Function`, never throws), `roundValue`, `newLocalTaken`.
  Helpers over the device-state pool: `values / count / sum / avg / min / max / any / all /
  get / device`; filter = `{ role, room, device, feature, label }`.
- Enrichment `src/lib/stores/devices.svelte.ts`: builds the pool, computes
  `liveValue`/`virtualError`/`widget` for virtual controls; exports `getVirtualPool()`.
- `project.ts` persists `kind`/`virtual`. Dashboard `src/routes/+page.svelte` renders the
  value + an error marker.
- Modal editor `src/lib/components/config/VirtualEditor.svelte`: expression textarea,
  variables legend, helpers reference, live test (precision + unit), **Cancel | Save**
  (edits a local draft).

### 2. Formula templates (named, reusable)
- `FormulaTemplate`/`FormulaLibrary` types; `Control.formulaId?` (provenance, kept while
  unmodified).
- Pure helpers `src/lib/config/formulas.ts`: `SEED_TEMPLATES` (5 — dew point uses the real
  Magnus formula), `seedLibrary`, `applyTemplate`, `syncFormulaId`, `detachTemplate`,
  `migrateLibrary`.
- Storage `src/lib/formulas.svelte.js` (mirrors `registry.svelte.js`) + store
  `src/lib/stores/formulas.svelte.ts`. State ID
  `0_userdata.0.Test.AiHome.formulaList` (created/seeded on first connect).
- `initFormulas()` wired in `src/routes/+layout.svelte` `onMount` beside `initRegistry()`.
- **Settings** (`src/routes/settings/+page.svelte`): Formula templates CRUD.
- Modal template picker: pick → copies expr/precision/unit + links; dynamic action button
  reads **Save as new template** / **Update template** / disabled; **— custom —** detaches.

### 3. Device edit / list polish
- `DeviceForm.svelte`: **Section/Panel/Icon inputs removed** (model fields kept for a
  future hierarchical display UI).
- `ControlRow.svelte`: **removed the State/Virtual and feature selectors** (kind is fixed
  at creation; feature is auto-assigned via `suggestFeature`). A **STATE/FORMULA badge**
  replaces the selector; virtual rows show the **formula (truncated)** + **live value** +
  a **pencil** edit button; **Unit** field restored for virtual controls.
- `src/routes/devices/+page.svelte`: the list shows **`Label: value unit`** per control
  (from the enriched store), replacing the `N controls` count.
- Removed the now-dead `src/lib/config/control-kind.ts` (+ test).

## Verification (all green)

```
npm test        # 143 passed (12 files)
npm run lint    # clean
npm run check   # svelte-check: 0 errors, 0 warnings
npm run build   # succeeds, writes www/
```
Manual: the user ran it against their broker; the dew-point template produced a value.

## Open items / follow-ups

- **Seed-on-empty (needs a decision):** deleting *all* templates then reloading restores
  the 5 seed examples (spec says "seed when absent/empty"). To seed only on the first-ever
  run instead, change `initFormulas` to seed only when the state value is null (not when it
  is an empty array).
- **Deferred minors (from the formula-templates review):**
  - `applyTemplate` clears a control's `unit` when the template has no unit.
  - Template `<select>` value can race if the modal mounts before templates load.
  - `onUpdate` applies `migrateLibrary` unguarded (registry guards with `if(!parsed) return`).
  - `initFormulas` gives up on a null first `getState` (no retry) — inherited from registry.
  - Settings modal title flips from "New" to "Edit" on first keystroke; the VirtualEditor
    modal lacks Esc/backdrop close; `addFormula` is exported but unused by Settings.
- **Dangling `formulaId` cleanup-on-load** was re-graded Minor: the UI treats it as custom
  and it is dropped on the next device save; a persisted cleanup pass is deferred.
- **Switch widget labels** (from the 2026-10-10 handoff, still open, low priority): the
  `switch` widget in `src/routes/+page.svelte` hardcodes `"On"/"Off"` and ignores
  `control.unit`.
- **Dead file:** `verify.js` (root) looks like a stale duplicate of `verify.cjs`; never
  confirmed, still tracked.
- **No remote** — nothing is pushed; if GitHub/GitLab is added later, push `main`.

## Environment notes

- Windows, bash shell. Prefer `C:\Users\franz\AppData\Local\Temp\opencode`.
- The user **always has the dev server running** (`npm run dev`, vite on port 5173) and
  watches edits live — do not start a competing dev server; do not drive Playwright unless
  asked (the user prefers to click themselves).
- ioBroker: reachable as host `iobroker` (IPv4 `192.168.178.9`; IPv6 also resolves). The
  app connects via the **admin port 8081** (per the user's config). `web.0` is on 8082,
  `socketio.0` on 8084 — useful for debugging connection issues (a raw `ws://…/socket.io`
  handshake to 8082/8084 fails over IPv6, but the app's configured endpoint works).
- Tests: Vitest, node env, `requireAssertions: true`; files at
  `src/**/*.{test,spec}.{js,ts}`.
- Svelte 5 runes + TypeScript only in new components; no new runtime deps.
