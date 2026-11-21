// External-session policy as a schema: the card renders it with the shared
// settings editor. Storage stays `settings.externalSession`.

import type { SettingsField } from "$adapter/settings-schema";

export const externalSessionsSchema: SettingsField[] = [
  {
    name: "localHosts",
    label: "Local hosts",
    type: "array",
    item: "string",
    description:
      "Hosts that always count as local, e.g. a VPN name. One host per entry.",
  },
  {
    name: "externalHosts",
    label: "External hosts",
    type: "array",
    item: "string",
    description:
      "Hosts that count as external even on a private address. One host per entry.",
  },
  {
    name: "forceExternal",
    label: "Treat every session as external",
    type: "boolean",
    description:
      "For proxies that hide the client address. Secured tiles and pages are then hidden everywhere.",
  },
];
