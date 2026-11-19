import { localizeName } from "$lib/config/format";
import { widgetFor } from "$lib/config/features";
import { glyphForRole, presetGlyph } from "$lib/config/icon-ops";
import {
  resolveControl,
  resolveTemplate,
  templateFeatures,
  tileTitle,
} from "$lib/config/template-ops";
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
import { matchingOverride } from "$lib/config/source-overrides";
import type { TemplateReference } from "$lib/config/template-reference";
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

/** A slot from a device control: metadata is copied, the source stays live. */
export function slotFromControl(
  device: Device,
  control: Control & { object?: { common?: Record<string, any> } },
  widget?: Widget,
): Slot {
  // The control's correction is the truth about what it reads (spec §3): a
  // "power" feature may be a number (W/Wh) even though the type preset says
  // switch. The device type/feature map is only the fallback when the effective
  // shape says nothing.
  const meta =
    (control as any).meta ?? effectiveCommon(control, control.object);
  const w = widgetForMeta(
    meta,
    widget ?? widgetFor(device.type, control.feature),
  );
  const options = rangeOptions(meta);
  const label = control.label ?? meta.name;
  // The same role fallback the raw-state path uses: a control slot gets its
  // switch/light/… badge instead of a blank face, unless the object names one.
  const ownIcon =
    typeof meta.icon === "string" && meta.icon.trim()
      ? meta.icon.trim()
      : undefined;
  const glyph = ownIcon ?? glyphForRole(meta.role, meta.type);
  // No unit copy: the resolver returns the effective unit (and hideUnit).
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

/**
 * A device's probable slots: walk a recipe (the type preset or a user
 * template), resolve each hint to one of the device's **actual** controls, and
 * drop everything that matches nothing. No control, no slot.
 */
export function suggestedSlots(device: Device, recipe: Slot[]): Slot[] {
  const out: Slot[] = [];
  for (const slot of recipe) {
    // A recipe names its control by source or by hint (`options.pick`); the
    // hinted presets (Thermometer's positional readings) use the latter.
    const hint =
      typeof slot.source === "string"
        ? slot.source
        : String(slot.options?.pick ?? "");
    if (!hint.trim()) continue;
    const control = resolveControl(
      (device.controls ?? []).filter((c) => !c.hidden),
      hint,
    );
    if (!control) continue;
    const widget = widgetFor(device.type, control.feature);
    const base = slotFromControl(device, control, widget);
    // The live state's shape wins over the recipe's kind: a recipe's "switch"
    // hint on a Wh reading must still render as a value. Non-widget kinds
    // (history-list, icon, …) are the recipe's own and stay.
    const kind = WIDGET_KINDS.includes(slot.kind) ? base.kind : slot.kind;
    // The hint is dead weight once the source pins the control (A36).
    const options: Record<string, unknown> = { ...(base.options ?? {}) };
    for (const [key, value] of Object.entries(slot.options ?? {})) {
      if (key !== "pick" && value !== undefined) options[key] = value;
    }
    out.push({
      ...base,
      ...slot,
      kind,
      source: base.source,
      label: slot.label ?? base.label,
      unit: slot.unit ?? base.unit,
      ...(Object.keys(options).length ? { options } : { options: undefined }),
    });
  }
  return out;
}

/** A control that names real data: a state, a virtual or a formula. A control
 *  left empty by a template is not bound and never preselected. */
function isBoundControl(control: Control): boolean {
  return !!(
    control.stateId ||
    control.kind === "virtual" ||
    control.virtual ||
    control.formulaId
  );
}

/**
 * The controls a new tile starts with: every control that names real data.
 * Controls a template left empty (no state, no virtual/formula) are skipped.
 */
export function preselectedControlIds(device: Device): string[] {
  return (device.controls ?? [])
    .filter((c) => !c.hidden && isBoundControl(c))
    .map((c) => c.id);
}

/** What a brand-new tile inherits from its first slot: a name, the type's size
 *  and one default glyph. An offer frozen at creation, never a live link (S11). */
export interface TileSeed {
  title?: string;
  size?: Size;
  icon?: string;
  active?: ActiveCondition;
  look?: TileLook;
  background?: Background;
}

/** A template's active condition with its feature name bound to the control. */
function materializeActive(
  active: ActiveCondition | undefined,
  features: Set<string>,
  device: Device,
): ActiveCondition | undefined {
  if (!active) return undefined;
  if (typeof active.source !== "string") return active;
  if (!features.has(active.source)) return active;
  const control = resolveControl(device.controls ?? [], active.source);
  if (!control) return undefined;
  return {
    ...active,
    source: { kind: "control", device: device.id, control: control.id },
  };
}

/** A template's slots with feature names bound to the device's controls. */
function materializeSlots(template: Template, device: Device): Slot[] {
  const features = new Set(templateFeatures(template).map((f) => f.feature));
  const out: Slot[] = [];
  for (const slot of template.slots ?? []) {
    const source = typeof slot.source === "string" ? slot.source : "";
    const pick =
      typeof slot.options?.pick === "string" ? slot.options.pick : "";
    const hint = features.has(source) ? source : features.has(pick) ? pick : "";
    if (!hint) {
      out.push(slot);
      continue;
    }
    const [mapped] = suggestedSlots(device, [slot]);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Point a template's `ago` badge at the primary control (usually power). */
function materializeAgo(
  slots: Slot[],
  template: Template,
  device: Device,
): Slot[] {
  const features = templateFeatures(template);
  const primary = features.find((feature) => feature.primary) ?? features[0];
  const control =
    device.controls?.find((entry) => entry.feature === primary?.feature) ??
    device.controls?.[0];
  const keys = new Set(features.map((feature) => feature.feature));
  return slots.map((slot) => {
    if (slot.source !== "ago") return slot;
    const of = typeof slot.options?.of === "string" ? slot.options.of : "";
    const nextOf = of && keys.has(of) ? (control?.stateId ?? control?.id) : of;
    return {
      ...slot,
      options: {
        ...slot.options,
        ...(nextOf ? { of: nextOf } : {}),
        ...(slot.options?.from ? {} : { from: "lc" }),
      },
    };
  });
}

/** A complete tile for a device created from this template. */
export function materializeTemplateTile(
  template: Template,
  device: Device,
  templates: Template[],
): {
  slots: Slot[];
  active?: ActiveCondition;
  look?: TileLook;
  size?: Size;
  background?: Background;
  border?: boolean;
  padding?: boolean;
  title?: string;
  icon?: string;
} {
  // A role template is bound to states, never a device's controls: producing
  // slots here would write role strings and the template-only `repair` into a
  // device tile. Callers show `templateDeviceProblem`; this is the last guard.
  if (template.roles?.length) return { slots: [] };
  const slots = materializeAgo(
    materializeSlots(template, device),
    template,
    device,
  );
  const seed = tileSeed(slots, [device], templates);
  const active = materializeActive(
    template.active,
    new Set(templateFeatures(template).map((f) => f.feature)),
    device,
  );
  return {
    slots,
    ...seed,
    ...(template.active !== undefined ? { active } : {}),
    ...(template.look ? { look: template.look } : {}),
    ...(template.background ? { background: template.background } : {}),
    ...(template.border === false ? { border: false } : {}),
    ...(template.padding === false ? { padding: false } : {}),
  };
}

/**
 * A complete tile for a state + template, with no device created: the same
 * slots as the device tile, bound to the broker states around the main one.
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
): ReturnType<typeof materializeTemplateTile> {
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
): ReturnType<typeof materializeTemplateTile> {
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
): ReturnType<typeof materializeTemplateTile> {
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
    slots.push({
      ...base,
      ...slot,
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
): ReturnType<typeof materializeTemplateTile> {
  const roles = new Set(template.roles ?? []);
  /** The override each state got, so two roles on one state share it. */
  const ensured = new Map<string, EnsuredOverride>();
  const bound: { slot: Slot; role: string; override?: EnsuredOverride }[] = [];

  for (const slot of template.slots ?? []) {
    const { repair, ...presentation } = slot;
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

  // A tile's rules are scoped by `tileSourceControls` (the override's name) and
  // `ruleScope` sanitizes that name (`Power (W)` → `power_w`, a renamed
  // `power2` stays `power2`). Build the same locals in slot order so a template
  // rule names the local the tile will actually have.
  const taken = newLocalTaken();
  const roleLocal = new Map<string, string>();
  for (const entry of bound) {
    if (!entry.role) continue;
    const fill = fills.get(entry.role);
    const name =
      entry.override?.name ||
      localizeName(fill?.object?.common?.name) ||
      fill?.ref ||
      entry.role;
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
  materialized: ReturnType<typeof materializeTemplateTile>,
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

export function tileSeed(
  slots: Slot[],
  devices: Device[],
  templates: Template[],
): TileSeed {
  const first = slots[0];
  if (!first || first.kind === "frame") return {};
  const source = first.source;
  if (!source || typeof source === "string") {
    return first.label ? { title: first.label } : {};
  }
  if (source.kind === "state") {
    return first.label ? { title: first.label } : {};
  }
  const device = devices.find((d) => d.id === source.device);
  if (!device) return first.label ? { title: first.label } : {};
  const typeGlyph = presetGlyph(device.type);
  const resolved = resolveTemplate(device, templates);
  const features = new Set(resolved.features.map((f) => f.feature));
  const active = materializeActive(resolved.active, features, device);
  return {
    title: tileTitle(device) || undefined,
    size: resolved.size,
    // A Custom device has no face of its own: the first control's glyph is the
    // meaningful one, not the type preset's generic "widgets" placeholder.
    icon:
      device.type === "Custom" ? (first.icon?.glyph ?? typeGlyph) : typeGlyph,
    ...(active ? { active } : {}),
    ...(resolved.look ? { look: resolved.look } : {}),
    ...(resolved.background ? { background: resolved.background } : {}),
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
    ...(tile.active ? {} : seed.active ? { active: seed.active } : {}),
    ...(look ? { look } : {}),
  };
}
