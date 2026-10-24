import type {
  DeviceRegistry,
  EnrichedDevice,
  EnrichedControl,
  Control,
} from "$lib/types/device";
import { applyRead } from "$lib/utils/transform";
import { stateIdsInExpression } from "$lib/config/rule-ops";
import { widgetFor } from "$lib/config/features";
import { computeVirtual, type PoolEntry } from "$lib/config/virtual-ops";
import {
  resolveVariable,
  stateIdFor,
  variableScope,
} from "$lib/config/variables";
import { getVariableLibrary } from "$lib/stores/variables.svelte";
import { deviceObjectIcon } from "$lib/config/icon-ops";
import { iconSrc } from "$lib/utils/icon-url";
import { readable } from "svelte/store";
import { SvelteSet } from "svelte/reactivity";

export const DEVICE_LIST_ID = "ihome.0.config.deviceList";

const defaultRegistry: DeviceRegistry = {
  version: 0,
  updatedAt: Date.now(),
  devices: [],
};

let canonicalRegistry = $state<DeviceRegistry>(defaultRegistry);
export function getCanonicalRegistry() {
  return canonicalRegistry;
}
export function setCanonicalRegistry(reg: DeviceRegistry) {
  canonicalRegistry = reg;
}

// -------------------------------------------------------------- data sources
// The live caches owned by the socket layer are injected once by the layout so
// this store never imports the socket module (that would create an import
// cycle):
//   stateSource  -> ioBroker.states  (StateMap: only *used* states)
//   objectSource -> ioBroker.objects (ObjectMap: all objects, for discovery)
let stateSource: Map<string, any> | null = null;
let objectSource: Map<string, any> | null = null;
export function setStateSource(src: Map<string, any> | null) {
  stateSource = src;
}
export function setObjectSource(src: Map<string, any> | null) {
  objectSource = src;
}

// ------------------------------------------------------------- used state ids
// "Used" = every state referenced by a device control plus program-logic states
// registered at runtime (the device list itself). Only these are loaded into the
// StateClass cache and updated on stateChange.
const PROGRAM_STATE_IDS = new SvelteSet<string>([DEVICE_LIST_ID]);

// ---------------------------------------------------------------- variables
// A stored reference may be a variable *name* instead of a state id: the name
// resolves to the state behind it (see `resolveVariable`), so subscriptions,
// live values and writes all keep working on the real id.

function variableList() {
  return getVariableLibrary().variables ?? [];
}

/** A stored reference as the id the broker side works with. */
function stateIdOf(ref: string | undefined): string | undefined {
  return ref ? stateIdFor(ref, variableList()) : undefined;
}

/** Locals and `get()` resolution for an expression that names variables. */
function variableExtras() {
  return variableScope(variableList(), (id) => stateSource?.get(id)?.val);
}

/** Bumped whenever the program (the layouts' rules and virtuals) changed, so
 *  `getUsedStateIds` recomputes. `$state` on purpose: the connection layer
 *  watches the used set to (re)subscribe — without a reactive version counter
 *  a page load after connect would leave the device tiles unsubscribed. */
let programVersion = $state(0);
export function registerProgramStateId(id: string) {
  if (!id || PROGRAM_STATE_IDS.has(id)) return;
  PROGRAM_STATE_IDS.add(id);
  programVersion++;
}

let usedStateCache: {
  reg: DeviceRegistry | null;
  ver: number;
  /** The variable library's version: a re-pointed variable re-subscribes. */
  lib: number;
  ids: Set<string>;
} = {
  reg: null,
  ver: -1,
  lib: -1,
  ids: new SvelteSet(),
};

// Raw state ids an expression reads with the pool helper (`get("id")`) have to
// be subscribed before they are read — the scanner lives in rule-ops (shared
// with the pages and formula stores) and an id it misses degrades to "that rule
// never matches" (spec §14), never to a crash.
function addExpressionStateIds(
  expr: string | undefined,
  into: Set<string>,
): void {
  for (const id of stateIdsInExpression(expr ?? "")) into.add(id);
}

function addRuleStateIds(
  rules: { when?: string }[] | undefined,
  into: Set<string>,
): void {
  for (const rule of rules ?? []) addExpressionStateIds(rule?.when, into);
}

export function getUsedStateIds(): Set<string> {
  const lib = getVariableLibrary().version ?? 0;
  if (
    usedStateCache.reg === canonicalRegistry &&
    usedStateCache.ver === programVersion &&
    usedStateCache.lib === lib
  ) {
    return usedStateCache.ids;
  }
  const ids = new SvelteSet<string>(PROGRAM_STATE_IDS);
  for (const device of canonicalRegistry.devices ?? []) {
    for (const id of device.watch ?? []) ids.add(id);
    for (const slot of device.slots ?? []) {
      // A slot's raw `source` (the device editor lets a slot point at any
      // state, not only a control of this device) and its rules'
      // `get("…")` ids both need subscribing. Only ids that exist in the
      // object tree are registered — a feature name is not a state id.
      const source = stateIdOf(slot?.source);
      if (source && objectSource?.get(source)) {
        ids.add(source);
      }
      addRuleStateIds(slot?.rules, ids);
    }
    for (const control of device.controls ?? []) {
      // A variable name resolves to its state; a constant names no state.
      const id = stateIdOf(control.stateId);
      if (id && id.includes(".")) ids.add(id);
      // A virtual control reads its inputs through `get("…")` in
      // `virtual.expr` — never a `stateId`, so it needs this scan or its inputs
      // would be read once and never updated. A control that uses a formula
      // template instead is covered by the formulas store, which registers
      // every template's expression ids.
      addExpressionStateIds(control.virtual?.expr, ids);
      addRuleStateIds(control.rules, ids);
    }
  }
  usedStateCache = { reg: canonicalRegistry, ver: programVersion, lib, ids };
  return ids;
}

