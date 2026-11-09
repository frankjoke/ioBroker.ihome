import type { PluginView } from "$adapter/plugin-admin";
import type { PluginBundle, PluginBundleControl } from "$adapter/plugin-ops";
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { upsertDevice } from "$lib/registry.svelte.js";
import { getCanonicalRegistry } from "$lib/stores/devices.svelte";
import { DEVICE_TYPES } from "$lib/config/features";
import type { Control, Device, DeviceType, Transform } from "$lib/types/device";

export const PLUGIN_DEVICE_TAG = (id: string) => `plugin:${id}`;
export const BUNDLE_TAG_PREFIX = "bundle:";

const ABSOLUTE_STATE = /^[A-Za-z0-9_-]+\.[0-9]+(?:\.|$)/;

/** Stable short hash of the template, used to detect a changed bundle. */
export function bundleHash(bundle: PluginBundle): string {
  const text = JSON.stringify(bundle);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** `plugins.<id>` unless the plugin has its own relative/absolute `base`. */
export function bundlePrefix(plugin: PluginView, namespace: string): string {
  const fallback = `plugins.${plugin.id}`;
  const value =
    String(plugin.settings?.base ?? fallback)
      .trim()
      .replace(/^\.+|\.+$/g, "") || fallback;
  return ABSOLUTE_STATE.test(value) ? value : `${namespace}.${value}`;
}

export function bundleStateId(state: string, prefix: string): string {
  return ABSOLUTE_STATE.test(state) ? state : `${prefix}.${state}`;
}

export function findPluginDevice(pluginId: string): Device | undefined {
  return (getCanonicalRegistry().devices ?? []).find((device) =>
    (device.tags ?? []).includes(PLUGIN_DEVICE_TAG(pluginId)),
  );
}

export function deviceBundleHash(device: Device): string | undefined {
  const tag = (device.tags ?? []).find((entry) =>
    entry.startsWith(BUNDLE_TAG_PREFIX),
  );
  return tag?.slice(BUNDLE_TAG_PREFIX.length);
}

function reusedControlId(
  control: PluginBundleControl,
  stateId: string,
  index: number,
  previous: Control[],
  used: Set<string>,
): string | undefined {
  const byState = previous.find(
    (entry) => entry.stateId === stateId && !used.has(entry.id),
  );
  if (byState) return byState.id;
  const byLabel = previous.find(
    (entry) =>
      entry.feature === control.feature &&
      entry.label === control.label &&
      !used.has(entry.id),
  );
  if (byLabel) return byLabel.id;
  const byIndex = previous[index];
  return byIndex?.feature === control.feature && !used.has(byIndex.id)
    ? byIndex.id
    : undefined;
}

/**
 * Build the device for a plugin bundle. Matching existing controls keep their
 * ids, so page tiles that reference them survive an update.
 */
export function buildPluginDevice(
  plugin: PluginView,
  bundle: PluginBundle,
  namespace: string,
  existing?: Device,
): Device {
  const prefix = bundlePrefix(plugin, namespace);
  const previous = existing?.controls ?? [];
  const used = new Set<string>();
  const controls: Control[] = bundle.device.controls.map((control, index) => {
    const stateId = bundleStateId(control.state, prefix);
    const id =
      reusedControlId(control, stateId, index, previous, used) ??
      crypto.randomUUID();
    used.add(id);
    const next = {
      ...(previous.find((entry) => entry.id === id) ?? {}),
      id,
      feature: control.feature,
      stateId,
      writable: control.writable === true,
    } as Control;
    if (control.label) next.label = control.label;
    else delete next.label;
    if (control.unit) next.unit = control.unit;
    else delete next.unit;
    if (control.role) next.role = control.role;
    else delete next.role;
    if (control.type) next.type = control.type;
    else delete next.type;
    if (control.transform) next.transform = control.transform as Transform;
    else delete next.transform;
    return next;
  });
  const type = DEVICE_TYPES.includes(bundle.device.type as DeviceType)
    ? (bundle.device.type as DeviceType)
    : (existing?.type ?? "Custom");
  const tags = [
    ...new Set([
      ...(existing?.tags ?? []).filter(
        (tag) =>
          !tag.startsWith(BUNDLE_TAG_PREFIX) &&
          tag !== PLUGIN_DEVICE_TAG(plugin.id),
      ),
      PLUGIN_DEVICE_TAG(plugin.id),
      `${BUNDLE_TAG_PREFIX}${bundleHash(bundle)}`,
    ]),
  ];
  return {
    ...(existing ?? {}),
    id: existing?.id ?? crypto.randomUUID(),
    name: existing?.name ?? bundle.device.name ?? plugin.name,
    type,
    ...(bundle.device.icon ? { icon: bundle.device.icon } : {}),
    ...(bundle.device.size
      ? { size: bundle.device.size as Device["size"] }
      : {}),
    tags,
    controls,
  };
}

/** Create or update the device for an enabled plugin. */
export function applyPluginBundle(
  plugin: PluginView,
  existing = findPluginDevice(plugin.id),
): Device {
  if (!plugin.bundle) throw new Error("plugin has no device template");
  const device = buildPluginDevice(
    plugin,
    plugin.bundle,
    ioBroker.namespace,
    existing,
  );
  upsertDevice(device);
  return device;
}
