import { featureCatalog, type FeatureDef } from "$lib/config/features";
import { resolveSlotSource, type SourceLook } from "$lib/config/slot-source";
import { featureMatchRank } from "$lib/config/template-suggest";
import { sanitizeLabel } from "$lib/config/virtual-ops";
import type { DeviceType } from "$lib/types/device";
import type {
  ActiveCondition,
  Rule,
  Slot,
  Template,
  TileConfig,
} from "$lib/types/display";

export interface TileTemplateOptions {
  id: string;
  name: string;
  type: DeviceType;
  look: SourceLook;
}

export interface TileTemplateResult {
  template: Template;
  /** Slots whose state/control could not be mapped to a feature. */
  omitted: number;
}

const TYPE_ORDER: DeviceType[] = [
  "Switch",
  "Light",
  "Thermostat",
  "Thermometer",
  "Blind",
  "Window",
  "Motion",
  "AC",
  "Meter",
  "Value",
  "Button",
  "Custom",
];

/** The state id behind a slot's source, for re-linking an `ago` badge. */
function sourceId(slot: Slot, look: SourceLook): string | undefined {
  if (!slot.source || typeof slot.source !== "object") return undefined;
  return resolveSlotSource(slot.source, look)?.stateId;
}

/** The feature a slot reads: control feature, then role, then label. */
function featureForSlot(
  slot: Slot,
  catalog: FeatureDef[],
  look: SourceLook,
): FeatureDef | undefined {
  const pick =
    typeof slot.options?.pick === "string" ? slot.options.pick : undefined;
  if (typeof slot.source === "string") {
    const hint = slot.source;
    return (
      catalog.find((feature) => feature.feature === hint) ??
      (pick ? catalog.find((feature) => feature.feature === pick) : undefined)
    );
  }
  if (!slot.source) return undefined;
  const resolved = resolveSlotSource(slot.source, look);
  const controlFeature = resolved?.control?.feature;
  if (controlFeature) {
    const hit = catalog.find((feature) => feature.feature === controlFeature);
    if (hit) return hit;
  }
  if (resolved?.object) {
    let best: FeatureDef | undefined;
    let rank = 0;
    for (const feature of catalog) {
      const score = featureMatchRank(feature, resolved.object);
      if (score > rank) {
        best = feature;
        rank = score;
      }
    }
    if (best) return best;
  }
  const label = String(slot.label ?? resolved?.label ?? "")
    .trim()
    .toLowerCase();
  if (!label) return undefined;
  return catalog.find(
    (feature) =>
      feature.label.toLowerCase() === label ||
      feature.feature.toLowerCase() === label,
  );
}

/**
 * The type a tile looks most like: count the slots each type's feature catalog
 * can explain. A control feature is the strongest signal, then a role, then a
 * label; a power-only tile resolves to Switch, not Light.
 */