// ---------------------------------------------------------------- enrichment
/** Every state referenced by a device, with its live value and metadata. */
function buildVirtualPool(): PoolEntry[] {
  const pool: PoolEntry[] = [];
  for (const device of canonicalRegistry.devices ?? []) {
    const seen = new SvelteSet<string>();
    for (const control of device.controls ?? []) {
      if (!control.stateId) continue;
      // The pool carries the real id: a variable names a state, it is not one.
      const stateId = stateIdOf(control.stateId) ?? control.stateId;
      if (seen.has(stateId)) continue;
      seen.add(stateId);
      const st: any = stateSource?.get(stateId);
      const obj: any = objectSource?.get(stateId);
      pool.push({
        stateId,
        value: applyRead(st?.val, control.transform),
        role: obj?.common?.role,
        room: device.room ?? obj?.common?.room,
        device: device.name,
        feature: control.feature,
        label: control.label ?? control.feature,
      });
    }
    // `watch` ids are subscribed for rules; they must be readable too, or a
    // rule's get("<id>") silently returns undefined (spec §14).
    for (const id of device.watch ?? []) {
      if (!id || seen.has(id)) continue;
      const st: any = stateSource?.get(id);
      pool.push({ stateId: id, value: st?.val, device: device.name });
    }
  }
  return pool;
}

export function getVirtualPool(): PoolEntry[] {
  return buildVirtualPool();
}

function _devicesEnriched(): EnrichedDevice[] {
  const pool = buildVirtualPool();
  const result = (canonicalRegistry.devices ?? []).map((device) => {
    const controls: EnrichedControl[] = (device.controls ?? []).map(
      (control: Control) => {
        // A variable name resolves here, once: everything downstream (live
        // value, unit, writable, the tile's write) then works on the real id.
        const stateId = stateIdOf(control.stateId) ?? control.stateId ?? "";
        // A constant has no state: it shows its value, read-only, forever.
        const constant =
          stateId && !stateId.includes(".")
            ? resolveVariable(stateId, variableList())
            : null;
        const isConst = constant?.kind === "constant";
        const st: any = isConst ? undefined : stateSource?.get(stateId);
        const obj: any = isConst ? undefined : objectSource?.get(stateId);
        const liveValue = isConst
          ? constant.value
          : st !== undefined
            ? applyRead(st.val, control.transform)
            : undefined;
        return {
          ...control,
          stateId,
          liveValue,
          available: !!isConst || st !== undefined || obj !== undefined,
          exists: !!isConst || obj !== undefined,
          writable: isConst ? false : control.writable,
          displayRoom: device.room ?? obj?.common?.room ?? undefined,
          object: obj,
          widget: widgetFor(device.type, control.feature),
        };
      },
    );
    for (const c of controls) {
      if (c.kind === "virtual") {
        const { value, error } = computeVirtual(
          c,
          controls,
          pool,
          variableExtras(),
        );
        c.liveValue = value;
        c.virtualError = error;
        c.available = true;
        c.exists = true;
        c.displayRoom = device.room ?? c.displayRoom;
        c.widget = "value";
      }
    }
    const deviceDisplayRoom =
      device.room ?? controls.find((c) => c.displayRoom)?.displayRoom;
    // The device's face (A65/A68): the document's own icon, else the icon its
    // objects carry — resolved once, here, into a URL the display can render.
    const iconHit = objectSource
      ? deviceObjectIcon(
          objectSource,
          controls.map((c) => c.stateId),
        )
      : undefined;
    const objectIcon =
      device.icon ??
      (iconHit ? iconSrc(iconHit.value, iconHit.from) : undefined);
    return {
      ...device,
      controls,
      displayRoom: deviceDisplayRoom,
      objectIcon,
    };
  });
  return result as EnrichedDevice[];
}
export const getDevicesEnriched = _devicesEnriched;

// -------------------------------------------------------------- discovery tree
export function getAvailableStatesTree(): any {
  const tree: any = {};
  const src: Iterable<[string, any]> = objectSource
    ? objectSource.entries()
    : [];
  for (const [id, obj] of src) {
    if (!obj || obj.type !== "state") continue;
    const parts = id.split(".");
    if (parts.length < 2) continue;
    const adapter = parts[0];
    if (!tree[adapter]) tree[adapter] = { states: [] };
    tree[adapter].states.push({ id, obj });
  }
  return tree;
}

// -------------------------------------------------------------------- stores
export const canonicalRegistryStore = readable(canonicalRegistry, (set) => {
  const interval = setInterval(() => set(canonicalRegistry), 50);
  return () => clearInterval(interval);
});

// Reactive accessors via stores for compatibility with $-style reads in some components
export const devicesEnrichedStore = readable<EnrichedDevice[]>([], (set) => {
  let last: EnrichedDevice[] = [];
  const update = () => {
    const cur = getDevicesEnriched();
    if (JSON.stringify(cur) !== JSON.stringify(last)) {
      last = cur;
      set(last);
    }
  };
  update();
  const id = setInterval(update, 50);
  return () => clearInterval(id);
});

export const availableStatesTreeStore = readable<any>({}, (set) => {
  let last: any = null;
  const update = () => {
    const cur = getAvailableStatesTree();
    if (JSON.stringify(cur) !== JSON.stringify(last)) {
      last = cur;
      set(last);
    }
  };
  update();
  const id = setInterval(update, 50);
  return () => clearInterval(id);
});
