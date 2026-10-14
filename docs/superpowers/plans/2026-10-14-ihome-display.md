# iHome Display (basics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the iHome display — a page → group → device dashboard with a module grid, tile
templates, built-in presets, and value-driven effects — as the new `/` route.

**Architecture:** All decision-making lives in pure modules under `src/lib/config/*.ts`
(membership resolution, template merging, rule evaluation, span clamping) so every layer is
testable without a broker or a DOM. Thin Svelte components render what those modules return:
`PageView` → `GroupSection` → `Tile` → `SlotRenderer` → slot components. Config lives in two
new ioBroker JSON states beside the existing `deviceList`.

**Tech Stack:** SvelteKit (hash router, static adapter), Svelte 5 runes, TypeScript, Vitest
(node env), ioBroker socket.io client. No charting or UI libraries.

**Spec:** `docs/superpowers/specs/2026-10-14-ihome-display-design.md`

**Not in this plan:** spec phases 4–5 (the `/pages` and `/templates` editors, the device-form
additions, and kiosk polish beyond the last-page memory). Until those exist, pages come from the
first-run seed and tiles from the built-in presets — which is enough to use the display daily.

## Global Constraints

- **No new dependencies.** Everything uses what `package.json` already has.
- Pure logic goes in `src/lib/config/<name>.ts` with a sibling `src/lib/config/<name>.test.ts`.
  Components hold no decisions that a test could hold instead.
- **New stores must not use module-global client injection.** Import the shared `ioBroker`
  from `$lib/ioBrokerConnect.svelte.js` and/or take the client as an argument — follow
  `src/lib/registry.svelte.js`. (The history store was broken by a module-global client under
  Vite HMR; see the 2026-10-13 handoff.)
- Tests: Vitest, node env, `requireAssertions: true` — every test asserts. No DOM/component tests.
- Run these before every commit and keep them green: `npm test`, `npm run check`, `npm run lint`,
  `npm run build`.
- New state ids (verbatim): `0_userdata.0.Test.AiHome.pageList`,
  `0_userdata.0.Test.AiHome.templateList`.
- Breakpoints and sizes are copied verbatim from the spec:
  phone `<600px` tile 150px max `1x2` · tablet `600–1024px` tile 170px max `2x2` ·
  desktop `>1024px` tile 190px max `4x4`.
- Badge tones: `"info" | "ok" | "warn" | "danger"`. An `ago` badge turns `warn` at
  `86_400_000` ms (24 h).
- English identifiers and comments; 2-space indent; repo prettier config.
- Do not rename the package or adapter (`ioBroker.iHome` is a later, separate task).

## Review Focus

Failure modes the spec implies but no single task's tests cover end to end — each gets its
test in the owning task:

1. A group whose `member` is `{}` — a reasonable person expects **nothing** to render, not
   every device in the registry (Task 4).
2. `device.template` naming an id that no longer exists — expect the preset for `device.type`,
   not a blank tile (Task 5).
3. A `when` expression that throws, or names an unknown local — expect the rule not to match
   and the tile still to render (Task 6).
4. A device whose controls are all `hidden` — expect it absent from groups unless the group
   sets `showEmpty` (Tasks 4, 8).
5. A state whose object is missing (`available === false`) — expect the tile to render with an
   `offline` badge and no `ago`, never the text `undefined` (Task 11).

---

## Phase 1 — model and pure logic

### Task 1: Display model and persisted device fields

**Files:**
- Create: `src/lib/types/display.ts`
- Modify: `src/lib/types/device.ts` (append fields to `Device`, `Control`)
- Modify: `src/lib/config/project.ts` (`projectDevice`, `projectControl`)
- Test: `src/lib/config/project.test.ts`

**Interfaces:**
- Consumes: existing `DeviceType` from `$lib/types/device`.
- Produces: `Size`, `Member`, `Group`, `Page`, `Background`, `PageRegistry`, `SlotKind`, `Rule`,
  `Slot`, `Template`, `TemplateRegistry` (all from `$lib/types/display`); `Device` gains
  `functions?`, `favorites?`, `tags?`, `template?`, `size?`, `slots?`, `watch?`; `Control` gains
  `rules?`.

- [ ] **Step 1: Write the failing test**

In `project.test.ts` add:

```ts
it("projects the display fields of a device", () => {
  const d: Device = {
    id: "d1", name: "Light", type: "Light",
    functions: ["enum.functions.Licht"],
    favorites: ["enum.favorites.EG"],
    tags: ["eg", "night"],
    template: "light-v2",
    size: { w: 2, h: 1 },
    watch: ["alias.0.EG.Relay.SET"],
    slots: [{ kind: "icon", source: "power", rules: [{ when: "power", icon: "lightbulb" }] }],
    controls: [{ id: "c1", feature: "power", writable: true, rules: [{ when: "!power", tone: "info" }] }],
  };
  const p = projectDevice(d);
  assert.deepEqual(p.functions, ["enum.functions.Licht"]);
  assert.deepEqual(p.size, { w: 2, h: 1 });
  assert.deepEqual(p.watch, ["alias.0.EG.Relay.SET"]);
  assert.deepEqual(p.slots, d.slots);
  assert.deepEqual(p.controls[0].rules, [{ when: "!power", tone: "info" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/project.test.ts`
Expected: FAIL — `slots`/`watch`/`rules` are dropped by the projection.

- [ ] **Step 3: Add the fields**

Create `src/lib/types/display.ts` with the types exactly as written in spec §4
(`Size`, `Member`, `Group`, `Page`, `Background`, `PageRegistry`, `SlotKind`, `Rule`, `Slot`,
`Template`, `TemplateRegistry`). `PageRegistry` is
`{ version: number; updatedAt: number; seeded?: boolean; pages: Page[] }`; `TemplateRegistry`
is `{ version: number; updatedAt: number; templates: Template[] }`.

