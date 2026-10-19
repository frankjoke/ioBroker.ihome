# The slot icons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The icon becomes a property of the slot it decorates — editable glyph, per-slot enable, its own display home — while legacy `kind: "icon"` slots keep rendering exactly as today and fold onto their slot on request.

**Architecture:** One optional descriptor on `Slot` (`icon?: { glyph?, enabled?, where? }`); the slot's existing rules dress it. `tile-parts` answers the icon question once (headline pick, per-row visibility); `tile-ops` carries the mutations (`patchIcon`, `foldIconSlot`). The renderer (cluster in `SlotRenderer`, header and rows in `ModalPanel`) and the editor (the icon block in `LayoutDetails`) consume those pure answers. The presets fold their icon onto the slot they named; nothing stored changes silently (A51–A58).

**Tech Stack:** Svelte 5 (runes), TypeScript, Vitest, Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-ihome-slot-icons-design.md` (A51–A58).

**Global constraints:**
- Gates after every task: `npm test`, `npm run check` (0 errors / 0 warnings), `npm run lint` (0), `npm run build`.
- Svelte 5 runes only. One commit per task, project style (`type(scope): lowercase sentence`, A-numbers in the message where they apply).
- Every browser check is **read-only** against the live setup: inspect, never commit a document write (no toggling icon fields on live tiles, no "Move into its slot"). The interactive pass on real tiles is the user's.
- The pure modules own every decision; components consume them — no second answer (A46/A47).
- Comments in the house voice: explain the why, name the A-decision.

**Review Focus:**
1. **Legacy fidelity (A52/A56):** with a `kind: "icon"` slot present, the tile renders — accent, glow, dim — exactly as today; `pickSlotControls`' icon non-consumption (A36) is untouched.
2. **One resolution:** the tile cluster, the modal rows and the header all read `tile-parts`' answers; no component re-derives `enabled`/`where`.
3. **The fold is faithful and never silent:** glyph, `where` and rules carry (rules appended last), the target's existing icon is overwritten only when the fold carries one, and nothing happens without a click + confirm.
4. **Presets:** every preset's icon lands on the slot its source named (or the headline for hint-based ones), pinned by a test.

---

### Task 1: The descriptor and the resolution (A51/A52/A54)

**Files:**
- Modify: `src/lib/types/display.ts` (add `SlotIcon`; `Slot.icon`)
- Modify: `src/lib/config/tile-parts.ts` (`headlineSlot`, `rowIcon`)
- Modify: `src/lib/config/tile-parts.test.ts`
- Modify: `src/lib/utils/icon-url.ts` (`collectDocumentIcons` learns `glyph`)
- Modify: `src/lib/utils/icon-url.test.ts`

**Interfaces:**
- Consumes: `Slot`, `SlotRow`, `ResolvedStyle` (all exist).
- Produces:
  ```ts
  /** One slot's icon (A51): presence gates it, the slot's own rules dress it. */
  export interface SlotIcon {
    glyph?: string;   // one raw string (A23): symbol name, image URL, data: URL, broker path
    enabled?: boolean;                // absent = enabled while the descriptor exists
    where?: "tile" | "both" | "modal"; // the icon's homes; absent = both
  }
  // in `Slot`: icon?: SlotIcon;

  /** The tile's face (A52): the first value slot, else the first non-icon slot. */
  export function headlineSlot(slots: Slot[]): Slot | undefined;

  /** What a resolved row shows in `home` (A51/A54): enabled, glyphed, allowed. */
  export function rowIcon(
    row: SlotRow,
    home: "tile" | "modal",
  ): { glyph: string; color?: string; disabled?: boolean } | undefined;
  ```

- [x] **Step 1: Write the failing tests** — add to `tile-parts.test.ts` (the file already builds `device()`/`tile()` fixtures):

```ts
it("picks the headline: value first, else the first non-icon slot", …)
  // value anywhere (even `where:"modal"`) beats a leading button/level
  // [{kind:"icon"},{kind:"button"},{kind:"value"}] → the value
  // [{kind:"icon"},{kind:"button"}] → the button (the legacy icon slot is skipped)
  // [] → undefined
it("reads a row's icon from the descriptor, the rule icon winning", …)
  // no descriptor → undefined
  // { icon: { glyph: "x" } } with style.icon undefined → glyph "x"
  // same + rules resolved so row.style.icon === "y" → glyph "y"
