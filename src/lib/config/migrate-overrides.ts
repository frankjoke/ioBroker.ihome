import { newLocalTaken, sanitizeLabel } from "$lib/config/virtual-ops";
import {
  overrideGroup,
  overrideNameTaken,
  stateLeaf,
  upsertOverride,
} from "$lib/config/source-overrides";
import {
  convertValue,
  resolveVariable,
  stateIdFor,
  type GlobalVariable,
} from "$lib/config/variables";
import { templateFeatures, tileTitle } from "$lib/config/template-ops";
import { tileHeadlineSlot, tileSourceControls } from "$lib/config/tile-parts";
import type {
  Control,
  ControlCommon,
  Device,
  HistorySpec,
  Transform,
} from "$lib/types/device";
import type { OverrideRegistry, SourceOverride } from "$lib/types/overrides";
import type {
  PageRegistry,
  Placement,
  Rule,
  Slot,
  SlotSource,
  Template,
  TemplateRegistry,
} from "$lib/types/display";

/** What the migration reads: the device document, the tiles, the templates and
 *  the broker objects `$.` sibling names are resolved against. */
export interface DeviceMigrationInput {
  devices: Device[];
  pages: PageRegistry;
  templates: TemplateRegistry;
  /** The registry already in place (a retry): its overrides win by id. */
  overrides?: OverrideRegistry;
  /** The broker object cache; omitted, a device-local map stands in. */
  objects?: Map<string, any>;
  variables?: GlobalVariable[];
  now?: number;
}

export interface DeviceMigrationResult {
  overrides: OverrideRegistry;
  pages: PageRegistry;
  templates: TemplateRegistry;
  /** What was skipped or rewritten, for the dry run and the handoff. */
  log: string[];
  /** False when nothing changed: the caller writes nothing. */
  changed: boolean;
}

const ID_PREFIX = "mig-";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOr(value: unknown, fallback: unknown): number | undefined {
  const pick = value !== undefined ? value : fallback;
  const n = typeof pick === "number" ? pick : Number(pick);
  return pick === undefined ||
    pick === null ||
    pick === "" ||
    !Number.isFinite(n)
    ? undefined
    : n;
}

function flagOr(value: unknown, fallback: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return typeof fallback === "boolean" ? fallback : undefined;
}

function statesOr(
  value: unknown,
  fallback: unknown,
): Record<string, string> | string[] | undefined {
  const pick = value !== undefined ? value : fallback;
  if (Array.isArray(pick)) return pick.length ? pick.map(String) : undefined;
  if (pick && typeof pick === "object") return pick as Record<string, string>;
  return undefined;
}

/** A control as a repair: every correction field it carries, plus the legacy
 *  `common` block older documents kept. */
function repairFields(control: Control): Partial<SourceOverride> {
  const common = (control.common ?? {}) as ControlCommon;
  const unit =
    typeof control.unit === "string"
      ? control.unit
      : typeof common.unit === "string"
        ? common.unit
        : undefined;
  const out: Partial<SourceOverride> = {};
  const put = (key: keyof SourceOverride, value: unknown) => {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  };
  put("label", text(control.label) ?? text(common.name));
  put("unit", unit);
  put("type", text(control.type) ?? text(common.type));
  put("role", text(control.role) ?? text(common.role));
  put("states", statesOr(control.states, common.states));
  put("min", numberOr(control.min, common.min));
  put("max", numberOr(control.max, common.max));
  put("step", numberOr(control.step, common.step));
  put("read", flagOr(control.read, common.read));
  // The old render gate was `control.writable`, not the broker's write flag:
  // an unchecked writable control must stay read-only.
  put("write", flagOr(control.write, control.writable));
  if (control.hideUnit === true) out.hideUnit = true;
  put("transform", control.transform as Transform | undefined);
  put("history", control.history as HistorySpec | undefined);
  return out;
}

/** A derived value keeps the presentation the virtual control carried. */
function derivedFields(control: Control): Partial<SourceOverride> {
  const repair = repairFields(control);
  delete repair.write;
  delete repair.transform;
  return {
    ...repair,
    ...(typeof control.virtual?.precision === "number"
      ? { precision: control.virtual.precision }
      : {}),
  };
}

function controlKey(control: Control, index: number): string {
  const id = String(control.id ?? "").trim();
  return id || `#${index}`;
}

function featureName(control: Control): string {
  return text(control.feature) ?? text(control.label) ?? "value";
}

function isVirtual(control: Control): boolean {
  return control.kind === "virtual" || !!control.virtual?.expr;
}

