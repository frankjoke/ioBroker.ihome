# Device Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A device shows the icon its ioBroker objects carry (resolved up the hierarchy), and every icon
URL resolves against the ioBroker host instead of the app's origin.

**Architecture:** Pure resolution in a new `icon-ops.ts` (`ownerOf`, `objectIconValue`, `resolveIcon`,
`deviceObjectIcon`) plus a base-aware `iconSrc` in `icon-url.ts`; the device enrichment carries the
resolved icon on `EnrichedDevice.objectIcon`; `Icon.svelte` is the single image renderer (tile name,
detail header, devices page, pickers, enum badges).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-ihome-device-icons-design.md` (A65–A69).

## Global Constraints

- TypeScript strict; Svelte 5 runes; no new dependencies.
- Pure logic in `src/lib/config/*` and `src/lib/utils/icon-url.ts`; components only render.
- Vitest with `expect.requireAssertions`; one commit per task; `npm test`, `npm run check`,
  `npm run lint`, `npm run build` green after each.
- The resolution rules are fixed by A65: per object `modelIcon` → `extIcon` → `icon`, nearest object
  first, then `system.adapter.<adapter>.<instance>` → `system.adapter.<adapter>`.
- Slot icons (A51) and the documents are untouched: nothing is written into a document.

## Review Focus

1. A device whose controls resolve nothing — renders exactly as today (no icon, no placeholder, no
   error).
2. A value that is a symbol name (`lightbulb`) must never be turned into a URL by the new resolution.
3. `iconSrc` with no configured `hostPort` and no DOM (`iconBase()` empty) — must still return a
   usable string, never `undefined` or `"undefined/…"`.
4. A relative icon on `enum.*` (`enum.rooms.Bad`) — best-effort path, no crash, no infinite loop in
   the parent walk.
5. A device icon that is a GitHub `extIcon` and the app served from the dev origin — the tile name,
   header and devices row must all render it (or show nothing, never a broken image icon).

---

### Task 1: `icon-ops.ts` and the base-aware `iconSrc`

**Files:**
- Create: `src/lib/config/icon-ops.ts`, `src/lib/config/icon-ops.test.ts`
- Modify: `src/lib/utils/icon-url.ts` (+ `icon-url.test.ts`)

**Interfaces:**
- Produces:
  - `ownerOf(id: string): { adapter: string; instance?: string }`
  - `objectIconValue(obj: unknown): { field: "modelIcon" | "extIcon" | "icon"; value: string } | undefined`
  - `resolveIcon(objects: Map<string, any>, id: string): { from: string; value: string } | undefined`
  - `deviceObjectIcon(objects: Map<string, any>, stateIds: (string | undefined)[]): { from: string; value: string } | undefined`
  - `iconBase(): string` — `http(s)://<hostPort>` from `localStorage["__VISUAL__:hostPort"]`, else
    `location.origin`, else `""`
  - `iconSrc(raw: string | undefined, owner?: string, base?: string): string`

- [ ] **Step 1: Write the failing tests**

`icon-ops.test.ts`: `ownerOf("alias.0.1Stock.X")` → `{adapter:"alias",instance:"0"}`;
`ownerOf("system.adapter.bambulab.0")` → `{adapter:"bambulab",instance:"0"}`;
`ownerOf("system.adapter.bambulab")` → `{adapter:"bambulab",instance:undefined}`;
`ownerOf("enum.rooms.Bad")` → `{adapter:"enum",instance:"rooms"}`.
`objectIconValue` prefers `modelIcon`, falls back `extIcon`, then `icon`, ignores blank/non-strings.
`resolveIcon`: the object's own `icon` wins; a child's `modelIcon` beats a parent's `icon`; a parent's
`icon` beats the adapter's `extIcon`; with nothing anywhere the adapter fallback
(`system.adapter.<a>.<i>` then `system.adapter.<a>`) applies; `resolveIcon` on an id with no
underscore-free path stops (walk terminates).
`deviceObjectIcon`: the first state id that resolves wins; none → undefined.

`icon-url.test.ts` (base passed explicitly): `iconSrc("lightbulb", "alias.0.x", b)` → `"lightbulb"`
(a symbol is not a path); `iconSrc("data:image/svg+xml;base64,AA", "x.0.y", b)` → unchanged;
`iconSrc("https://x/y.png", undefined, b)` and `"//x/y.png"` → unchanged; `iconSrc("energiefluss.png",
"system.adapter.energiefluss.0", b)` → `b + "/adapter/energiefluss/energiefluss.png"`;
`iconSrc("icons/echo_dot.png", "alexa2.0.Dev.1", b)` → `b + "/adapter/alexa2/icons/echo_dot.png"`;
`iconSrc("adapter/admin/admin.svg", "system.adapter.admin", b)` → `b + "/adapter/admin/admin.svg"`;
`iconSrc("energiefluss.png")` (no owner) → `b + "/energiefluss.png"`; `iconSrc("/icons/a.png")` →
`"/icons/a.png"`, with an owner → `b + "/icons/a.png"`; `iconSrc("")` → `""`, `iconSrc(undefined)` →
`""`; `iconSrc("x.png", "a.0.b", "")` → `"/adapter/a/x.png"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/config/icon-ops.test.ts src/lib/utils/icon-url.test.ts`
Expected: FAIL — the modules/functions do not exist.

- [ ] **Step 3: Implement**

`icon-ops.ts` — the walk per A65, with `cur.lastIndexOf(".")` stepping and no loop when there is no
dot left. `icon-url.ts` — replace `iconUrl` with `iconSrc` (keep `isImageIcon` and
`collectDocumentIcons`) and add `iconBase()`; the leading-`/` case rebases only when an owner is given
(A66), the bare-filename case uses `<base>/adapter/<owner's adapter>/` when the owner is known.

- [ ] **Step 4: Gates**

Run: `npm test && npm run check && npm run lint`
Expected: green (the new tests pass; `iconUrl`'s callers are updated in Task 2 — if `check` complains
about `Icon.svelte`, finish Task 2 in the same commit).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/icon-ops.ts src/lib/config/icon-ops.test.ts src/lib/utils/icon-url.ts src/lib/utils/icon-url.test.ts
git commit -m "feat(config): the icon hierarchy and the ioBroker base (A65/A66)"
```

---

### Task 2: One image renderer

**Files:**
- Modify: `src/lib/components/common/Icon.svelte`, `src/lib/components/common/EnumBadge.svelte`,
  `src/lib/components/common/MultiSelect.svelte`

**Interfaces:**
- Consumes: `iconSrc` (Task 1).
- Produces: `Icon` props `{ value?: string; size?: number; dim?: boolean; owner?: string }`.

- [ ] **Step 1: `Icon.svelte`**

Render `src={iconSrc(value, owner)}`; add the optional `owner` prop (the broker object id the value
came from).

- [ ] **Step 2: `EnumBadge.svelte` / `MultiSelect.svelte`**

Delete both local `isUrl` helpers; render `<Icon value={icon} owner={id} size={…} />` (enum badge: the
enum's own id as owner; MultiSelect: its option's value).

- [ ] **Step 3: Gates and a live pass**

Run: `npm test && npm run check && npm run lint && npm run build`
Live: the icon picker's **Broker** tab renders its relative-filename entries (previously blank), and
room/function badges keep rendering their inline SVGs.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/common
git commit -m "fix(common): every icon renders through Icon on the ioBroker base (A66)"
```

---

### Task 3: The device enrichment carries the icon

**Files:**
- Modify: `src/lib/types/device.ts` (`EnrichedDevice.objectIcon?`),
  `src/lib/stores/devices.svelte.ts` (the enrichment), `src/lib/stores/devices.test.ts`

**Interfaces:**
- Consumes: `deviceObjectIcon`, `iconSrc` (Task 1).
- Produces: `EnrichedDevice.objectIcon?: string` — the document's `device.icon` when set, else the
  resolved broker icon (already a URL, or a symbol when the document set one).

- [ ] **Step 1: Write the failing test**

In `devices.test.ts`: with `setObjectSource(new Map([["alias.0.Ch", { common: { icon: "data:image/svg+xml;base64,AA" } }]]))`
and a canonical device whose first control's `stateId` is `alias.0.Ch.X`, `getDevicesEnriched()[0].objectIcon`
is that data URI; a second device whose ids resolve nothing has `objectIcon === undefined`; a device with
its own `icon: "widgets"` keeps `"widgets"`.

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run src/lib/stores/devices.test.ts` → FAIL.

- [ ] **Step 3: Implement** the enrichment line, using the object source map.

- [ ] **Step 4: Gates** — `npm test && npm run check && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/device.ts src/lib/stores/devices.svelte.ts src/lib/stores/devices.test.ts
git commit -m "feat(devices): the device carries its broker icon (A65/A68)"
```

---

### Task 4: The four places show it

**Files:**
- Modify: `src/lib/components/display/Tile.svelte` (name line + `headIcon` fallback),
  `src/routes/devices/+page.svelte` (device rows), `src/lib/components/layout/DevicePicker.svelte`
  (option icons)

**Interfaces:**
- Consumes: `EnrichedDevice.objectIcon` (Task 3), `Icon` (Task 2).

- [ ] **Step 1:** the tile's name line renders `<Icon value={device.objectIcon} size={15} />` before the
  text when present (the name line becomes a flex row, the icon not shrinking).
- [ ] **Step 2:** `headIcon` falls back to `{ glyph: device.objectIcon }` when the headline slot has no
  icon (a slot icon still wins).
- [ ] **Step 3:** each device row in the devices page shows the icon before the name; `DevicePicker`'s
  options carry `icon: d.objectIcon` (its list renders it through `Icon` after Task 2).
- [ ] **Step 4: Gates and a live pass** — the four places on the live document (Bad.Thermometer's inline
  SVG at the tile name, the header, the devices page; 3D-Printer's bambulab icon).
- [ ] **Step 5: Commit**

```bash
git add src/lib/components/display/Tile.svelte src/routes/devices/+page.svelte src/lib/components/layout/DevicePicker.svelte
git commit -m "feat(display): the device icon on the tile, in the detail header and in the pickers (A67)"
```

---

### Task 5: Docs and handoff

- [ ] **Step 1:** the handoff (dated 2026-10-21) — what landed, the live evidence, the limits (A69).
- [ ] **Step 2:** `git add docs && git commit -m "docs: the device icons, handed off"`