it("honours enabled and the icon's own homes", …)
  // { icon: { glyph:"x", enabled:false } } → undefined in both homes
  // where:"tile" → defined for "tile", undefined for "modal" (and vice versa)
  // where absent / "both" → both homes
  // { icon: {} } (no glyph anywhere) → undefined
it("carries the style's colour and dim", …)
  // a matching rule with color/disabled → the returned object has them
```
- [x] **Step 2: Run them** — `npx vitest run src/lib/config/tile-parts.test.ts` → FAIL.
- [x] **Step 3: Implement** — the types as above; in `tile-parts.ts`:

```ts
/** The tile's face (A52): the first value slot, else the first non-icon slot —
 *  a legacy Button tile's face is its button, not its old icon slot. */
export function headlineSlot(slots: Slot[]): Slot | undefined {
  return (
    slots.find((s) => s.kind === "value") ?? slots.find((s) => s.kind !== "icon")
  );
}

/** The icon a resolved row shows in `home` (A51/A54): enabled, glyphed, allowed
 *  there — the last matching rule's glyph beats the descriptor's. */
export function rowIcon(
  row: SlotRow,
  home: "tile" | "modal",
): { glyph: string; color?: string; disabled?: boolean } | undefined {
  const icon = row.slot.icon;
  if (!icon || icon.enabled === false) return undefined;
  const where = icon.where ?? "both";
  if (where !== "both" && where !== home) return undefined;
  const glyph = row.style.icon ?? icon.glyph;
  return glyph
    ? { glyph, color: row.style.color, disabled: row.style.disabled }
    : undefined;
}
```
- [x] **Step 4: Run them** → PASS.
- [x] **Step 5: The picker's Document tab sees slot icons** — in `collectDocumentIcons`, the walker currently collects string values under the key `"icon"`; the new descriptor stores its glyph under `"glyph"`, so extend the key test to `(key === "icon" || key === "glyph")`. Extend the existing test's registry with a slot `{ kind:"value", icon:{ glyph:"probe" } }` and expect `"probe"` in the result.
- [x] **Step 6: Gates** — `npm test`, `npm run check`, `npm run lint`, `npm run build`.
- [x] **Step 7: Commit** — `feat(display): a slot's icon is its own property (A51)`

---

### Task 2: The mutations (A56)

**Files:**
- Modify: `src/lib/config/tile-ops.ts` (`patchIcon`, `iconSlotTarget`, `foldIconSlot`)
- Modify: `src/lib/config/tile-ops.test.ts`