function overrideIdFor(device: Device, key: string): string {
  return `${ID_PREFIX}${device.id}-${key}`;
}

function uniqueName(
  registry: OverrideRegistry,
  stateId: string,
  base: string,
  variables: GlobalVariable[],
): string {
  let name = base;
  let i = 2;
  while (overrideNameTaken(registry, stateId, name, undefined, variables)) {
    name = `${base}${i++}`;
  }
  return name;
}

// ------------------------------------------------------------- expressions
// The old virtual scope was `buildScope`: variables first, then every
// non-virtual control under `label || feature`. The migration rewrites only
// those locals (and `get("…")` ids); helper names, literals and property
// access pass through untouched.

interface Token {
  text: string;
  start: number;
  end: number;
  /** Present on a whole `get("id")` call: the raw id argument. */
  getRef?: string;
}

function skipQuoted(src: string, at: number): number {
  const quote = src[at];
  let i = at + 1;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function readGet(src: string, start: number, afterName: number): Token | null {
  let i = afterName;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== "(") return null;
  i++;
  while (i < src.length && /\s/.test(src[i])) i++;
  const quote = src[i];
  if (quote !== '"' && quote !== "'") return null;
  i++;
  let ref = "";
  while (i < src.length && src[i] !== quote) {
    if (src[i] === "\\") {
      i++;
      if (i < src.length) ref += src[i++];
      continue;
    }
    ref += src[i++];
  }
  if (src[i] !== quote) return null;
  i++;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== ")") return null;
  return { text: "get", start, end: i + 1, getRef: ref };
}

function scanExpression(expr: string): Token[] {
  const src = String(expr ?? "");
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(src, i);
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const name = src.slice(i, j);
      const prev = i > 0 ? src[i - 1] : "";
      if (prev === "." || name === "$") {
        i = j;
        continue;
      }
      if (name === "get") {
        const call = readGet(src, i, j);
        if (call) {
          out.push(call);
          i = call.end;
          continue;
        }
      }
      out.push({ text: name, start: i, end: j });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

interface VirtualLocal {
  kind: "state" | "constant";
  stateId?: string;
  value?: unknown;
  /** The control the local came from, for the derived input's override. */
  control?: { deviceId: string; key: string };
}

/** The old virtual scope's locals: variables first, then non-virtual controls. */
function virtualLocals(
  device: Device,
  variables: GlobalVariable[],
): Map<string, VirtualLocal> {
  const taken = newLocalTaken();
  const locals = new Map<string, VirtualLocal>();
  for (const variable of variables) {
    const key = String(variable.name ?? "");
    if (!key) continue;
    taken.add(key);
    if (variable.kind === "state" && variable.stateId) {
      locals.set(key, { kind: "state", stateId: variable.stateId });
    } else if (variable.kind === "constant") {
      const parsed = convertValue(variable.value ?? "", variable.type);
      locals.set(key, {
        kind: "constant",
        value: parsed.error ? undefined : parsed.value,
      });
    }
  }
  (device.controls ?? []).forEach((control, index) => {
    if (isVirtual(control)) return;
    const key = controlKey(control, index);
    const local = sanitizeLabel(control.label || control.feature, taken);
    const stateId = control.stateId
      ? stateIdFor(control.stateId, variables)
      : undefined;
    locals.set(local, {
      kind: "state",
      ...(stateId && stateId.includes(".") ? { stateId } : {}),
      control: { deviceId: device.id, key },
    });
  });
  return locals;
}

interface VirtualPlan {
  anchor: string;
  tokens: Token[];
  locals: Map<string, VirtualLocal>;
  inputs: string[];
}

function getStateId(
  ref: string,
  variables: GlobalVariable[],
): string | undefined {
  const target = resolveVariable(ref, variables);
  const id =
    target?.kind === "state" ? target.stateId : ref.includes(".") ? ref : "";
  return id ? stateIdFor(id, variables) : undefined;
}

function planVirtual(
  control: Control,
  device: Device,
  variables: GlobalVariable[],
): VirtualPlan | null {
  const locals = virtualLocals(device, variables);
  const tokens = scanExpression(control.virtual?.expr ?? "");
  let anchor: string | undefined;
  const inputs: string[] = [];
  for (const token of tokens) {
    let stateId: string | undefined;
    if (token.getRef !== undefined) {
      stateId = getStateId(token.getRef, variables);
    } else {
      const local = locals.get(token.text);
      if (local?.kind === "state") stateId = local.stateId;
    }
    if (!stateId) continue;
    if (!anchor) anchor = stateId;
    if (!inputs.includes(stateId)) inputs.push(stateId);
  }
  return anchor ? { anchor, tokens, locals, inputs } : null;
}

/** The `$.name` that reads exactly this state through exactly this override. */
function dollarName(
  group: ReturnType<typeof overrideGroup>,
  stateId: string,
  overrideId: string | undefined,
  preferred: string,
): { name?: string; crossed?: string } {
  const entry = group.names.get(preferred);
  if (!entry) return {};
  const sameState = entry.stateId === stateId;
  const sameOverride = overrideId
    ? entry.override === overrideId
    : entry.override === undefined;
  if (sameState && sameOverride) return { name: preferred };
  return { crossed: entry.stateId };
}

function literal(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  return "undefined";
}

function applyReplacements(
  source: string,
  replacements: { start: number; end: number; text: string }[],
): string {
  let out = source;
  for (const change of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, change.start) + change.text + out.slice(change.end);
  }
  return out;
}

