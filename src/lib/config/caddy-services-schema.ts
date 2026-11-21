// The Caddy services list as a schema: the card renders it with the shared
// settings editor in managed mode (the plugin actions own persistence).

import type { SettingsField } from "$adapter/settings-schema";

export function servicesSchema(endpoints: string[]): SettingsField[] {
  return [
    {
      name: "services",
      label: "Services",
      type: "array",
      item: {
        fields: [
          {
            name: "path",
            label: "Path",
            type: "string",
            required: true,
            visibleWhen: { field: "kind", equals: "proxy" },
            description: "Public base path; a webhook uses its endpoint path.",
          },
          {
            name: "upstream",
            label: "Upstream",
            type: "string",
            required: true,
            description: "host:port on loopback or a private address.",
          },
          {
            name: "kind",
            label: "Kind",
            type: "select",
            options: ["webhook", "proxy"],
            readonly: true,
          },
          {
            name: "auth",
            label: "Auth",
            type: "select",
            options: ["token", "basic"],
            readonly: true,
          },
          {
            name: "endpoint",
            label: "http.in endpoint",
            type: "select",
            options: endpoints,
            visibleWhen: { field: "kind", equals: "webhook" },
          },
          {
            name: "stripPrefix",
            label: "Strip prefix",
            type: "boolean",
            visibleWhen: { field: "kind", equals: "proxy" },
          },
          { name: "enabled", label: "Enabled", type: "boolean" },
        ],
      },
    },
  ];
}
