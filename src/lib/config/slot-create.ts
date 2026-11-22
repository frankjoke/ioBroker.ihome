import { localizeName } from "$lib/config/format";
import { glyphForRole, presetGlyph } from "$lib/config/icon-ops";
import { templateFeatures } from "$lib/config/template-ops";
import { widgetFor } from "$lib/config/features";
import { effectiveCommon, widgetForMeta } from "$lib/config/state-meta";
import {
  aliasBaseIds,
  autoFillTemplate,
  deviceGroupOfState,
  groupOfState,
  groupStates,
  isInfrastructure,
  roleMatchRank,
  type FeatureCandidate,
} from "$lib/config/template-suggest";
import { sanitizeLabel, newLocalTaken } from "$lib/config/virtual-ops";
import { matchingOverride, sourceRuleName } from "$lib/config/source-overrides";
import { resolveTemplateReference } from "$lib/config/template-reference";
import type { TemplateReference } from "$lib/config/template-reference";
import type { GlobalVariable } from "$lib/config/variables";
import type { Control, Device, Widget } from "$lib/types/device";
import type { EnsuredOverride, SourceOverride } from "$lib/types/overrides";
import type {
  ActiveCondition,
  Background,
  Size,
  Slot,
  SlotKind,
  Template,
  TemplateRepair,
  TileConfig,
  TileLook,
} from "$lib/types/display";

/** The slot without the template-only capture fields. */
function slotPresentation(slot: Slot): Slot {
  const copy = { ...slot };
  delete copy.repair;
  delete copy.origin;
  return copy;
}

/** The slot kinds that render a control widget: the live state's shape wins
 *  over a recipe's kind for these. */
const WIDGET_KINDS: SlotKind[] = [
  "value",
  "level",
  "switch",
  "color",
  "enum",
  "button",
];

/** The slot that renders a control widget. */
export function slotKindForWidget(widget: Widget): SlotKind {
  switch (widget) {
    case "switch":
      return "switch";
    case "level":
      return "level";
    case "color":
      return "color";
    case "enum":
      return "enum";
    case "button":
      return "button";
    default:
      return "value";
  }
}

function rangeOptions(common: Record<string, any>): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of ["min", "max", "step"] as const) {
    if (common[key] !== undefined) options[key] = common[key];
  }
  return options;
}

/** A slot from a device control: metadata is copied, the source stays live.
 *  Used by the one-time page migration; the display no longer resolves it. */