// ------------------------------------------------------------------ devices

interface ControlEntry {
  control: Control;
  index: number;
  overrideId?: string;
}

interface DeviceEntry {
  device: Device;
  byKey: Map<string, ControlEntry>;
  byFeature: Map<string, ControlEntry>;
}

function findControl(
  entry: DeviceEntry | undefined,
  key: string,
): ControlEntry | undefined {
  return entry?.byKey.get(key) ?? entry?.byFeature.get(key);
}

/** A device-local object map so `$.` resolution still works without the cache. */
function deviceObjects(
  devices: Device[],
  variables: GlobalVariable[],
): Map<string, any> {
  const out = new Map<string, any>();
  for (const device of devices) {
    for (const control of device.controls ?? []) {
      const raw = control.stateId ? stateIdFor(control.stateId, variables) : "";
      if (!raw || !raw.includes(".") || out.has(raw)) continue;
      out.set(raw, { _id: raw, type: "state", common: {} });
    }
  }
  return out;
}

export function migrateDevices(
  input: DeviceMigrationInput,
): DeviceMigrationResult {
  const now = input.now ?? Date.now();
  const variables = input.variables ?? [];
  const log: string[] = [];
  let registry = input.overrides ?? { version: 1, updatedAt: 0, overrides: [] };
  let overridesChanged = false;

  // 1. Every control becomes a repair or a derived override, in device order.
  const entries = new Map<string, DeviceEntry>();
  const derived: {
    device: Device;
    control: Control;
    overrideId: string;
    plan: VirtualPlan;
  }[] = [];
  for (const device of input.devices ?? []) {
    const byKey = new Map<string, ControlEntry>();
    const byFeature = new Map<string, ControlEntry>();
    (device.controls ?? []).forEach((control, index) => {
      const key = controlKey(control, index);
      const id = overrideIdFor(device, key);
      const known = registry.overrides.find((override) => override.id === id);
      if (known) {
        const entry = { control, index, overrideId: id };
        byKey.set(key, entry);
        if (!byFeature.has(control.feature))
          byFeature.set(control.feature, entry);
        return;
      }
      if (isVirtual(control)) {
        const plan = planVirtual(control, device, variables);
        if (!plan) {
          log.push(
            `skipped virtual "${device.id}/${featureName(control)}": no state input`,
          );
          const entry = { control, index };
          byKey.set(key, entry);
          if (!byFeature.has(control.feature))
            byFeature.set(control.feature, entry);
          return;
        }
        const name = uniqueName(
          registry,
          plan.anchor,
          featureName(control),
          variables,
        );
        const override: SourceOverride = {
          id,
          stateId: plan.anchor,
          kind: "derived",
          name,
          expr: control.virtual?.expr ?? "",
          inputs: plan.inputs,
          ...derivedFields(control),
        };
        registry = upsertOverride(registry, override);
        overridesChanged = true;
        const entry = { control, index, overrideId: id };
        byKey.set(key, entry);
        if (!byFeature.has(control.feature))
          byFeature.set(control.feature, entry);
        derived.push({ device, control, overrideId: id, plan });
        return;
      }
      const stateId = control.stateId
        ? stateIdFor(control.stateId, variables)
        : "";
      if (!stateId || !stateId.includes(".")) {
        log.push(
          `control "${device.id}/${featureName(control)}" has no state; left unbound`,
        );
        const entry = { control, index };
        byKey.set(key, entry);
        if (!byFeature.has(control.feature))
          byFeature.set(control.feature, entry);
        return;
      }
      const override: SourceOverride = {
        id,
        stateId,
        kind: "repair",
        name: uniqueName(registry, stateId, featureName(control), variables),
        ...repairFields(control),
      };
      registry = upsertOverride(registry, override);
      overridesChanged = true;
      const entry = { control, index, overrideId: id };
      byKey.set(key, entry);
      if (!byFeature.has(control.feature))
        byFeature.set(control.feature, entry);
    });
    entries.set(device.id, { device, byKey, byFeature });
  }

  // 2. Rewrite every derived expression against its final anchor group. A
  //    `$.name` that would read a different state falls back to `get("id")`.
  const objects = input.objects ?? deviceObjects(input.devices, variables);
  for (const item of derived) {
    const override = registry.overrides.find((o) => o.id === item.overrideId);
    if (!override) continue;
    const group = overrideGroup(override.stateId, objects, registry, variables);
    const replacements: {
      start: number;
      end: number;
      text: string;
    }[] = [];
    const inputs: string[] = [];
    const addInput = (id: string) => {
      if (id && !inputs.includes(id)) inputs.push(id);
    };
    for (const token of item.plan.tokens) {
      if (token.getRef !== undefined) {
        const id = getStateId(token.getRef, variables);
        if (!id) continue;
        addInput(id);
        if (id !== token.getRef) {
          replacements.push({
            start: token.start,
            end: token.end,
            text: `get(${JSON.stringify(id)})`,
          });
        }
        continue;
      }
      const local = item.plan.locals.get(token.text);
      if (!local) continue;
      if (local.kind === "constant") {
        replacements.push({
          start: token.start,
          end: token.end,
          text: literal(local.value),
        });
        continue;
      }
      const stateId = local.stateId;
      if (!stateId) continue;
      addInput(stateId);
      const control = local.control
        ? entries.get(local.control.deviceId)?.byKey.get(local.control.key)
        : undefined;
      const overrideId = control?.overrideId;
      const own = overrideId
        ? registry.overrides.find((o) => o.id === overrideId)
        : undefined;
      const preferred = sanitizeLabel(
        own?.name ?? stateLeaf(stateId),
        new Set(),
      );
      const hit = dollarName(group, stateId, overrideId, preferred);
      if (hit.name) {
        replacements.push({
          start: token.start,
          end: token.end,
          text: `$.${hit.name}`,
        });
        continue;
      }
      const why = hit.crossed
        ? `$.${preferred} would read "${hit.crossed}"`
        : `"$.${preferred}" is not in the anchor group`;
      log.push(
        `virtual "${item.device.id}/${featureName(item.control)}": ${why}; using get(${JSON.stringify(stateId)})`,
      );
      replacements.push({
        start: token.start,
        end: token.end,
        text: `get(${JSON.stringify(stateId)})`,
      });
    }
    const expr = applyReplacements(
      item.control.virtual?.expr ?? "",
      replacements,
    );
    if (
      expr !== override.expr ||
      inputs.join("\n") !== (override.inputs ?? []).join("\n")
    ) {
      registry = upsertOverride(registry, { ...override, expr, inputs });
      overridesChanged = true;
    }
  }

  // 3. Tiles: control/device sources become states; rules keep their names.
  const migratedPages = migratePages(
    input.pages,
    entries,
    registry,
    variables,
    objects,
    now,
    log,
  );

  // 4. Templates: features become roles, slots keep their presentation.
  const migratedTemplates = migrateTemplates(input.templates, now, log);

  return {
    overrides: overridesChanged
      ? { ...registry, version: 1, updatedAt: now }
      : registry,
    pages: migratedPages.registry,
    templates: migratedTemplates.registry,
    log,
    changed:
      overridesChanged || migratedPages.changed || migratedTemplates.changed,
  };
}