In `device.ts` add the optional fields listed in spec §4 to `Device` and `Control`, and mark
the dead fields with a comment: `section?: string;` / `panel?: string;` get
`// deprecated: superseded by page groups (spec §4.1.5) — kept so old registries still parse`.
In `project.ts` copy each new field through in `projectDevice` / `projectControl`
(same style as the existing fields — explicit, no spread).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/project.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/display.ts src/lib/types/device.ts src/lib/config/project.ts src/lib/config/project.test.ts
git commit -m "feat(display): model types and persisted device fields"
```

---

### Task 2: Enum membership for functions and favorites

**Files:**
- Modify: `src/lib/config/rooms.ts`
- Test: `src/lib/config/rooms.test.ts`

**Interfaces:**
- Produces: `enumsOf(enums: any, id: string, type: string): string[]`,
  `functionsOf(enums: any, id: string): string[]`, `favoritesOf(enums: any, id: string): string[]`.
  `roomsOf` keeps its signature and delegates to `enumsOf`.

- [ ] **Step 1: Write the failing test**

```ts
it("reads any enum type off a member id", () => {
  const enums = fakeEnums({
    "alias.0.EG.Light": { rooms: [{ _id: "enum.rooms.WZ" }], functions: [{ _id: "enum.functions.Licht" }], favorites: [{ _id: "enum.favorites.EG" }] },
    "alias.0.EG.Plug": { functions: [{ _id: "enum.functions.Licht" }], favorites: [] },
  });
  assert.deepEqual(functionsOf(enums, "alias.0.EG.Light"), ["enum.functions.Licht"]);
  assert.deepEqual(favoritesOf(enums, "alias.0.EG.Light"), ["enum.favorites.EG"]);
  assert.deepEqual(favoritesOf(enums, "alias.0.EG.Plug"), []);
  assert.deepEqual(favoritesOf(enums, "alias.0.Missing"), []);
});
```

`fakeEnums` is a local helper returning `{ get: (id) => map[id] }` — the only method used.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/rooms.test.ts`
Expected: FAIL — `functionsOf is not defined`.

- [ ] **Step 3: Implement**

```ts
export function enumsOf(enums: any, id: string, type: string): string[] {
  const e: any = enums?.get(id);
  return (e?.[type] ?? []).map((r: any) => r._id);
}
```
Then `roomsOf` becomes `return enumsOf(enums, id, "rooms")` and the two thin wrappers
(`functionsOf`, `favoritesOf`) are added. `EnumMap` already indexes every enum type this way
(`src/lib/StateClass.svelte.js:476`), so no socket-side change is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/rooms.test.ts`
Expected: PASS (existing room tests still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/rooms.ts src/lib/config/rooms.test.ts
git commit -m "feat(display): generic enum membership helper (functions, favorites)"
```

---

### Task 3: Tile span clamping

**Files:**
- Create: `src/lib/config/size-ops.ts`
- Test: `src/lib/config/size-ops.test.ts`

**Interfaces:**
- Consumes: `Size` from `$lib/types/display`.
- Produces: `Breakpoint = "phone" | "tablet" | "desktop"`,
  `TileSpan = { w: number; h: number }`, `DEFAULT_SPAN`, `BREAKPOINTS`,
  `breakpointFor(width: number): Breakpoint`,
  `clampSpan(size: Size | undefined, bp: Breakpoint): TileSpan`.

- [ ] **Step 1: Write the failing test**

```ts
it("clamps hints per breakpoint", () => {
  assert.equal(breakpointFor(599), "phone");
  assert.equal(breakpointFor(600), "tablet");
  assert.equal(breakpointFor(1024), "tablet");
  assert.equal(breakpointFor(1025), "desktop");
  assert.deepEqual(clampSpan({ w: 2, h: 2 }, "phone"), { w: 1, h: 2 });
  assert.deepEqual(clampSpan({ w: 4, h: 2 }, "tablet"), { w: 2, h: 2 });
  assert.deepEqual(clampSpan({ w: 4, h: 4 }, "desktop"), { w: 4, h: 4 });
  assert.deepEqual(clampSpan(undefined, "desktop"), { w: 1, h: 1 });
  assert.deepEqual(clampSpan({ w: 1, h: 1 }, "phone"), { w: 1, h: 1 });
});

it("keeps the values the stylesheet needs", () => {
  assert.deepEqual(BREAKPOINTS.map((b) => [b.name, b.tileMin, b.maxW, b.maxH]),
    [["phone", 150, 1, 2], ["tablet", 170, 2, 2], ["desktop", 190, 4, 4]]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/size-ops.test.ts`
Expected: FAIL — cannot resolve `size-ops`.

- [ ] **Step 3: Implement**

`BREAKPOINTS` is an array of `{ name, maxWidth: number | null, tileMin, maxW, maxH }` with the
values above (`phone.maxWidth = 600`, `tablet.maxWidth = 1024`, `desktop.maxWidth = null`).
`breakpointFor` picks the first entry whose `maxWidth` is null or `> width`.
`clampSpan` returns `{ w: Math.min(w ?? 1, maxW), h: Math.min(h ?? 1, maxH) }`, flooring
anything below 1 to 1. `DEFAULT_SPAN = { w: 1, h: 1 }`.

The component layer reads the same values from `BREAKPOINTS` to emit CSS custom properties, so
the table has exactly one home.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/size-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/size-ops.ts src/lib/config/size-ops.test.ts
git commit -m "feat(display): tile span clamping per breakpoint"
```

---

### Task 4: Page and group resolution

**Files:**
- Create: `src/lib/config/pages-ops.ts`
- Test: `src/lib/config/pages-ops.test.ts`

**Interfaces:**
- Consumes: `Member`, `Group`, `Page`, `PageRegistry` from `$lib/types/display`; `DeviceType`.
- Produces:

```ts
export interface FilterableDevice {
  id: string; name: string; type: DeviceType; room?: string;
  functions?: string[]; favorites?: string[]; tags?: string[];
  visibleControls: number;
}
export interface FilterChips { room?: string; function?: string; favorite?: string }
export interface ResolvedGroup<T = FilterableDevice> { group: Group; devices: T[] }

export function matchesMember(d: FilterableDevice, m: Member): boolean;
export function resolvePage<T extends FilterableDevice>(page: Page, devices: T[]): ResolvedGroup<T>[];
export function filterDevices<T extends FilterableDevice>(devices: T[], chips: FilterChips): T[];
export function toFilterable<T extends { id: string; name: string; type: DeviceType; room?: string;
  functions?: string[]; favorites?: string[]; tags?: string[]; controls?: { hidden?: boolean }[] }>(
    d: T): T & { visibleControls: number };
