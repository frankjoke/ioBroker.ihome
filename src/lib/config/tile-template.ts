import { featureCatalog } from "$lib/config/features";
import { resolveSlotSource, type SourceLook } from "$lib/config/slot-source";
import { featureMatchRank } from "$lib/config/template-suggest";
import { sanitizeLabel } from "$lib/config/virtual-ops";
import type { DeviceType } from "$lib/types/device";
import type {
  Rule,
  Slot,
  Template,
  TemplateRepair,
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

/** How many distinct origins a tile reads: one per control/device source,
 *  plus one group for raw states. Applying a template anchors on one of them. */
export function tileSourceCount(tile: TileConfig | undefined): number {
  const devices = new Set<string>();
  let states = false;
  const sources = [
    tile?.active?.source,
    ...(tile?.slots ?? []).map((slot) => slot.source),
  ];
  for (const source of sources) {
    if (!source || typeof source === "string") continue;
    if (source.kind === "state") states = true;
    else devices.add(source.device);
  }
  return devices.size + (states ? 1 : 0);
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

/** A number from a slot option, so a repair keeps the tuned range. */
function optionNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return value === undefined ||
    value === null ||
    value === "" ||
    !Number.isFinite(n)
    ? undefined
    : n;
}

/** A tile's slots as a reusable role template: one role per bound source, with
 *  the repair fields the source presented, so applying it to a fresh state can
 *  recreate the override (spec §3.4). */
export function collectTileTemplate(
  tile: TileConfig,
  options: TileTemplateOptions,
): TileTemplateResult {
  type Part =
    | {
        kind: "bound";
        slot: Slot;
        role: string;
        stateId?: string;
        override?: string;
      }
    | { kind: "ago"; slot: Slot }
    | { kind: "raw"; slot: Slot };
  const parts: Part[] = [];
  const aliases = new Map<string, string | null>();
  /** One role per distinct source; two slots reading it share the role. */
  const roleForSource = new Map<string, string>();
  const roles: string[] = [];
  const taken = new Set<string>();
  let omitted = 0;

  /** A rule's local name for a source: override name, state name and label. */
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
    if (!slot.source) {
      omitted++;
      continue;
    }
    const source = slot.source;
    const resolved =
      typeof source === "object"
        ? resolveSlotSource(source, options.look)
        : undefined;
    if (
      typeof source === "object" &&
      (!resolved || resolved.available === false)
    ) {
      omitted++;
      continue;
    }
    const identity =
      typeof source === "object" && source.kind === "state"
        ? `state:${resolved?.stateId ?? source.stateId}:override:${source.override ?? ""}`
        : typeof source === "object" && source.kind === "control"
          ? `control:${source.device}:${source.control}`
          : undefined;
    let role = identity ? roleForSource.get(identity) : undefined;
    if (!role) {
      // The role a state expects: its override/object role, else the widget
      // class (`switch`, `button`, `value`, `level`, …).
      const baseRole =
        String(resolved?.role ?? "").trim() ||
        String(resolved?.widget ?? "").trim() ||
        (typeof source === "string" ? source : slot.kind);
      role = sanitizeLabel(baseRole, taken);
      if (identity) roleForSource.set(identity, role);
      roles.push(role);
    }
    const meta = resolved?.meta;
    const label =
      String(slot.label ?? resolved?.label ?? "").trim() || undefined;
    const unit =
      typeof slot.unit === "string"
        ? slot.unit
        : resolved?.unit
          ? resolved.unit
          : undefined;
    const min = optionNumber(slot.options?.min) ?? meta?.min;
    const max = optionNumber(slot.options?.max) ?? meta?.max;
    const step = optionNumber(slot.options?.step) ?? meta?.step;
    const decimals = optionNumber(slot.options?.decimals);
    const repair: TemplateRepair = {
      kind: "repair",
      name: role,
      ...(label ? { label } : {}),
      ...(unit ? { unit } : {}),
      ...(meta?.type ? { type: meta.type } : {}),
      ...(resolved?.role ? { role: resolved.role } : {}),
      ...(meta?.states ? { states: meta.states } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(step !== undefined ? { step } : {}),
      ...(decimals !== undefined ? { decimals } : {}),
      ...(meta?.read !== undefined ? { read: meta.read } : {}),
      ...(meta?.write !== undefined ? { write: meta.write } : {}),
      ...(meta?.unit === "" ? { hideUnit: true } : {}),
      ...(resolved?.transform ? { transform: resolved.transform } : {}),
      ...(resolved?.history ? { history: resolved.history } : {}),
    };
    const slotOptions = { ...(slot.options ?? {}) };
    delete slotOptions.pick;
    const rest = { ...slot };
    delete rest.from;
    const origin =
      typeof source === "object"
        ? (resolved?.stateId ??
          (source.kind === "state" ? source.stateId : undefined))
        : undefined;
    parts.push({
      kind: "bound",
      slot: {
        ...rest,
        source: role,
        ...(Object.keys(slotOptions).length ? { options: slotOptions } : {}),
        repair,
        ...(origin ? { origin } : {}),
      },
      role,
      ...(typeof source === "object" && source.kind === "state"
        ? {
            stateId: resolved?.stateId ?? source.stateId,
            ...(source.override ? { override: source.override } : {}),
          }
        : typeof source === "object" && source.kind === "control"
          ? { stateId: resolved?.stateId }
          : {}),
    });
    addAlias(localName(slot.label), role);
    addAlias(localName(resolved?.label), role);
    if (typeof source === "string") addAlias(localName(source), role);
    const override = resolved?.overrideId
      ? options.look.overrides?.find((o) => o.id === resolved.overrideId)
      : undefined;
    addAlias(localName(override?.name), role);
    addAlias(localName(override?.label), role);
  }

  const slots: Slot[] = [];
  for (const part of parts) {
    if (part.kind === "raw" || part.kind === "bound") {
      slots.push(part.slot);
      continue;
    }
    const of =
      typeof part.slot.options?.of === "string" ? part.slot.options.of : "";
    const boundParts = parts.filter(
      (entry): entry is Extract<Part, { kind: "bound" }> =>
        entry.kind === "bound",
    );
    const target =
      boundParts.find((entry) => entry.stateId === of && !entry.override)
        ?.role ??
      boundParts.find((entry) => entry.stateId === of)?.role ??
      roles[0];
    slots.push({
      ...part.slot,
      options: {
        ...part.slot.options,
        ...(target ? { of: target } : {}),
      },
    });
  }

  // A rule written against a state's local name (e.g. `available`) must name
  // the role (`indicator_reachable`) in the template, or it breaks on apply.
  const names = [...aliases.entries()]
    .filter(([, target]) => target)
    .map(([name]) => name);
  const aliasPattern = names.length
    ? new RegExp(`\\b(${names.join("|")})\\b`, "gi")
    : null;
  const rewriteRule = (rule: Rule): Rule =>
    aliasPattern && rule.when
      ? {
          ...rule,
          when: rule.when.replace(
            aliasPattern,
            (name) => aliases.get(name.toLowerCase()) ?? name,
          ),
        }
      : rule;
  const rewritten = slots.map((slot) =>
    slot.rules?.length ? { ...slot, rules: slot.rules.map(rewriteRule) } : slot,
  );

  const active = (() => {
    const condition = tile.active;
    if (!condition?.source) return undefined;
    const activeSource = condition.source;
    if (typeof activeSource === "string" && taken.has(activeSource)) {
      return { ...condition, source: activeSource };
    }
    const activeId =
      typeof activeSource === "object"
        ? resolveSlotSource(activeSource, options.look)?.stateId
        : undefined;
    const part = parts.find(
      (entry) =>
        entry.kind === "bound" && entry.stateId && entry.stateId === activeId,
    );
    return part?.kind === "bound"
      ? { ...condition, source: part.role }
      : undefined;
  })();

  return {
    omitted,
    template: {
      id: options.id,
      name: options.name,
      type: options.type,
      basedOn: options.type,
      builtin: false,
      roles,
      features: [],
      slots: rewritten,
      ...(tile.size ? { size: tile.size } : {}),
      ...(tile.look ? { look: tile.look } : {}),
      ...(tile.background ? { background: tile.background } : {}),
      ...(tile.border === false ? { border: false } : {}),
      ...(tile.padding === false ? { padding: false } : {}),
      ...(active ? { active } : {}),
    },
  };
}