// -------------------------------------------------------------------- pages

interface TileContext {
  entries: Map<string, DeviceEntry>;
  registry: OverrideRegistry;
  variables: GlobalVariable[];
  objects: Map<string, any>;
  log: string[];
}

function sourceDevice(
  source: SlotSource | string | undefined,
): string | undefined {
  if (!source || typeof source === "string") return undefined;
  return source.kind === "control" || source.kind === "device"
    ? source.device
    : undefined;
}

function isStateSource(
  source: SlotSource | string | undefined,
): source is Extract<SlotSource, { kind: "state" }> {
  return !!source && typeof source === "object" && source.kind === "state";
}

function stateSourceOf(
  source: SlotSource | string | undefined,
): Extract<SlotSource, { kind: "state" }> | undefined {
  return isStateSource(source) ? source : undefined;
}

function controlRules(
  slot: Slot,
  control: Control | undefined,
): Rule[] | undefined {
  if (!control?.rules?.length) return slot.rules;
  return [...(slot.rules ?? []), ...control.rules];
}

/** One source as a state source through the control's override. */
function convertedControlSource(
  device: DeviceEntry | undefined,
  key: string,
  ctx: TileContext,
): Extract<SlotSource, { kind: "state" }> | undefined {
  const entry = findControl(device, key);
  const overrideId = entry?.overrideId;
  const override = overrideId
    ? ctx.registry.overrides.find((o) => o.id === overrideId)
    : undefined;
  if (!entry || !override) return undefined;
  return { kind: "state", stateId: override.stateId, override: override.id };
}