export function seedPages(functions: { id: string; label: string }[],
  rooms: { id: string; label: string }[]): PageRegistry;
```

The generics matter: `resolvePage` is called with the *enriched* devices (which carry `controls`
and live values) and must hand those same objects to `Tile` — it filters, it does not convert.

- [ ] **Step 1: Write the failing tests**

```ts
const dev = (over: Partial<FilterableDevice>): FilterableDevice =>
  ({ id: "x", name: "X", type: "Light", visibleControls: 1, ...over });

it("matches only what the member asks for", () => {
  const d = dev({ room: "enum.rooms.WZ", functions: ["enum.functions.Licht"], tags: ["eg"] });
  assert.equal(matchesMember(d, { room: "enum.rooms.WZ" }), true);
  assert.equal(matchesMember(d, { room: "enum.rooms.Bad" }), false);
  assert.equal(matchesMember(d, { function: "enum.functions.Licht" }), true);
  assert.equal(matchesMember(d, { function: "enum.functions.Heizung" }), false);
  assert.equal(matchesMember(d, { tags: ["eg"] }), true);
  assert.equal(matchesMember(d, { tags: ["eg", "night"] }), false);
  assert.equal(matchesMember(d, { room: "enum.rooms.WZ", type: "Switch" }), false);
  assert.equal(matchesMember(d, {}), false);          // Review Focus 1
  assert.equal(matchesMember(d, { ids: ["x"] }), true);
  assert.equal(matchesMember(d, { ids: ["y"] }), false);
});

it("claims explicit ids first and never duplicates a device", () => {
  const page: Page = { id: "p", title: "Home", groups: [
    { id: "g1", member: { function: "enum.functions.Licht" } },
    { id: "g2", member: { ids: ["a"] } },
  ]};
  const devices = [dev({ id: "a", functions: ["enum.functions.Licht"] }),
                   dev({ id: "b", functions: ["enum.functions.Licht"] })];
  const res = resolvePage(page, devices);
  assert.deepEqual(res.map((r) => r.devices.map((d) => d.id)), [["a"], ["b"]]);
});

it("hides device-less groups unless showEmpty", () => {
  const page: Page = { id: "p", title: "Home", groups: [
    { id: "g1", member: { room: "enum.rooms.Bad" } },
    { id: "g2", member: { room: "enum.rooms.Bad" }, showEmpty: true },
  ]};
  assert.deepEqual(resolvePage(page, [dev({})]).map((r) => r.group.id), ["g2"]);
});

it("treats a device with only hidden controls as empty", () => {
  assert.equal(toFilterable({ id: "x", name: "X", type: "Value",
    controls: [{ hidden: true }, { hidden: true }] }).visibleControls, 0);
  assert.equal(toFilterable({ id: "x", name: "X", type: "Value",
    controls: [{}, { hidden: true }] }).visibleControls, 1);
});

it("filters by chip", () => {
  const a = dev({ id: "a", room: "enum.rooms.WZ" });
  const b = dev({ id: "b", room: "enum.rooms.Bad", functions: ["enum.functions.Licht"] });
  assert.deepEqual(filterDevices([a, b], { room: "enum.rooms.Bad" }).map((d) => d.id), ["b"]);
  assert.deepEqual(filterDevices([a, b], {}).map((d) => d.id), ["a", "b"]);
  assert.deepEqual(filterDevices([a, b], { function: "enum.functions.Heizung" }), []);
});

