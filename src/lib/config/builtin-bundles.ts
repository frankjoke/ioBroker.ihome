import type { TemplateBundle, TemplateItem } from "$lib/types/templates";
import { SAMSUNG_REMOTE_HTML } from "$lib/config/samsung-remote";
import { NETWORK_WAKE_HTML } from "$lib/config/network-wake";

/** What the adapter's `network.<id>.json` state holds. */
const NETWORK_DEVICE_ITEMS: TemplateItem[] = [
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
];

/** Built-in bundles. The user can duplicate one to edit it. */
export const NETWORK_DEVICE_BUNDLE: TemplateBundle = {
  id: "network-device",
  name: "Network device",
  description:
    "Shows whether a phone, tablet or laptop is visible on the local network and when it last connected or disconnected. Configure the host under the Network device info plugin's Settings (Endpoints) first, then pick its JSON state here.",
  help: `Shows whether a phone, tablet or laptop is on the local network.

**Before applying:** add the device under the Network device info plugin's *Settings → Endpoints* with its host, then pick its JSON state here. The tile shows online/offline and when it was last connected or disconnected.

Presence can lag a few minutes on Wi-Fi; a device that sleeps may look offline.`,
  params: [
    {
      name: "source",
      label: "Network device state",
      type: "state",
      description:
        "The ihome.0.network.<id>.json state of a device configured in the plugin's endpoints.",
    },
  ],
  items: NETWORK_DEVICE_ITEMS,
  device: {
    type: "Custom",
    size: { w: 2, h: 2 },
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
          { when: "!truthy(online)", color: "var(--text-muted)" },
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

/** Presence plus a Wake button in the detail page. */
export const NETWORK_DEVICE_WAKE_BUNDLE: TemplateBundle = {
  id: "network-device-wake",
  name: "Network device + Wake",
  description:
    "Presence for a tracked device plus a Wake button in its detail page. Configure the device in the Network device info plugin's Settings (Endpoints) with host and MAC first.",
  help: `Shows online/last seen and adds a **Wake** button to the detail page.

**Before applying:** add the device under the Network device info plugin's *Settings → Endpoints* with its host and MAC, then pick its JSON state and enter that device id here.

The button calls \`network.info\` with \`wake: true\`; a device without a MAC cannot be woken.`,
  params: [
    {
      name: "source",
      label: "Network device state",
      type: "state",
      description:
        "The ihome.0.network.<id>.json state of a device configured in the plugin's endpoints.",
    },
    {
      name: "wakeDevice",
      label: "Network device id",
      type: "string",
      default: "",
      description:
        "The id from the Network device info plugin's endpoints. It needs a MAC for Wake-on-LAN.",
    },
  ],
  items: NETWORK_DEVICE_ITEMS,
  device: {
    type: "Custom",
    size: { w: 2, h: 2 },
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
          { when: "!truthy(online)", color: "var(--text-muted)" },
        ],
      },
      { kind: "badge", source: "ago", options: { of: "lastConnected" } },
      { kind: "badge", source: "ago", options: { of: "lastDisconnected" } },
      {
        kind: "html",
        where: "modal",
        label: "Wake",
        options: { html: NETWORK_WAKE_HTML },
      },
    ],
  },
  api: {
    source: `({ readFrom: "state", deviceType: "Custom" })`,
  },
};

export const BUILTIN_BUNDLES: TemplateBundle[] = [
  NETWORK_DEVICE_BUNDLE,
  NETWORK_DEVICE_WAKE_BUNDLE,
];

export const SAMSUNG_TV_BUNDLE: TemplateBundle = {
  id: "samsung-tv-remote",
  name: "Samsung TV remote",
  description:
    "A Samsung TV remote. Configure the TV under the Network device info plugin's Settings (Endpoints: host and MAC) and set its id here; the remote reads the host and wakes the TV through the adapter plugin.",
  help: `A Samsung TV remote: a presence tile plus a full remote in a modal.

**Before applying:** add the TV under the Network device info plugin's *Settings → Endpoints* with its host and MAC address (the MAC is needed for Wake-on-LAN), then set that device's id here.

**Using it:** *Verbinden* opens the WebSocket to the TV; the TV may ask you to allow the remote once. *Power* sends standby when connected and wakes the TV over the network when it is off. While disconnected, only Power and Verbinden are enabled.`,
  params: [
    {
      name: "wakeDevice",
      label: "Network device",
      type: "string",
      default: "tv",
      description:
        "The id from the Network device info plugin's endpoints list. It must have a MAC for Wake-on-LAN.",
    },
  ],
  device: {
    type: "Custom",
    size: { w: 4, h: 4 },
    features: [],
    slots: [
      {
        kind: "html",
        where: "modal",
        label: "TV remote",
        options: { html: SAMSUNG_REMOTE_HTML },
      },
    ],
  },
};