function convertTileSlot(
  slot: Slot,
  device: DeviceEntry | undefined,
  ctx: TileContext,
): Slot {
  const source = slot.source;
  if (typeof source === "string") {
    if (source === "ago" || source === "offline") return slot;
    const entry = findControl(device, source);
    if (entry) {
      const converted = convertedControlSource(device, source, ctx);
      if (converted) {
        return {
          ...slot,
          source: converted,
          rules: controlRules(slot, entry.control),
        };
      }
      ctx.log.push(
        `slot source "${device?.device.id}/${source}" has no override; left as is`,
      );
      return slot;
    }
    if (source.includes(".")) {
      return { ...slot, source: { kind: "state", stateId: source } };
    }
    return slot;
  }
  if (!source || typeof source !== "object") return slot;
  if (source.kind === "state") return slot;
  if (source.kind === "device") return slot;
  const owner = ctx.entries.get(source.device);
  const converted = convertedControlSource(owner, source.control, ctx);
  if (!converted) {
    ctx.log.push(
      `slot source "${source.device}/${source.control}" has no override; left as is`,
    );
    return slot;
  }
  const control = findControl(owner, source.control)?.control;
  return {
    ...slot,
    source: converted,
    rules: controlRules(slot, control),
  };
}

function convertActive(
  source: string | SlotSource | undefined,
  device: DeviceEntry | undefined,
  ctx: TileContext,
  headline: Extract<SlotSource, { kind: "state" }> | undefined,
): string | SlotSource | undefined {
  if (!source) return source;
  if (typeof source === "string") {
    const entry = findControl(device, source);
    if (entry) return convertedControlSource(device, source, ctx) ?? source;
    return source.includes(".") ? { kind: "state", stateId: source } : source;
  }
  if (source.kind === "control") {
    const owner = ctx.entries.get(source.device);
    return convertedControlSource(owner, source.control, ctx) ?? source;
  }
  // A device-wide condition means "the tile is active": bind it to the same
  // headline source its badges use.
  if (source.kind === "device") return headline ?? source;
  return source;
}

function firstDeviceOf(tile: Placement["tile"]): string | undefined {
  for (const slot of tile?.slots ?? []) {
    const id = sourceDevice(slot.source);
    if (id) return id;
  }
  const active = tile?.active?.source;
  return sourceDevice(active);
}

function badgeOf(
  slot: Slot,
  headline: string | undefined,
  device: DeviceEntry | undefined,
  ctx: TileContext,
): Slot {
  if (slot.kind !== "badge") return slot;
  const source = slot.source;
  const isDevice =
    !!source && typeof source === "object" && source.kind === "device";
  const isDerivedString = source === "ago" || source === "offline";
  if (!isDevice && !isDerivedString) return slot;
  const options = { ...(slot.options ?? {}) };
  const of = typeof options.of === "string" ? options.of : "";
  const entry = of ? findControl(device, of) : undefined;
  if (entry) {
    const stateId = entry.control.stateId
      ? stateIdFor(entry.control.stateId, ctx.variables)
      : "";
    if (stateId) options.of = stateId;
    return { ...slot, options };
  }
  if (of && (of.includes(".") || of.startsWith("slot:"))) return slot;
  if (!headline) {
    ctx.log.push(
      `badge "${String(typeof source === "object" ? source.kind : source)}" has no headline source; left as is`,
    );
    return slot;
  }
  const derive =
    options.derive === "ago" || source === "ago" ? "ago" : "offline";
  delete options.derive;
  delete options.pick;
  options.of = headline;
  return { ...slot, source: derive, options };
}

function headlineSource(
  slots: Slot[],
  device: DeviceEntry | undefined,
  ctx: TileContext,
): Extract<SlotSource, { kind: "state" }> | undefined {
  const headline = tileHeadlineSlot(slots);
  const direct = stateSourceOf(headline?.source);
  if (direct) return direct;
  for (const slot of slots) {
    const found = stateSourceOf(slot.source);
    if (found) return found;
  }
  return (device?.device.controls ?? [])
    .map((control, index) =>
      convertedControlSource(device, controlKey(control, index), ctx),
    )
    .find(
      (source): source is Extract<SlotSource, { kind: "state" }> => !!source,
    );
}

