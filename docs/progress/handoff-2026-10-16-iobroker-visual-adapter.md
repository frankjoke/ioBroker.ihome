# Handoff — 2026-10-16 — iobroker-visual-adapter

Previous handoff: `handoff-2026-10-15-b-iobroker-visual-adapter.md` (display basics, rename/identity,
serving findings). This session was the P1 review + fix pass and a round of layout-editor polish the user
drove by watching the app.

---

## 1. Where we are

- Branch `feature/ihome-display` at **`1e186d5`**, working tree clean. No remote, nothing pushed, nothing
  merged. 30 commits since the review base `bb10915`.
- **All gates green:** `npm run check` 0 errors / 0 warnings, `npm test` **285 passed** (25 files),
  `npm run lint` **0 problems** (was 2 pre-existing errors), `npm run build` writes `www/`.
  `graphify update .` refreshed `graphify-out/`.
- Live broker `192.168.178.9` (admin 8081, web.0 8082). The display and the editor were verified live
  against the real document: **2 pages / 32 sections / 16 placements / version 1**, unchanged by any check
  this session (no broker write happened).
- P1 (the layout editor) is implemented, reviewed, fixed, and (in the reviewer's scope) still not
  *re-reviewed* — a fresh reviewer has only confirmed the findings, not the fixes.

## 2. What happened today, in order

**P1 branch review** — `bb10915..e293dd6` (19 commits), reviewer on `opencode/gpt-6-astra`, package
`.superpowers/sdd/2026-10-15-ihome-layout-editor/review-bb10915..e293dd6.diff`. Verdict: **not mergeable**
— 3 Critical, 11 Important, 4 Minor. Every Critical was the same class: **data loss on the user's live
`pageList`** (migrating from an unknown device list; junk placements accepted then rewritten to `[]` or
thrown on; writing without a successful load). Plus `crypto.randomUUID` — needs a secure context, so
creating/duplicating/migrating would have **thrown on the plain-HTTP broker**; it only ever worked because
testing happened on localhost.

**Fix pass** (red-first tests in `src/lib/config/review-fixes.test.ts`, 6 cases):

| commit | what |
| --- | --- |
| `319d2e7` | C1–C3 + I1–I7 + I10: write gate (`mayWritePages`/`isLayoutWritable`), migration refuses while no device is known + migrates from the canonical snapshot, `isPlacement` validation, the disconnected-save failure, `newId()`, one shared `effectiveSpan`, the `newLine` tile width, the bordered-section width, the `newLine` section break, `movePlacement` validation, the size fields |
| `53a3804` | the editor says "not editable" + disables Add page when the document did not load |
| `879b445` | size fields show the size the tile renders at (a 2×1 preset no longer shows 1×1) |
| `0dc3267` | the connection footer really is disconnected-only (`footerOpen` used to stick) |

**Deferred by ruling** (in the ledger, each with its cost — not dropped): I8 change-device in the pane,
I9 cross-section tile movement, I11 the picker's focus trap + the tree's keyboard contract, M1 tall-tile
occupancy in the pass, M2 deep copy on duplicate, M3 the AppBar's stale active tab.

**Cleanup the user picked** — `b0a5459`: every `crypto.randomUUID()` → `newId()` (including `pages-ops.ts`,
which the fix pass had missed), the dead `layoutEdit` + Tile edit-mode guards deleted (Ctrl/Cmd+click is
the one route to a tile's placement), 2 pre-existing lint errors fixed.

**Layout-editor polish, driven by the user watching it:**

- `a7085db` — a section adds tiles with the same `+` as a page row; the "Add tile" text line is gone. The
  section's filter hint ("N matching this section's filter are not here · Add them") is a different thing
  and stayed; it now renders only when there is a hint.
- `9313889` — dark-mode icon contrast. The tree's action buttons were the only icon buttons in the app
  with no styling of their own: they kept the browser's default button face (a light grey that never
  follows the theme) and the row faded them with `opacity: 0.35`, which blends with whatever is behind.
  Dark measured **1.8:1**; the bar's and device list's buttons instead switch `--text-muted` →
  `--text-color`. The tree does that now: **5.15:1 idle / 12.6:1 hover** dark, 6.42:1 / 17:1 light. Also
  `color-scheme` per theme in `app.css` (browser-painted controls — the pane's selects, scrollbars — were
  rendering light in dark mode).
- `f35c3f4` — hovering a row no longer lights up every icon; the row's background carries the affordance
  and only the button under the cursor goes to `--text-color`. Verified live: row hover leaves one
  distinct icon colour, button hover moves that one icon and leaves the other four muted.
- `1e186d5` — the row hover was *invisible* in dark mode: the dark palette defines `--surface-color` and
  `--surface-container` as the **same** `#1c2028`, so the hover painted the identical colour (contrast
  1.00; light was 1.12). New `--row-hover` token: light keeps its value, dark takes the page background
  (`#0f131c` on the `#1c2028` card, 1.14 — same direction and strength as light).

**Hardening found while chasing that:** `src/lib/localStorage.js` parsed stored values unguarded, so a
single corrupt entry threw during module init and took the whole app down. It now falls back to the
entry's default and repairs it.

## 3. Two live-check traps — they will cost you the same hour

1. **Don't write raw localStorage values.** The app's reactive storage (`localStorage.js` → JSON) expects
   `JSON.stringify(value)`. Writing a raw `"dark"` for `__VISUAL__:theme` throws at module init → the app
   renders SvelteKit's **"500 Internal Error"** page while `curl` still gets 200, which sends you hunting
   for a server/proxy problem. Use `JSON.stringify("dark")`. (Now guarded, but keep doing it.)
2. **The service worker answers from its precache.** The repo ships `src/service-worker.js`; a port that
   once served a *build* keeps a workbox worker there, serving cached pages (I saw a cached 500 and stale
   bundles). Use a port never used for a build, or DevTools → **Application → Service Workers → "Update on
   reload"**, or Unregister + Clear site data. This is also the explanation for the "harness keeps
   reloading" note in the earlier handoff. Note the worker has **no `skipWaiting()`/`clients.claim()`** —
   after a deploy the new worker *waits* until every tab of the app is closed.

## 4. Next session, in order

1. **P2 — the tile editor** (the next real slice): slots/values on a placement, glow/rules, a live tile
   preview rendered by the display's own components, and seeding the missing `templateList` document
   (currently `null`). The user's stated pattern: **`+` on a tile row adds a value/device to that tile**,
   same icon one level down — so the tile's `+` lands together with the slots editor, not before it.
2. The deferred rulings ride along; I8/I9 need the picker.
3. Optional small wins: `skipWaiting` + dropping the leftover debug logging in `service-worker.js`.
4. Then packaging (jsonConfig instead of the legacy `admin/index.html`, a real `main.js`, `@iobroker/testing`,
   the Adapter Checker, install on the Pi) and the repo push (`frankjoke/ioBroker.ihome`). The user's rule:
   finish a working V1 first.

## 5. Parked / unanswered

- Brunnen double-toggle (parked as device-side; the `[ihome-dbg]` tracing is still in).
- Unused `house-controller.svg`.
- Earlier open gaps, unchanged: duplicate tile titles (`Keller` ×2, `Garten-Pool` ×2), a momentary device
  (`alias.0.Keller.AbstellraumLicht.SET`) mis-typed as Light, the unused `energy` hint, `w: 2` for
  two-value thermometers, and `main.js:34-37` logging literal `${…}`.
- **Idea worth doing when the palette is next touched:** the dark palette collapses several container
  greys that are distinct in light (that is exactly what made two hovers invisible). Sweep for other token
  pairs holding the same dark value.

## 6. Key files touched today

`src/lib/config/pages-ops.ts` (migration guard, `isPlacement`, `mayWritePages`) ·
`src/lib/config/layout-ops.ts` (`movePlacement`, `newId`) · `src/lib/config/template-ops.ts`
(`effectiveSpan`) · `src/lib/config/review-fixes.test.ts` (the 6 regression tests) ·
`src/lib/utils/ids.ts` (`newId`) · `src/lib/stores/pages.svelte.ts` (write gate, load kind, offline save) ·
`src/lib/components/layout/LayoutTree.svelte` (the `+`, the icon colours, the hover) ·
`src/lib/components/layout/LayoutDetails.svelte` (the size fields) ·
`src/lib/components/display/{Tile,GroupSection,PageView}.svelte` + `src/app.css` (the flow/geometry and
theme fixes) · `src/routes/{+layout,layout/+page}.svelte` (canonical-device migration, the not-writable
state, the footer) · `src/lib/localStorage.js` (the JSON guard).