it("seeds one page of function groups and one page of room groups", () => {
  const reg = seedPages([{ id: "enum.functions.Licht", label: "Licht" }],
                        [{ id: "enum.rooms.WZ", label: "Wohn-Ess-Z" }]);
  assert.equal(reg.seeded, true);
  assert.deepEqual(reg.pages.map((p) => p.id), ["home", "rooms"]);
  assert.deepEqual(reg.pages[0].groups[0].member, { function: "enum.functions.Licht" });
  assert.deepEqual(reg.pages[0].groups[0].title, "Licht");
  assert.deepEqual(reg.pages[1].groups[0].member, { room: "enum.rooms.WZ" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/pages-ops.test.ts`
Expected: FAIL — cannot resolve `pages-ops`.

- [ ] **Step 3: Implement**

Rules to honour exactly:

1. `matchesMember` ANDs every present field; `ids` matches by membership. **An empty member
   matches nothing** (Review Focus 1).
2. `resolvePage` runs two passes over `page.groups`: first groups whose `member.ids` is set,
   then the rest — both in declaration order. A device claimed in pass one is excluded later.
3. A group renders when it has at least one device (`visibleControls > 0`), or when
   `showEmpty` is true (then it may render zero devices).
4. `toFilterable.visibleControls` counts controls that are **not** `hidden`, regardless of
   availability — an offline device must still render (spec §6).
5. `filterDevices` ANDs the chips that are set; `room` matches `d.room`, `function`/`favorite`
   match membership arrays.
6. `seedPages` returns `{ version: 0, updatedAt: Date.now(), seeded: true, pages: [...] }` with
   page `home` (one function group per function, titled with the function label) and page
   `rooms` (one room group per room, titled with the room label).
7. Device order inside a group is the input order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/pages-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/pages-ops.ts src/lib/config/pages-ops.test.ts
git commit -m "feat(display): page, group and chip resolution with seeding"
```

---

### Task 5: Template merging and built-in presets

**Files:**
- Create: `src/lib/config/template-ops.ts`
- Create: `src/lib/config/presets.ts`
- Modify: `src/lib/config/features.ts` (add `required?: boolean` to `FeatureDef`)
- Test: `src/lib/config/template-ops.test.ts`

**Interfaces:**
- Consumes: `Template`, `Slot`, `Size` from `$lib/types/display`; `Device` from `$lib/types/device`;
  `DEVICE_FEATURES`, `FeatureDef` from `$lib/config/features`.
- Produces:

```ts
export const PRESETS: Record<DeviceType, Template>;
export function presetForType(type: DeviceType): Template;   // unknown type → PRESETS.Custom
export function templateById(id: string | undefined, templates: Template[]): Template | undefined;
export function mergeSlots(layers: Slot[][]): Slot[];
export interface ResolvedTemplate { type: DeviceType; size: Size; features: FeatureDef[]; slots: Slot[] }
export function resolveTemplate(device: Device, userTemplates: Template[]): ResolvedTemplate;
export function primaryControl<T extends { widget?: string; writable?: boolean }>(controls: T[]): T | undefined;
```

- [ ] **Step 1: Write the failing tests**

```ts
it("merges slots by kind+source with later winning and rules concatenated", () => {
  const merged = mergeSlots([
    [{ kind: "icon", source: "power", color: "grey", rules: [{ when: "!power", color: "grey" }] }],
    [{ kind: "icon", source: "power", color: "amber", rules: [{ when: "power", color: "amber" }] }],
    [{ kind: "value" }],
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].color, "amber");
  assert.deepEqual(merged[0].rules?.map((r) => r.when), ["!power", "power"]);
});

it("merges badges per source, not per kind", () => {
  const merged = mergeSlots([
    [{ kind: "badge", source: "ago" }, { kind: "badge", source: "offline" }],
    [{ kind: "badge", source: "offline", tone: "danger" }],
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].tone, "danger");
});

it("falls back to the type preset when the template id is unknown", () => {
  const r = resolveTemplate({ id: "d", name: "L", type: "Light", controls: [] }, []);
  assert.equal(r.type, "Light");
  assert.deepEqual(r.slots, PRESETS.Light.slots);
});

it("layers preset, user template and device overrides", () => {
  const user: Template = { id: "u1", name: "My light", basedOn: "Light", type: "Light",
    size: { w: 2, h: 1 }, features: [], slots: [{ kind: "icon", source: "power", color: "red" }] };
  const r = resolveTemplate({ id: "d", name: "L", type: "Light", template: "u1",
    controls: [], slots: [{ kind: "value", label: "W" }] }, [user]);
  assert.deepEqual(r.size, { w: 2, h: 1 });
  assert.equal(r.slots.find((s) => s.kind === "icon")?.color, "red");
  assert.ok(r.slots.some((s) => s.kind === "value" && s.label === "W"));
});

it("picks a writable switch as the tile's primary control", () => {
  assert.equal(primaryControl([{ widget: "value" }, { widget: "switch", writable: true }])?.widget, "switch");
  assert.equal(primaryControl([{ widget: "switch", writable: false }, { widget: "level" }])?.widget, "level");
  assert.equal(primaryControl([]), undefined);
});

it("gives every device type a preset", () => {
  for (const t of DEVICE_TYPES) assert.ok(presetForType(t).slots.length >= 1, t);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/template-ops.test.ts`
Expected: FAIL — cannot resolve `template-ops`.

- [ ] **Step 3: Implement**

`mergeSlots`: key `\`${kind}:${source ?? ""}\``; later layers replace the earlier slot's fields
but concatenate `rules` (`[...earlier.rules, ...later.rules]`). A new key appends.

`resolveTemplate`:

```ts
const user = templateById(device.template, userTemplates);      // undefined when unknown
const base = presetForType(user?.basedOn ?? device.type) ?? presetForType(device.type);
return { type: device.type,
         size: device.size ?? user?.size ?? base.size ?? { ...DEFAULT_SPAN },   // DEFAULT_SPAN from size-ops
         features: user?.features?.length ? user.features : base.features,
         slots: mergeSlots([base.slots, user?.slots ?? [], device.slots ?? []]) };
```

`presetForType` never returns undefined: an unregistered type, or a `basedOn` naming a preset
that does not exist, falls back to `PRESETS.Custom`. That fallback is what makes Review Focus 2
(a `template` id that no longer exists) degrade to "the tile still renders" instead of throwing.
`presets.ts`: one frozen `Template` per `DeviceType` (`builtin: true`, `id` = the type name),
with `features: DEVICE_FEATURES[type]`, the `size` from the spec §4.2 table, and the slots in
that table (icon + value + badges for every type; plus level/color/enum/button per type).
Icons are `material-symbols-outlined` names. Light's icon slot carries the two spec rules
(`{ when: "power", icon: "lightbulb", color: "amber", glow: true }` and
`{ when: "!power", icon: "lightbulb_outline", color: "grey" }`). `primaryControl` returns the
first `writable` control whose `widget` is `"switch"`, else the first with `widget === "level"`,
else `undefined`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/template-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/template-ops.ts src/lib/config/presets.ts src/lib/config/features.ts src/lib/config/template-ops.test.ts
git commit -m "feat(display): template merging and built-in presets"
```

---

### Task 6: Rule evaluation and implicit badges

**Files:**
- Create: `src/lib/config/rule-ops.ts`
- Test: `src/lib/config/rule-ops.test.ts`

**Interfaces:**
- Consumes: `Rule`, `Slot` from `$lib/types/display`; `Scope`, `PoolEntry`, `buildScope`,
  `evaluateVirtual` from `$lib/config/virtual-ops`; `formatAge` from `$lib/config/format`.
- Produces:

```ts
export type BadgeTone = "info" | "ok" | "warn" | "danger";
export interface ResolvedStyle { icon?: string; color?: string; glow?: boolean;
  background?: string; hidden?: boolean; tone?: string }
export interface ResolvedBadge { source: string; icon: string; tone: BadgeTone; label: string; title?: string }
export const AGO_WARN_MS: number;                     // 86_400_000
export function ruleScope(controls: LocalControl[], pool: PoolEntry[]): Scope;
export function evalRule(rule: Rule, scope: Scope): boolean;
export function resolveStyle(rules: Rule[], scope: Scope): ResolvedStyle;
export function agoBadge(ts: number | undefined, now: number): ResolvedBadge | undefined;
export function offlineBadge(device: { available?: boolean; controls?: { available?: boolean }[] }): ResolvedBadge | undefined;
export function resolveBadges(slots: Slot[], device: EnrichedDevice, ts: number | undefined,
  now: number): ResolvedBadge[];
```

- [ ] **Step 1: Write the failing tests**

```ts
it("applies the last matching rule", () => {
  const scope = ruleScope([{ feature: "power", label: "Power", liveValue: true }], []);
  const style = resolveStyle([{ when: "!power", color: "grey" }, { when: "power", color: "amber" }], scope);
  assert.deepEqual(style, { color: "amber" });
});

it("does not match a broken expression and keeps the tile renderable", () => {
  const scope = ruleScope([{ feature: "power", liveValue: true }], []);
  assert.equal(evalRule({ when: "power >" }, scope), false);       // Review Focus 3
  assert.equal(evalRule({ when: "nope" }, scope), false);
  assert.deepEqual(resolveStyle([{ when: "power >", color: "red" }], scope), {});
});

it("reads raw state ids through the pool helper", () => {
  const scope = ruleScope([], [{ stateId: "alias.0.EG.Relay.SET", value: 1 }]);
  assert.equal(evalRule({ when: "get('alias.0.EG.Relay.SET') > 0" }, scope), true);
});

it("builds an ago badge and warns after 24h", () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(agoBadge(now - 1000, now), { source: "ago", icon: "schedule", tone: "info", label: "now", title: new Date(now - 1000).toLocaleString() });
  assert.equal(agoBadge(now - 90_000_000, now)?.tone, "warn");
  assert.equal(agoBadge(undefined, now), undefined);
});

it("builds an offline badge when a state object is missing", () => {
  assert.equal(offlineBadge({ controls: [{ available: true }, { available: false }] })?.tone, "danger");
  assert.equal(offlineBadge({ controls: [{ available: true }] }), undefined);
});

it("resolves badge slots and skips ones with no source", () => {
  const now = 1_700_000_000_000;
  const badges = resolveBadges([{ kind: "badge", source: "ago" }, { kind: "badge", source: "battery" }],
    { controls: [{ available: true, feature: "battery", liveValue: 12 }] }, now - 1000, now);
  assert.deepEqual(badges.map((b) => b.source), ["ago", "battery"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/rule-ops.test.ts`
Expected: FAIL — cannot resolve `rule-ops`.

- [ ] **Step 3: Implement**

- `ruleScope` is `buildScope(controls, pool)` — the locals keep the existing naming
  (sanitized label, falling back to feature), which is what the virtual-formula editor already
  teaches.
- `evalRule` returns `evaluateVirtual(rule.when, scope).value === true` when the evaluation
  reports no `error`, else `false`. Truthiness is exact-`true` so `undefined` never matches.
- `resolveStyle` folds matching rules in order, overwriting only the keys a rule sets.
- `agoBadge(ts, now)` → `label` is `formatAge(ts, now)`, `tone` is `"warn"` when
  `now - ts > AGO_WARN_MS` else `"info"`, `title` is the absolute local time.
- `offlineBadge(device)` → `undefined` when every control is available (and when there are no
  controls); otherwise `{ source: "offline", icon: "cloud_off", tone: "danger", label: "offline" }`.
- `resolveBadges` walks the badge slots in order: `ago` → `agoBadge`, `offline` → `offlineBadge`,
  anything else → the device control whose `feature` or `id` equals the slot's `source`, using
  `slot.rules` (via `resolveStyle`) for icon/tone and `formatValue` for the label. No source →
  the badge is skipped, never rendered blank.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/rule-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config/rule-ops.ts src/lib/config/rule-ops.test.ts
git commit -m "feat(display): rule evaluation and implicit ago/offline badges"
```

---

## Phase 2 — the display

### Task 7: Page and template stores, seeded on first run

**Files:**
- Create: `src/lib/stores/pages.svelte.ts`
- Create: `src/lib/stores/templates.svelte.ts`
- Modify: `src/lib/config/pages-ops.ts` (add `parsePageRegistry`)
- Modify: `src/lib/config/template-ops.ts` (add `parseTemplateRegistry`)
- Modify: `src/routes/+layout.svelte` (init both on mount, brand as iHome)
- Modify: `src/lib/pages.js` (drop the Home tab, add Pages and Templates)
- Test: `src/lib/config/pages-ops.test.ts`, `src/lib/config/template-ops.test.ts` (extend)

**Interfaces:**
- Consumes: `seedPages`, `PageRegistry`; `ioBroker` from `$lib/ioBrokerConnect.svelte.js`
  (imported directly, per Global Constraints).
- Produces: `PAGE_LIST_ID = "0_userdata.0.Test.AiHome.pageList"`,
  `TEMPLATE_LIST_ID = "0_userdata.0.Test.AiHome.templateList"`,
  `parsePageRegistry(raw: unknown): PageRegistry | null` (in `pages-ops.ts`),
  `parseTemplateRegistry(raw: unknown): TemplateRegistry | null` (in `template-ops.ts`),
  `getPageRegistry()`, `setPageRegistry(reg)`, `getTemplateRegistry()`, `setTemplateRegistry(reg)`,
  `savePages()`, `saveTemplates()`, `initPages(seed?: PageRegistry)`, `initTemplates()`.

The parse functions live in the **pure** modules, not the store: the store imports `ioBroker`,
and a node-env test must not drag the socket layer in. The store file then holds only the
state, the `init*`/`save*` plumbing and the getters/setters.

- [ ] **Step 1: Write the failing tests**

```ts
it("parses a page registry and rejects junk", () => {
  assert.equal(parsePageRegistry("nope"), null);
  assert.equal(parsePageRegistry({ pages: "x" }), null);
  assert.deepEqual(parsePageRegistry('{"version":2,"pages":[]}')?.pages, []);
  assert.equal(parsePageRegistry({ val: { pages: [{ id: "p", title: "P", groups: [] }] } })?.pages.length, 1);
});

it("parses a template registry and rejects junk", () => {
  assert.equal(parseTemplateRegistry(null), null);
  assert.equal(parseTemplateRegistry({ templates: [{ id: "t" }] })?.templates.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config/pages-ops.test.ts src/lib/config/template-ops.test.ts`
Expected: FAIL — `parsePageRegistry` / `parseTemplateRegistry` are not exported yet.

- [ ] **Step 3: Implement**

Copy the shape of `src/lib/registry.svelte.js` for both stores: module-level `$state` model with
get/set, `ensure*Object()` (create the state object if missing, `common.type = "json"`),
`init*()` guarded by an `initPromise` that waits for `ioBroker.connected`, loads the value,
applies `parse*`, and subscribes to `onUpdate` with the same echo suppression
(`lastSent === snapshot` → ignore). `save*()` debounces 250 ms and writes
`JSON.stringify(get*Registry())`.

`initPages(seed)` seeds once: when the state is empty **and** `seed` is provided, it writes the
seed (with `seeded: true`) and saves immediately. `+layout.svelte` builds the seed from the
broker enums:

```js
initPages(seedPages(roomList(ioBroker.enums).map(...), ...))  // functions from enums.getList("functions")
```

Build the seed argument from `ioBroker.enums.getList("functions")` / `getList("rooms")` mapped to
`{ id, label }` via `enumLabelFromObject`. Register both new state ids with
`registerProgramStateId` from `$lib/stores/devices`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config/pages-ops.test.ts src/lib/config/template-ops.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/pages.svelte.ts src/lib/stores/templates.svelte.ts src/lib/config/pages-ops.ts src/lib/config/template-ops.ts src/lib/config/pages-ops.test.ts src/lib/config/template-ops.test.ts src/routes/+layout.svelte src/lib/pages.js
git commit -m "feat(display): page and template stores, seeded from broker enums"
```

---

### Task 8: Display shell, page view and module grid

**Files:**
- Create: `src/lib/components/display/PageView.svelte`
- Create: `src/lib/components/display/GroupSection.svelte`
- Modify: `src/routes/+page.svelte` (replace the Home control dump with the display)
- Create: `src/routes/p/[id]/+page.svelte`
- Test: covered by Task 4's `resolvePage` tests (no DOM tests in this repo)

**Interfaces:**
- Consumes: `getPageRegistry()`, `devicesEnrichedStore` (`$lib/stores/devices`), `resolvePage`,
  `toFilterable`, `clampSpan`, `BREAKPOINTS`, `Tile` (Task 9).
- Produces: `PageView.svelte` props `{ page: Page }`; `GroupSection.svelte` props
  `{ group: Group; devices: FilterableDevice[] }`.

- [ ] **Step 1: Build `GroupSection.svelte`**

Renders an optional header (icon + `title` + device count + collapse toggle; no header when
`title` is unset) and a grid of `Tile`s. The grid is one CSS grid:

```css
.grid { display: grid; gap: 8px;
        grid-template-columns: repeat(auto-fill, minmax(var(--tile-min), 1fr));
        grid-auto-rows: var(--tile-min); }
.tile-span { grid-column: span min(var(--w), var(--max-w));
             grid-row: span min(var(--h), var(--max-h)); }
```

The breakpoint tokens come from `BREAKPOINTS` (Task 3) as inline custom properties on the page
root, overridden by three media queries (`<600px`, `600–1024px`, `>1024px`) that set
`--tile-min`, `--max-w`, `--max-h` from that same array. No size value is written twice.

- [ ] **Step 2: Build `PageView.svelte`**

Reads `$devicesEnrichedStore`, maps each device through `toFilterable`, and calls
`resolvePage(page, devices)`. Renders the page background (`Background`: `solid` → `background`,
`gradient` → `background-image`, `image` → `url(...)` with `background-size: cover`) and one
`GroupSection` per resolved group.

- [ ] **Step 3: Wire the routes**

`src/routes/+page.svelte` renders `PageView` for the first page of `getPageRegistry()`, or a
short "no pages yet" card when the registry is empty. `src/routes/p/[id]/+page.svelte` renders
`PageView` for the page whose `id` matches the route param, falling back to the first page.
Both render the same slim bar: brand, one link per page (`#/p/<id>`), and a gear linking to
`#/devices`. Delete the old Home markup and its styles.

- [ ] **Step 4: Verify in the browser**

Run: `npm run check && npm run lint` (the dev server is already running — do not start another)
Expected: 0 errors. In the browser at `/`: the seeded function groups render as sections with
tiles; resizing to a phone width keeps tiles inside the viewport (no horizontal scrollbar).

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/display/PageView.svelte src/lib/components/display/GroupSection.svelte src/routes/+page.svelte src/routes/p
git commit -m "feat(display): page view, group sections and module grid"
```

---

### Task 9: Tile, slot renderer and value/control slots

**Files:**
- Create: `src/lib/components/display/Tile.svelte`
- Create: `src/lib/components/display/SlotRenderer.svelte`
- Create: `src/lib/components/display/slots/IconSlot.svelte`, `ValueSlot.svelte`, `ControlWidget.svelte`
- Test: covered by Task 5/6 tests plus the Task 8 browser check

**Interfaces:**
- Consumes: `resolveTemplate`, `primaryControl`, `resolveTemplate`'s `ResolvedTemplate`,
  `applyWrite` from `$lib/utils/transform`, `formatValue` from `$lib/config/format`.
- Produces: `Tile.svelte` props `{ device: EnrichedDevice }`; `SlotRenderer.svelte` props
  `{ slot: Slot; device: EnrichedDevice; style: ResolvedStyle }`;
  `ControlWidget.svelte` props `{ control: EnrichedControl }`.

- [ ] **Step 1: Build `ControlWidget.svelte`**

Lift the widget markup from the current `src/routes/+page.svelte` (`switch`, `level`, `color`,
`enum`, `button` branches, including the `write()` helper and the `enumOptions()` helper), so
both tiles and the modal render a control exactly once. Writes go through
`applyWrite(value, control.transform)` and `ioBroker.setState`.

- [ ] **Step 2: Build the slots and the renderer**

`IconSlot` renders the resolved `style.icon` (falling back to `device.icon` or the preset icon)
as a `material-symbols-outlined` glyph coloured by `style.color`. `ValueSlot` renders
`formatValue(control.liveValue, control.unit)`. `SlotRenderer` maps
`level | color | enum | button` → `ControlWidget`, `icon` → `IconSlot`, `value` → `ValueSlot`,
and renders nothing for kinds it does not know yet (badges arrive in Task 11).

- [ ] **Step 3: Build `Tile.svelte`**

Resolves the template once (`resolveTemplate(device, getTemplateRegistry().templates)`), finds
each slot's control by `source` (feature → control id → state id, per spec §4.1), applies the
tile span class from `clampSpan(template.size, breakpoint)`, and renders the device name + one
`SlotRenderer` per visible slot. The tile body is a `<button>` whose action is
`primaryControl(device.controls)`: when it is a writable `switch`, toggle it; otherwise nothing
yet (the modal is Task 13). Non-writable controls render disabled.

- [ ] **Step 4: Verify in the browser**

Run: `npm run check && npm run lint`
Expected: 0 errors. In the browser: seeded pages show icon + name + value per tile; a Light tile
toggles from the tile body; sliders inside a tile do not trigger the tile body action.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/display/Tile.svelte src/lib/components/display/SlotRenderer.svelte src/lib/components/display/slots
git commit -m "feat(display): tiles, slot renderer and control widgets"
```

---

## Phase 3 — rules, badges, interaction

### Task 10: Effects from rules

**Files:**
- Modify: `src/lib/components/display/Tile.svelte`
- Test: covered by Task 6's `resolveStyle` tests

**Interfaces:**
- Consumes: `resolveStyle`, `ruleScope`, `getVirtualPool`.
- Produces: the tile's `style` object, passed to `SlotRenderer`.

- [ ] **Step 1: Resolve styles in `Tile.svelte`**

Build the scope once per device (`ruleScope(device.controls, getVirtualPool())`) and, per slot,
call `resolveStyle([...templateSlot.rules, ...control.rules, ...deviceSlot.rules], scope)`.
Skipped slots are those whose style has `hidden: true`.

- [ ] **Step 2: Emit CSS custom properties**

Set `--tile-accent: <style.color>` and `--tile-glow: <1 | 0>` on the tile element. Tile
background is `style.background` when set. Glow is one shared rule:
`box-shadow: 0 0 12px var(--tile-accent)` — a **static** shadow with no animation, and the whole
effect is dropped inside `@media (prefers-reduced-motion: reduce)` only if it ever animates.

- [ ] **Step 3: Verify in the browser**

Run: `npm run check && npm run lint`
Expected: 0 errors. In the browser: a Light that is on shows the amber glow, off shows the
muted icon; a deliberately broken `when` leaves the tile rendering (Review Focus 3 was already
pinned by test; confirm the same in the UI).

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/display/Tile.svelte
git commit -m "feat(display): value-driven tile effects via CSS custom properties"
```

---

### Task 11: Badges (declared and implicit)

**Files:**
- Create: `src/lib/components/display/slots/BadgeSlot.svelte`
- Create: `src/lib/components/display/BadgeRow.svelte`
- Modify: `src/lib/components/display/Tile.svelte`, `src/lib/components/display/SlotRenderer.svelte`
- Test: covered by Task 6's badge tests

**Interfaces:**
- Consumes: `resolveBadges`, `ResolvedBadge`, `BadgeTone`.
- Produces: `BadgeRow.svelte` props `{ badges: ResolvedBadge[] }`.

- [ ] **Step 1: Build `BadgeRow.svelte`**

Renders at most 3 badges as icon + label with `title`; more than 3 collapses to 3 plus `+n`
(the count is a `<span title>` listing the hidden sources). Tone → class: `info`, `ok`, `warn`,
`danger`, mapped to `--text-muted`, `--tertiary`, `--warning-color`, `--danger-color`.

- [ ] **Step 2: Wire into `Tile.svelte`**

Compute `ts` as the newest `ts` across the device's state-backed controls (same rule as
`lastUpdate` in `src/routes/devices/+page.svelte:53`), then
`resolveBadges(template.slots.filter(s => s.kind === "badge"), device, ts, Date.now())`.
Pass the result into the template so the badge row renders once per tile, at the end of the slot
list, regardless of where badge slots sit in the array.

- [ ] **Step 3: Handle unavailable devices**

A device whose controls are all `available === false` still renders (Task 4 counts only `hidden`
for emptiness) and shows the `offline` badge; its value slots render `—` (existing
`formatValue(null)` behaviour), never `undefined` (Review Focus 5).

- [ ] **Step 4: Verify in the browser**

Run: `npm run check && npm run lint`
Expected: 0 errors. In the browser: tiles show an `ago` badge; a device whose object is missing
shows `offline`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/display/slots/BadgeSlot.svelte src/lib/components/display/BadgeRow.svelte src/lib/components/display/Tile.svelte src/lib/components/display/SlotRenderer.svelte
git commit -m "feat(display): declared and implicit badges"
```

---

### Task 12: Sparkline and history-list slots

**Files:**
- Create: `src/lib/components/display/slots/SparklineSlot.svelte`, `HistoryListSlot.svelte`
- Modify: `src/lib/components/display/SlotRenderer.svelte`
- Test: none new — reuses the history store, which has its own tests

**Interfaces:**
- Consumes: `ensureHistory`, `readHistory` from `$lib/stores/history.svelte.ts` (client passed as
  the first argument), `ioBroker`, `sparklinePoints`.

- [ ] **Step 1: Build `SparklineSlot.svelte`**

Calls `ensureHistory(ioBroker, control.stateId, control.history)` once per slot and renders the
points from `sparklinePoints(...)` as an inline SVG polyline inside a fixed-height box, reusing
the exact styling approach of `HistorySummary.svelte` (`stroke: currentColor`,
`color: var(--primary-color)` — the token is `--primary-color`, not `--primary`).

- [ ] **Step 2: Build `HistoryListSlot.svelte`**

Renders the last 4 samples from `readHistory` as `time — value` lines using `formatAge` and
`formatValue`; renders nothing while the series is empty.

- [ ] **Step 3: Verify in the browser**

Run: `npm run check && npm run lint`
Expected: 0 errors. Add a temporary device with a `history` spec and a `sparkline` slot to a
local page and confirm the line draws; remove it before committing.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/display/slots/SparklineSlot.svelte src/lib/components/display/slots/HistoryListSlot.svelte src/lib/components/display/SlotRenderer.svelte
git commit -m "feat(display): sparkline and history-list slots"
```

---

### Task 13: Full-control modal

**Files:**
- Create: `src/lib/components/display/TileModal.svelte`
- Modify: `src/lib/components/display/Tile.svelte`
- Test: none new (no DOM tests); verified in the browser

**Interfaces:**
- Produces: `TileModal.svelte` props `{ device: EnrichedDevice; onClose: () => void }`.

- [ ] **Step 1: Build `TileModal.svelte`**

A focus-trapped dialog (`<dialog>` or a div with `role="dialog"`, `aria-modal="true"`): device
name + type + room badge as the header, then one `ControlWidget` per non-hidden control, then a
close button. Esc and backdrop click close; focus returns to the tile that opened it.

- [ ] **Step 2: Wire the affordance**

The tile shows a corner ⤢ button (`expand_more` rotated, or `open_in_full`) that opens the
modal; a long-press (touch, `pointerdown` held 500 ms) opens the same modal. Sliders call
`stopPropagation` so dragging never opens it, and the tile body only opens the modal when
`primaryControl` is not a writable switch (spec §7).

- [ ] **Step 3: Verify in the browser**

Run: `npm run check && npm run lint`
Expected: 0 errors. In the browser: corner opens the modal, Esc closes it, focus returns; a
thermostat slider inside the modal writes to the broker.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/display/TileModal.svelte src/lib/components/display/Tile.svelte
git commit -m "feat(display): full-control modal per device"
```

---

### Task 14: Filter chips and view state

**Files:**
- Create: `src/lib/components/display/FilterChips.svelte`
- Modify: `src/lib/components/display/PageView.svelte`, `src/routes/+page.svelte`, `src/routes/p/[id]/+page.svelte`
- Test: covered by Task 4's `filterDevices` tests

**Interfaces:**
- Consumes: `filterDevices`, `FilterChips` type, `roomList` from `$lib/config/rooms`,
  `ioBroker.enums`.
- Produces: `FilterChips.svelte` props `{ chips: FilterChips; onChange: (next: FilterChips) => void }`.

- [ ] **Step 1: Build `FilterChips.svelte`**

Three selects (room, function, favorite) with an "All …" empty option, options from
`ioBroker.enums.getList("rooms" | "functions" | "favorites")`, and a clear button. Emits the
next chips object.

- [ ] **Step 2: Apply into the page view**

`PageView` takes the chips, runs `filterDevices` after `toFilterable`, shows the match count
("12 devices"), and hides groups that filter down to zero unless `showEmpty`. Chips persist to
`localStorage` under one key (`iHome.filters`) and are read at mount — view state only, never
written to config. The same key also stores the collapsed state of each group, keyed by
`page.id + group.id`. Separately, `iHome.lastPage` stores the last opened page id, which the
root route `/` uses in place of "the first page" (falling back to the first page when it is
missing or names a deleted page) — so a wall tablet reboots on the page you left it on.

- [ ] **Step 3: Verify in the browser**

Run: `npm run check && npm run lint`
Expected: 0 errors. In the browser: selecting a room narrows the page and updates the count;
reloading keeps the filter; no config state changes in the broker.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/display/FilterChips.svelte src/lib/components/display/PageView.svelte src/routes/+page.svelte src/routes/p
git commit -m "feat(display): filter chips and persisted view state"
```

---

### Task 15: Subscribe the states that rules and `watch` reference

**Files:**
- Modify: `src/lib/stores/devices.svelte.ts` (`getUsedStateIds`)
- Test: `src/lib/stores/devices.test.ts` (new)

**Interfaces:**
- Consumes: `canonicalRegistry` (module state), `registerProgramStateId`.
- Produces: unchanged signature — `getUsedStateIds(): Set<string>` now also contains every
  `device.watch` id and every raw state id referenced by a rule or slot source.

- [ ] **Step 1: Write the failing test**

```ts
it("includes watch and rule-referenced state ids", () => {
  setCanonicalRegistry({ version: 0, updatedAt: 0, devices: [{
    id: "d", name: "D", type: "Value",
    watch: ["alias.0.EG.Relay.SET"],
    controls: [{ id: "c", feature: "v", writable: false, stateId: "alias.0.EG.Temp",
                 rules: [{ when: "get('alias.0.EG.Other') > 1" }] }],
  }] });
  const ids = getUsedStateIds();
  assert.ok(ids.has("alias.0.EG.Temp"));
  assert.ok(ids.has("alias.0.EG.Relay.SET"));
  assert.ok(ids.has("alias.0.EG.Other"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/stores/devices.test.ts`
Expected: FAIL — `watch`/rule ids are missing. (This test must call `setCanonicalRegistry` in a
`beforeEach` so the module's `usedStateCache` identity check invalidates.)

- [ ] **Step 3: Implement**

In `getUsedStateIds`, inside the device loop, also add every `device.watch` id, and inside the
control loop add ids matched by `/\bget\(\s*['"]([^'"]+)['"]\s*\)/g` applied to each
`rule.when` (control rules and `device.slots[].rules`). This is a *targeted* extraction for
registration only — the expression itself is still evaluated by `evaluateVirtual`; the regex
exists so a raw id in a rule can be subscribed before it is read. A missing id in the regex
degrades to "the rule never matches" (documented in spec §14), not to a crash.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run check && npm run lint && npm run build`
Expected: all green, 0 errors, `www/` written.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/devices.svelte.ts src/lib/stores/devices.test.ts
git commit -m "fix(display): subscribe watch and rule-referenced state ids"
```

---

## Done means

- `npm test` green (existing 180+ tests plus the new ones), `npm run check` 0/0,
  `npm run lint` clean, `npm run build` writes `www/`.
- Opening `/` on the running dev server shows the seeded function-group page; switching to
  `#/rooms` shows the room groups; a device's controls work from its tile and its modal.
- Resizing to phone (375px), tablet (820px) and desktop (1400px) widths never produces a
  horizontal scrollbar and never overflows a tile out of the grid.
- All five Review Focus cases have a test or an explicit browser check, per the task that owns
  them.