/** The names a rule saw before the migration: features first, then labels. */
function ruleLocals(
  device: DeviceEntry | undefined,
  variables: GlobalVariable[],
): Map<string, string> {
  const locals = new Map<string, string>();
  if (!device) return locals;
  const taken = newLocalTaken();
  device.device.controls?.forEach((control, index) => {
    const entry = device.byKey.get(controlKey(control, index));
    const feature = sanitizeLabel(control.feature, taken);
    if (entry?.overrideId) locals.set(feature, entry.overrideId);
    const raw = String(control.feature ?? "");
    if (
      entry?.overrideId &&
      /^[A-Za-z_$][\w$]*$/.test(raw) &&
      raw !== sanitizeLabel(raw, new Set()) &&
      !locals.has(raw)
    ) {
      locals.set(raw, entry.overrideId);
    }
  });
  for (const variable of variables) {
    if (taken.has(variable.name)) continue;
    taken.add(variable.name);
  }
  device.device.controls?.forEach((control, index) => {
    // The old scope consumed a `v`/`v2` slot for a label-less control, so a
    // later label keeps the suffix it had in a rule.
    const local = sanitizeLabel(control.label, taken);
    if (!text(control.label)) return;
    const entry = device.byKey.get(controlKey(control, index));
    if (entry?.overrideId && !locals.has(local)) {
      locals.set(local, entry.overrideId);
    }
  });
  return locals;
}

function watchOverrides(
  slots: Slot[],
  device: DeviceEntry | undefined,
  bound: Set<string>,
  existing: string[] | undefined,
  variables: GlobalVariable[],
): string[] | undefined {
  const locals = ruleLocals(device, variables);
  const watch = [...(existing ?? [])];
  for (const slot of slots) {
    for (const rule of slot.rules ?? []) {
      for (const token of scanExpression(rule.when ?? "")) {
        if (token.getRef !== undefined) continue;
        const id = locals.get(token.text);
        if (!id || bound.has(id) || watch.includes(id)) continue;
        watch.push(id);
      }
    }
  }
  return watch.length ? watch : undefined;
}

/** The rule local every bound override gets in the migrated tile, in the same
 *  order `tileSourceControls` + `ruleScope` assign them. */
function finalRuleLocals(
  slots: Slot[],
  watch: string[] | undefined,
  ctx: TileContext,
): Map<string, string> {
  const controls = tileSourceControls(slots, {
    states: new Map(),
    objects: ctx.objects,
    variables: ctx.variables,
    overrides: ctx.registry.overrides,
    watchOverrides: watch,
  });
  const taken = newLocalTaken();
  const locals = new Map<string, string>();
  for (const control of controls) {
    const local = sanitizeLabel(control.feature, taken);
    if (control.overrideId) locals.set(control.overrideId, local);
  }
  return locals;
}

/** Old rule name → the local the migrated tile will actually have. This also
 *  fixes a name suffix (`power` → `power2`) with a single non-chaining pass. */
function ruleRenames(
  slots: Slot[],
  device: DeviceEntry | undefined,
  watch: string[] | undefined,
  ctx: TileContext,
): Map<string, string> {
  const old = ruleLocals(device, ctx.variables);
  if (!old.size) return new Map();
  const finals = finalRuleLocals(slots, watch, ctx);
  const renames = new Map<string, string>();
  for (const [name, id] of old) {
    const final = finals.get(id);
    if (final && final !== name) renames.set(name, final);
  }
  return renames;
}

function renameRule(rule: Rule, renames: Map<string, string>): Rule {
  if (!rule.when || !renames.size) return rule;
  const replacements: { start: number; end: number; text: string }[] = [];
  for (const token of scanExpression(rule.when)) {
    if (token.getRef !== undefined) continue;
    const next = renames.get(token.text);
    if (!next || next === token.text) continue;
    replacements.push({ start: token.start, end: token.end, text: next });
  }
  if (!replacements.length) return rule;
  return { ...rule, when: applyReplacements(rule.when, replacements) };
}

