import type {
  DeviceRegistry,
  EnrichedDevice,
  EnrichedControl,
  Control,
} from "$lib/types/device";
import { applyRead } from "$lib/utils/transform";
import { widgetFor } from "$lib/config/features";
import { readable } from "svelte/store";
import { SvelteSet } from "svelte/reactivity";

export const DEVICE_LIST_ID = "0_userdata.0.Test.AiHome.deviceList";

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
let programVersion = 0;
export function registerProgramStateId(id: string) {
  if (!id || PROGRAM_STATE_IDS.has(id)) return;
  PROGRAM_STATE_IDS.add(id);
  programVersion++;
}

let usedStateCache: {
  reg: DeviceRegistry | null;
  ver: number;
  ids: Set<string>;
} = {
  reg: null,
  ver: -1,
  ids: new SvelteSet(),
};

export function getUsedStateIds(): Set<string> {
  if (
    usedStateCache.reg === canonicalRegistry &&
    usedStateCache.ver === programVersion
  ) {
    return usedStateCache.ids;
  }
  const ids = new SvelteSet<string>(PROGRAM_STATE_IDS);
  for (const device of canonicalRegistry.devices ?? []) {
    for (const control of device.controls ?? []) {
      if (control.stateId) ids.add(control.stateId);
    }
  }
  usedStateCache = { reg: canonicalRegistry, ver: programVersion, ids };
  return ids;
}

// ---------------------------------------------------------------- enrichment
function _devicesEnriched(): EnrichedDevice[] {
  const result = (canonicalRegistry.devices ?? []).map((device) => {
    const controls: EnrichedControl[] = (device.controls ?? []).map(
      (control: Control) => {
        const st: any = stateSource?.get(control.stateId);
        const obj: any = objectSource?.get(control.stateId);
        const liveValue =
          st !== undefined ? applyRead(st.val, control.transform) : undefined;
        return {
          ...control,
          liveValue,
          available: st !== undefined || obj !== undefined,
          exists: obj !== undefined,
          displayRoom: device.room ?? obj?.common?.room ?? undefined,
          object: obj,
          widget: widgetFor(device.type, control.feature),
        };
      },
    );
    const deviceDisplayRoom =
      device.room ?? controls.find((c) => c.displayRoom)?.displayRoom;
    return {
      ...device,
      controls,
      displayRoom: deviceDisplayRoom,
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