**Interfaces:**
- Consumes: `SlotIcon` (Task 1), `withSlots` (the module's own helper).
- Produces:
  ```ts
  /** Set or clear one icon field; `undefined` removes the key; a descriptor left
   *  without keys disappears (the document never carries `icon: {}`). */
  export function patchIcon(tile: TileConfig, index: number, patch: Partial<SlotIcon>): TileConfig;

  /** Where a legacy icon slot would fold to (A56): the first other slot with the
   *  same source, else the first value slot, else the first non-icon slot —
   *  null when there is nowhere (or the index is not a legacy icon slot). */
  export function iconSlotTarget(tile: TileConfig, index: number): number | null;

  /** Fold a legacy icon slot onto its slot (A56): glyph + where + rules move
   *  (rules appended after the target's, last match wins), the icon slot is
   *  removed; the tile comes back untouched when there is no target. */
  export function foldIconSlot(tile: TileConfig, index: number): TileConfig;
  ```

- [x] **Step 1: Write the failing tests** — `tile-ops.test.ts`:

```ts
it("patches one icon field and never leaves {} behind", …)
  // patchIcon(t, 0, { glyph:"x" }) → icon { glyph:"x" }; input not mutated
  // patchIcon(…, { glyph: undefined }) → the descriptor is gone
  // patchIcon(…, { enabled:false }) on a glyphed slot keeps the glyph
it("finds the slot a legacy icon folds onto", …)
  // [{kind:"icon",source:"power"},{kind:"value",source:"power"}] → 1 (source match)
  // no match → the first value; no value → the first non-icon; alone → null
  // a non-icon index → null
it("folds glyph, where and rules onto the target", …)
  // rules appended AFTER the target's existing ones (order pinned)
  // explicit where carries; absent stays absent (default both)
  // the icon slot is removed, other slots keep their order
it("handles a rules-only icon slot", …)
  // no options.icon, but a rule with `icon` → the target gets a glyphless descriptor
  // (the rule supplies the glyph); nothing carried (no glyph, no where, no icon-
  // bearing rule) → the target's own icon, if any, stays untouched
it("refuses quietly when there is no target", …)  // toBe(tile)
```
- [x] **Step 2: Run them** — `npx vitest run src/lib/config/tile-ops.test.ts` → FAIL.
- [x] **Step 3: Implement** — all three in the module's house style (pure, new objects, `withSlots`; see `setSlotWhere` for the delete-the-default pattern):
  ```ts
  export function iconSlotTarget(tile: TileConfig, index: number): number | null {
    const slots = tile.slots ?? [];
    const slot = slots[index];
    if (!slot || slot.kind !== "icon") return null;
    const others = slots.map((s, i) => ({ s, i })).filter(({ i }) => i !== index);
    const at = (pick: (s: Slot) => boolean): number | null =>
      others.find(({ s }) => pick(s))?.i ?? null;
    return (
      (slot.source ? at((s) => s.source === slot.source) : null) ??
      at((s) => s.kind === "value") ??
      at((s) => s.kind !== "icon")
    );
  }
  ```
  `foldIconSlot`: resolve the target; build the descriptor `{ glyph?, where? }` from `options.icon` (non-empty string) and `slot.where`; `carries` = glyph | where | a rule with `icon`; map the slots once — target gets `rules: [...(target.rules ?? []), ...(iconSlot.rules ?? [])]` and, when `carries`, `icon: descriptor` — then drop the icon slot. No target → `return tile`.
  `patchIcon`: merge `{...slot.icon, ...patch}`, delete `undefined` keys, set `icon` or delete it; other slots untouched.
- [x] **Step 4: Run them** → PASS.
- [x] **Step 5: Gates.**
- [x] **Step 6: Commit** — `feat(config): folding an icon slot onto its slot (A56)`

---

### Task 3: The presets (A55)

**Files:**
- Modify: `src/lib/config/presets.ts`
- Modify: `src/lib/config/template-ops.test.ts`

**Interfaces:** consumes `SlotIcon` (Task 1). No new exports.

- [x] **Step 1: Re-author the presets** — drop the `icon()` helper and its header comment; each preset's `icon(source, glyph, rules?)` entry folds onto the slot carrying the same source (or the headline for hint-based ones), with the icon slot's entry removed:

  | preset | target (index after the fold) | glyph |
  |---|---|---|
  | Switch | `value power` (0) + its two rules | `power_settings_new` |
  | Button | `button press` (0) | `touch_app` |
  | Light | `value power` (0) + its two rules | `lightbulb` |
  | Thermostat | `value actual` (0) | `thermostat` |
  | Thermometer | first `value` (0, the temperature hint slot) | `device_thermostat` |
  | Blind | `level position` (0) | `blinds` |
  | Window | `value open` (0) + its two rules | `window` |
  | Motion | `value motion` (0) + its two rules | `sensors` |
  | AC | `value power` (3 — after temperature/mode/fan) | `ac_unit` |
  | Value | the bare `value` (0) | `speed` |
  | Custom | `value value` (0) | `widgets` |

  Shape: `{ kind: "value", source: "power", icon: { glyph: "lightbulb" }, rules: […] }` — rules unchanged, only moved.
- [x] **Step 2: Update the existing preset tests** — `template-ops.test.ts`'s "dims an idle motion sensor" and "gives the light its on/off icon rules" now read the folded slot (`slots.find((s) => s.source === "motion")`, `s.source === "power"`); expectations on `rules.map(r => r.when)` and `disabled` stay.
- [x] **Step 3: Add the integrity test** — in `template-ops.test.ts`, one test over a table of `[type, index, glyph]` per the table above: exactly one slot in each preset carries an `icon` descriptor, at that index, with that glyph; and no preset slot has `kind: "icon"` any more.
- [x] **Step 4: Run the tests** → PASS. (`npx vitest run src/lib/config/template-ops.test.ts`)
- [x] **Step 5: Gates.** No browser check here — the folded descriptors render only after Task 4 (this task is test-only).
- [x] **Step 6: Commit** — `feat(config): the presets carry their icon on the slot (A55)`

---

### Task 4: The renderer (A52–A54)

**Files:**
- Modify: `src/lib/components/display/SlotRenderer.svelte` (the wrapping cluster)
- Modify: `src/lib/components/display/Tile.svelte` (accent source, body icons, header icon)
- Modify: `src/lib/components/display/TileModal.svelte` (pass `headIcon` through)
- Modify: `src/lib/components/display/ModalPanel.svelte` (header icon, row icons)

**Interfaces:**
- Consumes: `headlineSlot`, `rowIcon` (Task 1), `Icon` (`$lib/components/common/Icon.svelte`).
- Produces (component props):
  ```ts
  // SlotRenderer
  icon?: { glyph: string; color?: string; disabled?: boolean; size?: number };
  stack?: boolean;          // the primary cluster at a 1-wide span (A53)
  // TileModal → ModalPanel
  headIcon?: { glyph: string; color?: string; disabled?: boolean };
  // ModalPanel rows gain
  icon?: { glyph: string; color?: string; disabled?: boolean };
  ```

- [x] **Step 1: `SlotRenderer.svelte`** — move the rendering branches into a `{#snippet content()}`, then:
  ```svelte
  {#if show}
    {#if icon}
      <div class="slot-cluster" class:stack>
        <span class="slot-icon" style:color={icon.color}>
          <Icon value={icon.glyph} size={icon.size ?? 17} dim={icon.disabled} />
        </span>
        {@render content()}
      </div>
    {:else}
      {@render content()}
    {/if}
  {/if}
  ```
  CSS: `.slot-cluster { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:0.3rem; min-width:0; max-width:100% }`; `.slot-cluster.stack { flex-direction: column; gap: 0.1rem }`; `.slot-icon { display:inline-flex; align-items:center }`. Without an `icon` prop the markup is exactly as today.
- [x] **Step 2: `Tile.svelte`** —
  - import `headlineSlot`, `rowIcon` from `$lib/config/tile-parts`; `type SlotRow`.
  - `const headline = $derived(headlineSlot(slots));` (after the `slots` derived).
  - the accent (A52): replace `iconSlot` with
    ```ts
    // The accent the tile wears (A52): the legacy icon slot while one exists —
    // today's behaviour, byte for byte — else the headline slot's style. The
    // *style* carries, so "glow when on" keeps working with the icon disabled.
    const accentSlot = $derived(
      slots.find((s) => s.kind === "icon") ?? headline ?? { kind: "icon" as const },
    );
    const tileStyle = $derived(slotStyle(accentSlot, controlFor(accentSlot)));
    ```
  - body icon helper + the header row:
    ```ts
    /** The body-row icon (A51/A53): the headline's is the big glyph, the rest small. */
    function bodyIcon(r: SlotRow) {
      const icon = rowIcon(r, "tile");
      return icon ? { ...icon, size: r.slot === headline ? 34 : 17 } : undefined;
    }
    const headlineRow = $derived(
      [...parts.body, ...parts.background, ...parts.modal].find((r) => r.slot === headline),
    );
    // The detail page's face (A54): the headline's icon, wherever its slot lives.
    const headIcon = $derived(headlineRow ? rowIcon(headlineRow, "modal") : undefined);
    ```
  - body loop: `icon={bodyIcon(r)} stack={r.slot === headline && span.w < 2}`.
  - `modalRows` mapping: add `icon: rowIcon(r, "modal")` per row.
  - `<TileModal … headIcon={headIcon} />`.
- [x] **Step 3: `TileModal.svelte`** — add the `headIcon` prop (type above) and pass it to `ModalPanel`; the `rows` type gains `icon?`.
- [x] **Step 4: `ModalPanel.svelte`** — import `Icon`; header renders the icon first inside `.head-main`:
  ```svelte
  {#if headIcon}
    <span class="head-icon" style:color={headIcon.color}>
      <Icon value={headIcon.glyph} size={26} dim={headIcon.disabled} />
    </span>
  {/if}
  ```
  Non-frame rows render the icon before the label:
  ```svelte
  {#if r.icon}
    <span class="row-icon" style:color={r.icon.color}>
      <Icon value={r.icon.glyph} size={18} dim={r.icon.disabled} />
    </span>
  {/if}
  ```
  Frame rows: a small centred cap line with the icon *above* the (unchanged) `.row-frame` block:
  ```svelte
  {#if r.icon}
    <div class="row frame-cap"><span class="row-icon" style:color={r.icon.color}>
      <Icon value={r.icon.glyph} size={18} dim={r.icon.disabled} /></span></div>
  {/if}
  <div class="row-frame">…</div>
  ```
  CSS: `.head-icon, .row-icon { display:inline-flex; align-items:center; color: var(--text-muted) }`; `.frame-cap { justify-content: center }`. Sizes: header 26, rows 18 (A53's note: settled against the preview).
- [x] **Step 5: Gates.**
- [x] **Step 6: Browser check (read-only)** — on the dev server against the live document: every materialised legacy tile is visually unchanged on the display and in its detail page (accent, glow, dim, no extra icons); if any tile in the document is unmaterialised, its icon now renders with the reading (1-wide stacks, 2-wide like Thermostat/Blind sits beside). No writes — the live document has no slot icons yet, so the new look's fuller pass is the user's interactive one (Task 6).
- [x] **Step 7: Commit** — `feat(display): the icon renders with its reading (A52–A54)`

---

### Task 5: The editor (A57) and the picker

**Files:**
- Modify: `src/lib/components/layout/LayoutDetails.svelte`
- Modify: `src/lib/components/layout/SlotPicker.svelte`

**Interfaces:** consumes `headlineSlot` (Task 1), `patchIcon`, `iconSlotTarget`, `foldIconSlot` (Task 2), `IconPicker`, `ConfirmModal` (exist).

- [ ] **Step 1: `SlotPicker.svelte`** — `kindsFor` drops `"icon"` from both lists (`["value", "badge", ...DEVICE_KINDS]` / `["value", "badge"]`); confirm `DEVICE_KINDS` contains no `"icon"`.
- [ ] **Step 2: `LayoutDetails.svelte`** —
  - imports: `foldIconSlot`, `iconSlotTarget`, `patchIcon` (tile-ops); `headlineSlot` (tile-parts); `type SlotIcon` (types/display).
  - consts/state: `const ICON_KINDS: SlotKind[] = ["value", "level", "color", "enum", "button"];`, `let iconPickerFor = $state<number | null>(null);`, `let pendingFold = $state<number | null>(null);`.
  - helpers (near `patchOptions`):
    ```ts
    function setIcon(i: number, patch: Partial<SlotIcon>): void {
      edit((t) => patchIcon(t, i, patch));
    }

    /** The icon's homes cycle both → tile → modal → both (A57); a modal-only
     *  slot has no tile to show on, so "tile" is skipped for it. */
    function nextIconWhere(i: number): "tile" | "both" | "modal" {
      const slot = shownSlots[i];
      const cur = slot?.icon?.where ?? "both";
      const next = cur === "both" ? "tile" : cur === "tile" ? "modal" : "both";
      return next === "tile" && slotWhere(slot) === "modal" ? "modal" : next;
    }

    function iconWhereTitle(i: number): string {
      const cur = shownSlots[i]?.icon?.where ?? "both";
      return `Icon shows: ${WHERE_LABEL[cur]} — click for ${WHERE_LABEL[nextIconWhere(i)]}`;
    }

    function foldTargetLabel(i: number): string {
      const at = iconSlotTarget({ slots: shownSlots }, i);
      const slot = at === null ? undefined : shownSlots[at];
      return slot ? `${slot.kind} · ${slotLabel(slot)}` : "its slot";
    }
    ```
  - the **icon block**, between the hint/knobs rows and the `.slot-rules` div, only `{#if ICON_KINDS.includes(slot.kind)}`:
    - toggle (on → drop the `enabled` key, or write `{ enabled: true }` on a fresh descriptor; off → `{ enabled: false }`), shorthand: `e.currentTarget.checked ? setIcon(i, slot.icon ? { enabled: undefined } : { enabled: true }) : setIcon(i, { enabled: false })`;
    - when `slot.icon` exists: a Glyph text input (`patchIcon(t, i, { glyph: value.trim() || undefined })`), a `Choose…` button opening the picker, and the where tri-state button (`WHERE_GLYPH[slot.icon.where ?? "both"]`, writing `nextIconWhere(i) === "both" ? undefined : nextIconWhere(i)`);
    - a hint when enabled with no glyph and no rule icon: `No glyph yet — pick one, or let a rule supply it.`
  - collapsed row: after the `KIND_GLYPH` icon, the tiny preview `{#if slot.icon && slot.icon.enabled !== false && slot.icon.glyph}<Icon value={slot.icon.glyph} size={15} />{/if}`; after the summary, the headline tag `{#if slot === headlineSlot(shownSlots)}<span class="hint-badge" title="…tile's face…">headline</span>{/if}`.
  - legacy rows: marker in `.slot-head` (`{#if slot.kind === "icon"}<span class="hint-badge text-muted">legacy</span>{/if}`); in the expanded pane a row with the fold button:
    ```svelte
    <button type="button" class="btn btn-sm"
      disabled={iconSlotTarget({ slots: shownSlots }, i) === null}
      title={…}
      onclick={() => (pendingFold = i)}>Move into its slot</button>
    ```
  - kind select: `{#each Object.keys(KIND_GLYPH).filter((k) => k !== "icon" || slot.kind === "icon") as k (k)}`.
  - rules note: for non-icon kinds append `Rule <code>icon</code> swaps the slot icon's glyph (only while the icon is enabled).`
  - picker instance and the fold confirm (both next to the existing `ruleIconFor` picker / `pendingReset` modal):
    ```svelte
    {#if iconPickerFor !== null}
      <IconPicker
        icon={shownSlots[iconPickerFor]?.icon?.glyph}
        onPick={(value) => {
          const target = iconPickerFor;
          iconPickerFor = null;
          if (target === null) return;
          edit((t) => patchIcon(t, target, { glyph: value.trim() || undefined }));
        }}
        onClose={() => (iconPickerFor = null)}
      />
    {/if}
    ```
    Confirm text (A56): the glyph, rules and display home move onto `{foldTargetLabel(pendingFold)}`; an icon already there is overwritten; visibility the icon slot had is not kept — the icon follows that slot from now on.
- [ ] **Step 3: Gates.**
- [ ] **Step 4: Browser check (read-only)** — open the sheet on a tile: the icon block shows on a value slot (toggle, glyph field, Choose…, where button), the collapsed row shows the headline tag on its headline slot, a legacy icon slot shows its marker and the fold button is enabled/disabled sensibly; opening the picker and cancelling writes nothing.
- [ ] **Step 5: Commit** — `feat(editor): the icon block and the legacy fold (A57)`

---

### Task 6: Live verification and the handoff

**Files:**
- Modify: `docs/progress/handoff-2026-10-19-iobroker-visual-adapter.md` (the day's handoff: this slice's state)

- [ ] **Step 1: Read-only pass** on the live setup (dev server against `192.168.178.9:8081`): legacy materialised tiles unchanged on the display and their detail pages; the editor's icon block, headline tag, legacy marker visible; no new console errors (the known Sentry/`templateList` noise excepted).
- [ ] **Step 2: The interactive pass is the user's** — resetting a tile to adopt the new preset look, adding a secondary icon, flipping the icon off, setting it detail-only, and folding a legacy icon slot all write to the live document; list them in the handoff as the user's checklist rather than performing them.
- [ ] **Step 3: Update the handoff** — what shipped (A51–A58), the new look for unmaterialised tiles, the fold, the controls, and the user's checklist; keep the naming scheme.
- [ ] **Step 4: Commit** — `docs: the slot icons, verified against the live display`

---

## Self-review notes (done at plan time)

- **Spec coverage:** A51 → Tasks 1/2/4; A52 → Task 4 (accent) + 1 (headline); A53 → Task 4; A54 → Tasks 1/4; A55 → Tasks 3; A56 → Tasks 2/5; A57 → Task 5; A58 → Task 5 (the note only — no second rules UI). §7 error cases land in Task 5 (disabled fold button, confirm wording) and Task 1 (`enabled` gate).
- **Known interim state:** between Task 3 and Task 4 no descriptor renders yet, and between Task 4 and Task 5 the fold is unreachable from the UI — both are commit-bounded, gates stay green throughout.
- **Not in this plan:** anything from the spec's non-goals (no second rules UI, no badge/frame icons in the editor, no `kind: "icon"` retirement).