function migratePlacement(
  placement: Placement,
  ctx: TileContext,
): { placement: Placement; changed: boolean } {
  const tile = placement.tile;
  const deviceId = placement.device ?? firstDeviceOf(tile);
  const device = deviceId ? ctx.entries.get(deviceId) : undefined;
  let changed = false;
  let slots: Slot[] = tile?.slots ?? [];
  let sourceConverted = false;
  let headline: Extract<SlotSource, { kind: "state" }> | undefined;
  if (slots.length) {
    const converted = slots.map((slot) => {
      const next = convertTileSlot(slot, device, ctx);
      if (next !== slot) {
        changed = true;
        if (next.source !== slot.source) sourceConverted = true;
      }
      return next;
    });
    headline = headlineSource(converted, device, ctx);
    slots = converted.map((slot) => {
      const next = badgeOf(slot, headline?.stateId, device, ctx);
      if (next !== slot) {
        changed = true;
        if (next.source !== slot.source) sourceConverted = true;
      }
      return next;
    });
  }
  if (!headline) headline = headlineSource([], device, ctx);

  const bound = new Set(
    slots
      .map((slot) => stateSourceOf(slot.source)?.override)
      .filter((id): id is string => !!id),
  );
  const watch = watchOverrides(
    slots,
    device,
    bound,
    tile?.watchOverrides,
    ctx.variables,
  );
  const watchChanged =
    (watch ?? []).join("\n") !== (tile?.watchOverrides ?? []).join("\n");
  if (watchChanged) changed = true;

  // A rule keeps reading the feature it always named; when the migrated
  // override had to take a suffixed name (`power2`), that token follows.
  // Only a tile that still had a legacy source is rewritten, so a second run
  // over an already-migrated tile never swaps locals back.
  const renames = sourceConverted
    ? ruleRenames(slots, device, watch, ctx)
    : new Map<string, string>();
  if (renames.size) {
    slots = slots.map((slot) => {
      if (!slot.rules?.length) return slot;
      const rules = slot.rules.map((rule) => renameRule(rule, renames));
      if (rules.every((rule, index) => rule === slot.rules![index]))
        return slot;
      changed = true;
      return { ...slot, rules };
    });
  }

  const active = tile?.active
    ? {
        ...tile.active,
        source:
          convertActive(tile.active.source, device, ctx, headline) ??
          tile.active.source,
      }
    : undefined;
  if (tile?.active && active && active.source !== tile.active.source)
    changed = true;

  const title =
    placement.title === undefined && device
      ? tileTitle(device.device)
      : placement.title;
  if (title !== placement.title) changed = true;

  let nextTile = tile;
  if (tile) {
    const icon =
      tile.icon === undefined && device?.device.icon
        ? device.device.icon
        : tile.icon;
    const iconAuto =
      icon !== tile.icon && icon !== undefined ? true : tile.iconAuto;
    if (
      icon !== tile.icon ||
      iconAuto !== tile.iconAuto ||
      slots.some((slot, index) => slot !== (tile.slots ?? [])[index]) ||
      watchChanged ||
      (active && tile.active && active.source !== tile.active.source)
    ) {
      nextTile = {
        ...tile,
        slots,
        ...(watch ? { watchOverrides: watch } : {}),
        ...(active ? { active } : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(iconAuto !== undefined ? { iconAuto } : {}),
      };
      if (!watch)
        delete (nextTile as { watchOverrides?: string[] }).watchOverrides;
      if (watchChanged) changed = true;
      if (nextTile !== tile) changed = true;
    }
  }

  const next: Placement = {
    ...placement,
    ...(title !== placement.title ? { title } : {}),
    ...(nextTile !== tile ? { tile: nextTile } : {}),
  };
  if (placement.device !== undefined) {
    delete (next as { device?: string }).device;
    changed = true;
  }
  return { placement: changed ? next : placement, changed };
}

function migratePages(
  pages: PageRegistry,
  entries: Map<string, DeviceEntry>,
  registry: OverrideRegistry,
  variables: GlobalVariable[],
  objects: Map<string, any>,
  now: number,
  log: string[],
): { registry: PageRegistry; changed: boolean } {
  const ctx: TileContext = { entries, registry, variables, objects, log };
  let changed = false;
  const nextPages = (pages.pages ?? []).map((page) => ({
    ...page,
    groups: (page.groups ?? []).map((group) => ({
      ...group,
      tiles: (group.tiles ?? []).map((placement) => {
        const result = migratePlacement(placement, ctx);
        if (result.changed) changed = true;
        return result.placement;
      }),
    })),
  }));
  return changed
    ? { registry: { ...pages, updatedAt: now, pages: nextPages }, changed }
    : { registry: pages, changed };
}

// ---------------------------------------------------------------- templates

/** A legacy device template as a role template: feature sources become roles,
 *  each bound slot carries the repair the role expects, rules keep their names. */
function convertTemplate(template: Template, log: string[]): Template {
  if (template.roles?.length) return template;
  const features = templateFeatures(template);
  if (!features.length) return template;
  const byName = new Map(features.map((feature) => [feature.feature, feature]));
  const featureNames = new Set(byName.keys());
  const used: string[] = [];
  const note = (name: string | undefined) => {
    if (name && featureNames.has(name) && !used.includes(name)) used.push(name);
  };
  for (const slot of template.slots ?? []) {
    if (typeof slot.source === "string") note(slot.source);
    if (typeof slot.options?.pick === "string") note(slot.options.pick);
    if (typeof slot.options?.of === "string") note(slot.options.of);
  }
  if (typeof template.active?.source === "string") note(template.active.source);
  if (!used.length) return template;

  const primary =
    (typeof template.active?.source === "string"
      ? template.active.source
      : undefined) ?? features.find((feature) => feature.primary)?.feature;
  const order = [
    ...new Set([primary, ...used].filter((name): name is string => !!name)),
  ].filter((name) => used.includes(name));
  const taken = new Set<string>();
  const roleFor = new Map<string, string>();
  const roles: string[] = [];
  const role = (name: string): string => {
    const known = roleFor.get(name);
    if (known) return known;
    const next = sanitizeLabel(name, taken);
    roleFor.set(name, next);
    roles.push(next);
    return next;
  };
  for (const name of order) role(name);

  const repairFor = (name: string) => {
    const feature = byName.get(name);
    return {
      kind: "repair" as const,
      name: role(name),
      ...(feature?.label ? { label: feature.label } : {}),
      ...(feature?.roleHints?.[0] ? { role: feature.roleHints[0] } : {}),
    };
  };

  // The old scope named a feature by its sanitized form and, when it differed,
  // also kept the raw camelCase as an alias. Rewrite both to the role.
  const aliases = new Map<string, string>();
  for (const name of used) {
    aliases.set(name, role(name));
    aliases.set(sanitizeLabel(name, new Set()), role(name));
  }
  const aliasPattern =
    aliases.size > 0
      ? new RegExp(
          `\\b(${[...aliases.keys()]
            .sort((a, b) => b.length - a.length)
            .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|")})\\b`,
          "g",
        )
      : null;
  const rewrite = (rule: Rule): Rule =>
    aliasPattern && rule.when
      ? {
          ...rule,
          when: rule.when.replace(
            aliasPattern,
            (name) => aliases.get(name) ?? name,
          ),
        }
      : rule;

  let changed = false;
  const slots = (template.slots ?? []).map((slot) => {
    let next = slot;
    const options = { ...(slot.options ?? {}) };
    let optionsChanged = false;
    const source = typeof slot.source === "string" ? slot.source : undefined;
    const pick =
      typeof slot.options?.pick === "string" ? slot.options.pick : undefined;
    if (source && featureNames.has(source)) {
      next = {
        ...next,
        source: role(source),
        repair: slot.repair ?? repairFor(source),
      };
      changed = true;
    } else if (pick && featureNames.has(pick)) {
      next = {
        ...next,
        source: role(pick),
        repair: slot.repair ?? repairFor(pick),
      };
      delete options.pick;
      optionsChanged = true;
      changed = true;
    }
    const of = typeof options.of === "string" ? options.of : undefined;
    if (of && featureNames.has(of)) {
      options.of = role(of);
      optionsChanged = true;
      changed = true;
    }
    if (slot.rules?.length) {
      const rewritten = slot.rules.map(rewrite);
      if (rewritten.some((rule, index) => rule !== slot.rules![index])) {
        next = { ...next, rules: rewritten };
        changed = true;
      }
    }
    if (optionsChanged) {
      next = { ...next, options };
      if (!Object.keys(options).length)
        delete (next as { options?: unknown }).options;
    }
    return next;
  });
  if (!changed) return template;

  const activeSource =
    typeof template.active?.source === "string"
      ? template.active.source
      : undefined;
  const active =
    template.active && activeSource && featureNames.has(activeSource)
      ? { ...template.active, source: role(activeSource) }
      : template.active;
  log.push(
    `template "${template.name}": features -> roles (${roles.join(", ")})`,
  );
  return {
    ...template,
    roles,
    features: [],
    slots,
    ...(active ? { active } : {}),
  };
}

function migrateTemplates(
  templates: TemplateRegistry,
  now: number,
  log: string[],
): { registry: TemplateRegistry; changed: boolean } {
  let changed = false;
  const converted = (templates.templates ?? []).map((template) => {
    const next = convertTemplate(template, log);
    if (next !== template) changed = true;
    return next;
  });
  return changed
    ? {
        registry: { ...templates, updatedAt: now, templates: converted },
        changed,
      }
    : { registry: templates, changed };
}