export function inferTemplateType(
  tile: TileConfig | undefined,
  look: SourceLook,
): DeviceType {
  let best: DeviceType = "Custom";
  let bestScore = 0;
  for (const type of TYPE_ORDER) {
    if (type === "Custom") continue;
    const catalog = featureCatalog(type);
    let score = 0;
    for (const slot of tile?.slots ?? []) {
      if (typeof slot.source === "string") {
        if (catalog.some((feature) => feature.feature === slot.source)) {
          score += 4;
        }
        continue;
      }
      if (!slot.source) continue;
      const resolved = resolveSlotSource(slot.source, look);
      if (!resolved) continue;
      const controlFeature = resolved.control?.feature;
      if (
        controlFeature &&
        catalog.some((feature) => feature.feature === controlFeature)
      ) {
        score += 4;
        continue;
      }
      let rank = 0;
      if (resolved.object) {
        for (const feature of catalog) {
          rank = Math.max(rank, featureMatchRank(feature, resolved.object));
        }
      }
      if (!rank) {
        const label = String(slot.label ?? resolved.label ?? "")
          .trim()
          .toLowerCase();
        if (
          label &&
          catalog.some(
            (feature) =>
              feature.label.toLowerCase() === label ||
              feature.feature.toLowerCase() === label,
          )
        ) {
          rank = 1;
        }
      }
      score += rank;
    }
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return best;
}

/** A tile's slots as a reusable template: state/control sources become feature
 *  hints, so the template materialises against another device of the same type. */
export function collectTileTemplate(
  tile: TileConfig,
  options: TileTemplateOptions,
): TileTemplateResult {
  const catalog = featureCatalog(options.type);
  type Part =
    | { kind: "feature"; slot: Slot; feature: FeatureDef }
    | { kind: "ago"; slot: Slot }
    | { kind: "raw"; slot: Slot };
  const parts: Part[] = [];
  const aliases = new Map<string, string | null>();
  let omitted = 0;

  /** A rule's local name for a source: feature, state name and slot label. */
  const localName = (value: unknown): string | undefined => {
    const text = String(value ?? "").trim();
    return text ? sanitizeLabel(text, new Set()) : undefined;
  };
  const addAlias = (name: string | undefined, target: string): void => {
    if (!name || name === target) return;
    const known = aliases.get(name);
    if (known === undefined) aliases.set(name, target);
    else if (known !== target) aliases.set(name, null);
  };

  for (const slot of tile.slots ?? []) {
    if (slot.kind === "frame" || slot.kind === "html") {
      parts.push({ kind: "raw", slot });
      continue;
    }
    if (slot.source === "ago") {
      parts.push({ kind: "ago", slot });
      continue;
    }
    const feature = featureForSlot(slot, catalog, options.look);
    if (!feature) {
      omitted++;
      continue;
    }
    parts.push({ kind: "feature", slot, feature });
    const target = sanitizeLabel(feature.feature, new Set());
    const resolved =
      slot.source && typeof slot.source === "object"
        ? resolveSlotSource(slot.source, options.look)
        : undefined;
    addAlias(localName(slot.label), target);
    addAlias(localName(resolved?.label), target);
    addAlias(localName(resolved?.control?.feature), target);
  }

  const mapped = parts.filter(
    (part): part is Extract<Part, { kind: "feature" }> =>
      part.kind === "feature",
  );
  const activeFeature = (() => {
    const active = tile.active;
    if (!active?.source) return undefined;
    if (typeof active.source === "string") {
      return catalog.find((feature) => feature.feature === active.source);
    }
    return featureForSlot(
      { kind: "value", source: active.source },
      catalog,
      options.look,
    );
  })();
  const primary =
    activeFeature ??
    mapped.find((entry) => entry.feature.feature === "power")?.feature ??
    mapped[0]?.feature;
  const features = [
    ...new Map(
      mapped.map((entry) => [entry.feature.feature, entry.feature]),
    ).values(),
  ].map((feature) => ({
    ...feature,
    primary: feature.feature === primary?.feature ? true : undefined,
  }));

  const slots: Slot[] = [];
  for (const part of parts) {
    if (part.kind === "raw") {
      slots.push(part.slot);
      continue;
    }
    if (part.kind === "ago") {
      const of =
        typeof part.slot.options?.of === "string" ? part.slot.options.of : "";
      const target =
        mapped.find((entry) => sourceId(entry.slot, options.look) === of)
          ?.feature.feature ?? primary?.feature;
      slots.push({
        ...part.slot,
        options: {
          ...part.slot.options,
          ...(target ? { of: target } : {}),
        },
      });
      continue;
    }
    const slotOptions = { ...part.slot.options };
    delete slotOptions.pick;
    const rest = { ...part.slot };
    delete rest.from;
    slots.push({
      ...rest,
      source: part.feature.feature,
      ...(Object.keys(slotOptions).length ? { options: slotOptions } : {}),
    });
  }

  // A rule written against a state's local name (e.g. `available`) must name
  // the feature (`connected`) in the template, or it breaks on the next tile.
  const names = [...aliases.entries()]
    .filter(([, target]) => target)
    .map(([name]) => name);
  const aliasPattern = names.length
    ? new RegExp(`\\b(${names.join("|")})\\b`, "g")
    : null;
  const rewriteRule = (rule: Rule): Rule =>
    aliasPattern && rule.when
      ? {
          ...rule,
          when: rule.when.replace(
            aliasPattern,
            (name) => aliases.get(name) ?? name,
          ),
        }
      : rule;
  const rewritten = slots.map((slot) =>
    slot.rules?.length ? { ...slot, rules: slot.rules.map(rewriteRule) } : slot,
  );

  const active: ActiveCondition | undefined =
    tile.active && activeFeature
      ? { ...tile.active, source: activeFeature.feature }
      : undefined;

  return {
    omitted,
    template: {
      id: options.id,
      name: options.name,
      type: options.type,
      basedOn: options.type,
      builtin: false,
      features,
      slots: rewritten,
      ...(tile.size ? { size: tile.size } : {}),
      ...(tile.look ? { look: tile.look } : {}),
      ...(tile.background ? { background: tile.background } : {}),
      ...(active ? { active } : {}),
    },
  };
}