export function slotFromControl(
  device: Device,
  control: Control & { object?: { common?: Record<string, any> } },
  widget?: Widget,
): Slot {
  const meta =
    (control as any).meta ?? effectiveCommon(control, control.object);
  const w = widgetForMeta(
    meta,
    widget ?? widgetFor(device.type, control.feature),
  );
  const options = rangeOptions(meta);
  const label = control.label ?? meta.name;
  const ownIcon =
    typeof meta.icon === "string" && meta.icon.trim()
      ? meta.icon.trim()
      : undefined;
  const glyph = ownIcon ?? glyphForRole(meta.role, meta.type);
  return {
    kind: slotKindForWidget(w),
    source: { kind: "control", device: device.id, control: control.id },
    ...(label ? { label } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(glyph ? { icon: { glyph } } : {}),
  };
}

/** A slot from a raw broker state, with the state's own metadata copied. An
 *  override id binds the slot to that state's repair/derived presentation. */
export function slotFromState(
  stateId: string,
  object: any,
  kind: SlotKind,
  overrideId?: string,
): Slot {
  const common = object?.common ?? {};
  const options = rangeOptions(common);
  const label = localizeName(common.name);
  const ownIcon =
    typeof common.icon === "string" && common.icon.trim()
      ? common.icon.trim()
      : undefined;
  const glyph = ownIcon ?? glyphForRole(common.role, common.type);
  return {
    kind,
    source: {
      kind: "state",
      stateId,
      ...(overrideId ? { override: overrideId } : {}),
    },
    ...(label ? { label } : {}),
    ...(common.unit ? { unit: common.unit } : {}),
    ...(Object.keys(options).length ? { options } : {}),
    ...(glyph ? { icon: { glyph } } : {}),
  };
}

/** What a template materialises into: a tile config's own fields. */
export interface MaterializedTile {
  slots: Slot[];
  active?: ActiveCondition;
  look?: TileLook;
  size?: Size;
  background?: Background;
  border?: boolean;
  padding?: boolean;
  title?: string;
  icon?: string;
}

/**
 * A complete tile for a state + template, bound to the broker states around the
 * main one. A role template recreates the repairs its slots carry.
 */
export function materializeTemplateTileFromState(
  template: Template,
  main: TemplateReference,
  objects: Map<string, any>,
  anchorFeature?: string,
  overrides: SourceOverride[] = [],
  ensureOverride?: (
    stateId: string,
    repair: TemplateRepair,
  ) => EnsuredOverride | undefined,
): MaterializedTile {
  if (template.roles?.length) {
    return materializeTemplateTileFromFills(
      template,
      autoFillRoles(template, main, objects, anchorFeature, overrides),
      main,
      ensureOverride,
    );
  }
  const { fills } = autoFillTemplate(template, main, objects, anchorFeature);
  return materializeTemplateTileFromFills(template, boundFills(fills), main);
}

/** The source chosen per feature, keeping only unambiguous auto-fills and
 *  letting a manual choice win over them. */
export function boundFills(
  fills: FeatureCandidate[],
  manual: Map<string, TemplateReference> = new Map(),
): Map<string, TemplateReference> {
  const out = new Map<string, TemplateReference>();
  for (const fill of fills) {
    if (!fill.ref || !fill.object) continue;
    out.set(fill.feature.feature, {
      ref: fill.ref,
      stateId: fill.stateId ?? fill.ref,
      object: fill.object,
      ...(fill.overrideId ? { overrideId: fill.overrideId } : {}),
      ...(fill.overrideName ? { overrideName: fill.overrideName } : {}),
    });
  }
  for (const [feature, ref] of manual) out.set(feature, ref);
  return out;
}

/** A row the template applicator offers: a role (role template) or a feature
 *  (legacy feature template). */
export interface TemplateBindingRow {
  /** The fill map key and the slot's source string. */
  key: string;
  label: string;
  primary: boolean;
  /** The role template's repaired unit, for auto-fill. */
  unit?: string;
  /** The role template's saved repair, recreated on the picked state. */
  repair?: TemplateRepair;
}

/** The features the mapping modal offers: those a slot (or `active`) names,
 *  plus the primary. A template whose slots carry no feature hint offers its
 *  whole feature list. Role templates list their roles instead. */
export function templateBindingRows(template: Template): TemplateBindingRow[] {
  if (template.bindings === "none") return [];
  if (template.roles?.length) {
    const active =
      typeof template.active?.source === "string" ? template.active.source : "";
    const rows: TemplateBindingRow[] = template.roles.map((role) => {
      const slot = (template.slots ?? []).find(
        (entry) => entry.source === role,
      );
      const repair = slot?.repair;
      const label = String(slot?.label ?? repair?.label ?? "").trim() || role;
      const unit = slot?.unit ?? repair?.unit;
      return {
        key: role,
        label,
        primary: false,
        ...(unit ? { unit } : {}),
        ...(repair ? { repair } : {}),
      };
    });
    const primary = rows.find((row) => row.key === active) ?? rows[0];
    if (primary) primary.primary = true;
    return rows;
  }
  const features = templateFeatures(template);
  const known = new Set(features.map((feature) => feature.feature));
  const used = new Set<string>();
  const add = (value: string | undefined): void => {
    if (value && known.has(value)) used.add(value);
  };
  for (const slot of template.slots ?? []) {
    add(typeof slot.source === "string" ? slot.source : undefined);
    add(typeof slot.options?.pick === "string" ? slot.options.pick : undefined);
  }
  add(
    typeof template.active?.source === "string"
      ? template.active.source
      : undefined,
  );
  const rows = !used.size
    ? features
    : features.filter(
        (feature) => used.has(feature.feature) || feature.primary,
      );
  return rows.map((feature) => ({
    key: feature.feature,
    label: feature.label,
    primary: feature.primary === true,
  }));
}

/** The states auto-fill may offer: the main state's group, its alias bases and
 *  the parent device, minus the main state and its bases. */
function siblingPool(
  main: TemplateReference,
  objects: Map<string, any>,
): TemplateReference[] {
  const bases = aliasBaseIds(main.object);
  const aliasGroup = groupOfState(main.stateId, objects);
  const baseGroups = bases
    .map((id) => groupOfState(id, objects, true))
    .filter((id) => id !== aliasGroup);
  const exclude = new Set([main.stateId, ...bases]);
  const basePool = [
    ...new Set(baseGroups.flatMap((group) => groupStates(group, objects))),
  ].filter((entry) => !exclude.has(entry.stateId) && !isInfrastructure(entry));
  const aliasPool = groupStates(aliasGroup, objects).filter(
    (entry) => !exclude.has(entry.stateId) && !isInfrastructure(entry),
  );
  const deviceGroup = deviceGroupOfState(main.stateId, objects);
  const devicePool =
    deviceGroup !== aliasGroup
      ? groupStates(deviceGroup, objects).filter(
          (entry) => !exclude.has(entry.stateId) && !isInfrastructure(entry),
        )
      : [];
  const seen = new Set<string>();
  return [...basePool, ...aliasPool, ...devicePool].filter((entry) => {
    if (seen.has(entry.stateId)) return false;
    seen.add(entry.stateId);
    return true;
  });
}

/** Whether a sibling state fits a role row by role, unit or name. Exact/leaf
 *  role (4) beats family role (3), then unit (2), then name (1). */
function roleFitScore(
  entry: TemplateReference,
  repair: TemplateRepair | undefined,
  role: string,
): number {
  const common = entry.object?.common ?? {};
  const wanted = String(repair?.role ?? role ?? "")
    .trim()
    .toLowerCase();
  const rank = roleMatchRank(wanted, String(common.role ?? ""));
  if (rank === 3) return 4;
  if (rank === 2) return 3;
  const unit = String(repair?.unit ?? "")
    .trim()
    .toLowerCase();
  const stateUnit = String(common.unit ?? "")
    .trim()
    .toLowerCase();
  if (unit && stateUnit && unit === stateUnit) return 2;
  const label = String(repair?.label ?? "")
    .trim()
    .toLowerCase();
  const name = String(common.name ?? "").toLowerCase();
  if (label && name && (name.includes(label) || label.includes(name))) return 1;
  return 0;
}

/**
 * Auto-fill a role template from the main state's siblings: a unique role
 * match wins, then a unique unit, then a unique name. A state's existing
 * repair is carried on the fill, so applying never duplicates it.
 */
export function autoFillRoles(
  template: Template,
  main: TemplateReference,
  objects: Map<string, any>,
  anchorRole?: string,
  overrides: SourceOverride[] = [],
): Map<string, TemplateReference> {
  const roles = template.roles ?? [];
  const fallback =
    typeof template.active?.source === "string"
      ? template.active.source
      : roles[0];
  const anchor =
    anchorRole && roles.includes(anchorRole) ? anchorRole : fallback;
  const pool = siblingPool(main, objects);
  const out = new Map<string, TemplateReference>();
  const used = new Set([main.stateId, ...aliasBaseIds(main.object)]);
  if (anchor) {
    out.set(anchor, withOverride(main, overrides, template, anchor));
    used.add(main.stateId);
  }
  for (const role of roles) {
    if (role === anchor) continue;
    const slot = (template.slots ?? []).find((entry) => entry.source === role);
    const repair = slot?.repair;
    const scored = pool
      .filter((entry) => !used.has(entry.stateId))
      .map((entry) => ({
        entry,
        score: Math.max(
          roleFitScore(entry, repair, role),
          ...overrides
            .filter((o) => o.kind === "repair" && o.stateId === entry.stateId)
            .map((o) => {
              const rank = roleMatchRank(repair?.role ?? role, o.role ?? "");
              return rank === 3 ? 4 : rank === 2 ? 3 : 0;
            }),
        ),
      }));
    for (const score of [4, 3, 2, 1]) {
      const hits = scored.filter((item) => item.score === score);
      if (hits.length === 0) continue;
      if (hits.length > 1) break; // ambiguous: never guess
      const entry = hits[0].entry;
      out.set(role, withOverride(entry, overrides, template, role));
      used.add(entry.stateId);
      break;
    }
  }
  return out;
}

/** A sibling fill, carrying the override a role already resolves through. */
function withOverride(
  reference: TemplateReference,
  overrides: SourceOverride[],
  template: Template,
  role: string,
): TemplateReference {
  if (reference.overrideId) return reference;
  const slot = (template.slots ?? []).find((entry) => entry.source === role);
  const repair = slot?.repair;
  const hit = matchingOverride(overrides, reference.stateId, {
    name: repair?.name ?? role,
    role: repair?.role ?? role,
  });
  return hit
    ? {
        ...reference,
        overrideId: hit.id,
        overrideName: hit.name,
      }
    : reference;
}

/** Roles whose captured origin still exists here, so applying a template from
 *  this instance needs no pick. */
export function originFills(
  template: Template,
  objects: Map<string, any>,
  variables: GlobalVariable[],
): Map<string, TemplateReference> {
  const out = new Map<string, TemplateReference>();
  for (const slot of template.slots ?? []) {
    const role = typeof slot.source === "string" ? slot.source : "";
    if (!role || !slot.origin || out.has(role)) continue;
    if (!objects.has(slot.origin)) continue;
    const resolved = resolveTemplateReference(slot.origin, objects, variables);
    if ("problem" in resolved) continue;
    out.set(role, resolved.reference);
  }
  return out;
}

/** A complete tile from a template and an explicit role/feature → source map.
 *  Unbound roles/features are left out; raw (frame/HTML) and `ago` slots stay.
 *  Role templates recreate their repair through `ensureOverride`, which the
 *  caller wires to the override store (one call per state without an override). */
export function materializeTemplateTileFromFills(
  template: Template,
  fills: Map<string, TemplateReference>,
  main: TemplateReference,
  ensureOverride?: (
    stateId: string,
    repair: TemplateRepair,
  ) => EnsuredOverride | undefined,
): MaterializedTile {
  if (template.roles?.length) {
    return materializeRoleTile(template, fills, main, ensureOverride);
  }
  return materializeFeatureTile(template, fills, main);
}

/** Legacy feature templates: binds the fills by feature name. */
function materializeFeatureTile(
  template: Template,
  fills: Map<string, TemplateReference>,
  main: TemplateReference,
): MaterializedTile {
  const features = templateFeatures(template);
  const byName = new Map(features.map((feature) => [feature.feature, feature]));

  const slots: Slot[] = [];
  for (const slot of template.slots ?? []) {
    const source = typeof slot.source === "string" ? slot.source : "";
    const pick =
      typeof slot.options?.pick === "string" ? slot.options.pick : "";
    const hint = byName.has(source) ? source : byName.has(pick) ? pick : "";
    if (!hint) {
      slots.push(slot);
      continue;
    }
    const entry = fills.get(hint);
    if (!entry) continue;
    const def = byName.get(hint)!;
    const kind = WIDGET_KINDS.includes(slot.kind)
      ? slotKindForWidget(widgetForMeta(entry.object?.common ?? {}, def.widget))
      : slot.kind;
    const base = slotFromState(entry.ref, entry.object, kind, entry.overrideId);
    const options: Record<string, unknown> = { ...(base.options ?? {}) };
    for (const [key, value] of Object.entries(slot.options ?? {})) {
      if (key !== "pick" && value !== undefined) options[key] = value;
    }
    const presentation = slotPresentation(slot);
    slots.push({
      ...base,
      ...presentation,
      kind,
      source: base.source,
      // Same caption the device tile gets: the recipe's, else the feature's.
      label: slot.label ?? def.label,
      unit: slot.unit ?? base.unit,
      ...(Object.keys(options).length ? { options } : { options: undefined }),
    });
  }

  // The ago badge tracks the main control, exactly as the device tile does.
  const primary = features.find((feature) => feature.primary) ?? features[0];
  const mainRef = (primary && fills.get(primary.feature)?.ref) ?? main.ref;
  const bound = slots.map((slot) =>
    slot.source === "ago"
      ? {
          ...slot,
          options: {
            ...slot.options,
            of: mainRef,
            ...(slot.options?.from ? {} : { from: "lc" }),
          },
        }
      : slot,
  );

  const activeSource = template.active?.source;
  const activeFill =
    typeof activeSource === "string" ? fills.get(activeSource) : undefined;
  const name = localizeName(main.object?.common?.name);
  const glyph = bound[0]?.icon?.glyph ?? presetGlyph(template.type);
  return {
    slots: bound,
    ...(activeFill && template.active
      ? {
          active: {
            ...template.active,
            source: { kind: "state", stateId: activeFill.ref },
          },
        }
      : {}),
    ...(template.look ? { look: template.look } : {}),
    ...(template.size ? { size: template.size } : {}),
    ...(template.background ? { background: template.background } : {}),
    ...(template.border === false ? { border: false } : {}),
    ...(template.padding === false ? { padding: false } : {}),
    ...(name ? { title: name } : {}),
    ...(glyph ? { icon: glyph } : {}),
  };
}

/** A role template: the slot's saved presentation, bound to a picked state. */
function materializeRoleTile(
  template: Template,
  fills: Map<string, TemplateReference>,
  main: TemplateReference,
  ensureOverride?: (
    stateId: string,
    repair: TemplateRepair,
  ) => EnsuredOverride | undefined,
): MaterializedTile {
  const roles = new Set(template.roles ?? []);
  /** The override each state got, so two roles on one state share it. */
  const ensured = new Map<string, EnsuredOverride>();
  const bound: { slot: Slot; role: string; override?: EnsuredOverride }[] = [];

  for (const slot of template.slots ?? []) {
    const repair = slot.repair;
    const presentation = slotPresentation(slot);
    const role = typeof slot.source === "string" ? slot.source : "";
    if (!role || !roles.has(role)) {
      bound.push({ slot: presentation, role: "" });
      continue;
    }
    const fill = fills.get(role);
    if (!fill) continue;
    let override = ensured.get(fill.stateId);
    if (fill.overrideId) {
      override = {
        id: fill.overrideId,
        name: fill.overrideName ?? override?.name ?? role,
      };
    } else if (!override && repair && ensureOverride) {
      override = ensureOverride(fill.stateId, repair);
    }
    if (override) ensured.set(fill.stateId, override);
    bound.push({
      slot: {
        ...presentation,
        source: {
          kind: "state",
          stateId: fill.ref,
          ...(override ? { override: override.id } : {}),
        },
      },
      role,
      ...(override ? { override } : {}),
    });
  }

  // A tile's rules are scoped by `tileSourceControls` (the override's name,
  // else the id leaf) and `ruleScope` sanitizes that name (`Power (W)` →
  // `power_w`, a renamed `power2` stays `power2`). Broker names are only the
  // label aliases `ruleScope` appends last, so a leaf keeps its local even when
  // another slot's broker name collides with it. Build the same locals in slot
  // order so a template rule names the local the tile will actually have.
  const taken = newLocalTaken();
  const roleLocal = new Map<string, string>();
  for (const entry of bound) {
    if (!entry.role) continue;
    const fill = fills.get(entry.role);
    const name =
      sourceRuleName({
        overrideName: entry.override?.name,
        stateId: fill?.stateId ?? fill?.ref,
      }) ?? entry.role;
    const local = sanitizeLabel(name, taken);
    if (!roleLocal.has(entry.role)) roleLocal.set(entry.role, local);
  }
  const keys = [...roleLocal.entries()]
    .filter(([role, local]) => role !== local)
    .map(([role]) => role)
    .sort((a, b) => b.length - a.length);
  const pattern = keys.length
    ? new RegExp(`\\b(${keys.join("|")})\\b`, "g")
    : null;
  const rewrite = (slot: Slot): Slot => {
    if (!pattern || !slot.rules?.length) return slot;
    return {
      ...slot,
      rules: slot.rules.map((rule) =>
        rule.when
          ? {
              ...rule,
              when: rule.when.replace(
                pattern,
                (name) => roleLocal.get(name) ?? name,
              ),
            }
          : rule,
      ),
    };
  };
  const boundSlots = bound.map((entry) => rewrite(entry.slot));

  const mainRef = main.ref;
  const withAgo = boundSlots.map((slot) =>
    slot.source === "ago"
      ? {
          ...slot,
          options: {
            ...slot.options,
            of: mainRef,
            ...(slot.options?.from ? {} : { from: "lc" }),
          },
        }
      : slot,
  );

  const activeSource = template.active?.source;
  const activeFill =
    typeof activeSource === "string" ? fills.get(activeSource) : undefined;
  const activeSlot =
    typeof activeSource === "string"
      ? withAgo.find(
          (slot) =>
            typeof slot.source === "object" &&
            slot.source.kind === "state" &&
            slot.source.stateId === activeFill?.ref,
        )
      : undefined;
  const name = localizeName(main.object?.common?.name);
  const glyph = withAgo[0]?.icon?.glyph ?? presetGlyph(template.type);
  return {
    slots: withAgo,
    ...(activeFill && template.active
      ? {
          active: {
            ...template.active,
            source:
              activeSlot && typeof activeSlot.source === "object"
                ? activeSlot.source
                : { kind: "state", stateId: activeFill.ref },
          },
        }
      : {}),
    ...(template.look ? { look: template.look } : {}),
    ...(template.size ? { size: template.size } : {}),
    ...(template.background ? { background: template.background } : {}),
    ...(template.border === false ? { border: false } : {}),
    ...(template.padding === false ? { padding: false } : {}),
    ...(name ? { title: name } : {}),
    ...(glyph ? { icon: glyph } : {}),
  };
}

/** The tile config a materialised template produces (a new tile or an applied
 *  template), so the two callers cannot drift. */
export function materializedTileConfig(
  materialized: MaterializedTile,
): TileConfig {
  const tile: TileConfig = {
    slots: materialized.slots,
    ...(materialized.size ? { size: materialized.size } : {}),
    ...(materialized.background ? { background: materialized.background } : {}),
    ...(materialized.border === false ? { border: false } : {}),
    ...(materialized.padding === false ? { padding: false } : {}),
    ...(materialized.active ? { active: materialized.active } : {}),
    ...(materialized.look ? { look: materialized.look } : {}),
    // The face icon is a frozen copy of the template's default look, else the
    // first slot/type glyph; `iconAuto` lets a pool default dress the face and
    // keeps this glyph as the fallback. The slot's own icon stays independent.
    ...(materialized.look?.inactive?.glyph || materialized.icon
      ? {
          icon: materialized.look?.inactive?.glyph ?? materialized.icon,
          iconAuto: true,
        }
      : {}),
  };
  return tile;
}

/** What a brand-new tile inherits from its first slot: a name. An offer frozen
 *  at creation, never a live link (S11). */
export interface TileSeed {
  title?: string;
  size?: Size;
  icon?: string;
  active?: ActiveCondition;
  look?: TileLook;
  background?: Background;
  border?: boolean;
  padding?: boolean;
  /** The template this seed came from. */
  template?: string;
}

/** A brand-new tile's frozen offer from its first slot: its name. Size, icon
 *  and look come from the template's materialised config, not from here. */
export function tileSeed(slots: Slot[]): TileSeed {
  const first = slots[0];
  if (!first || first.kind === "frame") return {};
  return first.label ? { title: first.label } : {};
}

/** The template's own defaults for a freshly created tile. */
export function templateTileSeed(template: Template): TileSeed {
  return {
    title: template.name,
    ...(template.size ? { size: template.size } : {}),
    ...(template.active ? { active: template.active } : {}),
    ...(template.look ? { look: template.look } : {}),
    ...(template.background ? { background: template.background } : {}),
    ...(template.border !== undefined ? { border: template.border } : {}),
    ...(template.padding !== undefined ? { padding: template.padding } : {}),
    template: template.id,
  };
}

/** Merge a template's tile defaults into a new placement. */
export function applyTileSeed(tile: TileConfig, seed: TileSeed): TileConfig {
  const look = seed.look
    ? {
        ...seed.look,
        ...tile.look,
        ...(seed.look.active || tile.look?.active
          ? { active: { ...seed.look.active, ...tile.look?.active } }
          : {}),
        ...(seed.look.inactive || tile.look?.inactive
          ? { inactive: { ...seed.look.inactive, ...tile.look?.inactive } }
          : {}),
      }
    : tile.look;
  return {
    ...tile,
    ...(tile.size ? {} : seed.size ? { size: seed.size } : {}),
    ...(tile.background
      ? {}
      : seed.background
        ? { background: seed.background }
        : {}),
    ...(tile.border === undefined && seed.border !== undefined
      ? { border: seed.border }
      : {}),
    ...(tile.padding === undefined && seed.padding !== undefined
      ? { padding: seed.padding }
      : {}),
    ...(tile.active ? {} : seed.active ? { active: seed.active } : {}),
    ...(look ? { look } : {}),
    ...(seed.template ? { template: seed.template } : {}),
  };
}
