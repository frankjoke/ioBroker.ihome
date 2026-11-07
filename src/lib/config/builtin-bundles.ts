import type { TemplateBundle } from "$lib/types/templates";

/** Built-in bundles. The user can duplicate one to edit it. */
export const NETWORK_DEVICE_BUNDLE: TemplateBundle = {
  id: "network-device",
  name: "Network device",
  description:
    "Shows whether a phone, tablet or laptop is visible on the local network and when it last connected or disconnected. Configure the host under the adapter's Network devices first, then pick its JSON state here.",
  params: [
    {
      name: "source",
      label: "Network device state",
      type: "state",
      description:
        "The ihome.0.network.<id>.json state of a device configured in the adapter settings.",
    },
  ],
  items: [
    {
      name: "online",
      label: "Online",
      type: "boolean",
      role: "indicator.state",
      source: "online",
      readOnly: true,
    },
    {
      name: "lastConnected",
      label: "Last connected",
      type: "number",
      role: "value.time",
      source: "lastConnected",
      readOnly: true,
    },
    {
      name: "lastDisconnected",
      label: "Last disconnected",
      type: "number",
      role: "value.time",
      source: "lastDisconnected",
      readOnly: true,
    },
    {
      name: "lastSeen",
      label: "Last seen",
      type: "number",
      role: "value.time",
      source: "lastSeen",
      readOnly: true,
      hidden: true,
    },
  ],
  device: {
    type: "Custom",
    size: { w: 1, h: 1 },
    features: [],
    slots: [
      {
        kind: "value",
        source: "online",
        icon: { glyph: "devices" },
        rules: [
          {
            when: "truthy(online)",
            color: "var(--success-color)",
            glow: true,
          },
          {
            when: "!truthy(online)",
            color: "var(--text-muted)",
            disabled: true,
          },
        ],
      },
      { kind: "badge", source: "ago", options: { of: "lastConnected" } },
      { kind: "badge", source: "ago", options: { of: "lastDisconnected" } },
    ],
  },
  api: {
    source: `({ readFrom: "state", deviceType: "Custom" })`,
  },
};

export const BUILTIN_BUNDLES: TemplateBundle[] = [NETWORK_DEVICE_BUNDLE];
