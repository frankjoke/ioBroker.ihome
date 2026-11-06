import type { DeviceTemplate } from "$logic/types";

/** Evaluate the user-authored JS object literal in the browser. */
export function evaluateDeviceTemplate(source: string): unknown {
  return new Function(`return (${source});`)();
}

const GENERIC_REST = `({
  params: [
    {
      name: "baseUrl",
      label: "Base URL",
      type: "string",
      description: "e.g. http://192.168.1.50:8099/service/api",
    },
    {
      name: "token",
      label: "Token",
      type: "state",
      description: "State ID whose string value is sent as the Bearer token.",
    },
    {
      name: "poll",
      label: "Poll interval",
      type: "duration",
      default: "30s",
      description: "How fast you want to update; e.g. every  30s, 5m, 1h.",
    },
  ],
  itemList: [
    {
      name: "power",
      label: "Power",
      type: "boolean",
      role: "switch",
      source: "data.power",
      foreignWriteName: "power",
      conversion: (result, raw) => raw === true || raw === "1" || raw === "on",
      setConversion: (value) => (value ? "1" : "0"),
    },
    {
      name: "level",
      label: "Level",
      type: "number",
      role: "level",
      unit: "%",
      states: { "0": "Off", "100": "Full" },
      source: "data.level",
      foreignWriteName: "level",
      setConversion: (value) => String(value),
    },
    {
      name: "info",
      label: "Info",
      type: "string",
      role: "text",
      source: "data.info",
      readOnly: true,
    },
  ],
  readRequest(params) {
    return {
      url: params.baseUrl + "/status",
      options: { headers: { authorization: "Bearer " + params.token } },
    };
  },
  writeRequest(value, item, params) {
    return {
      url:
        params.baseUrl +
        "/set?" +
        item.foreignWriteName +
        "=" +
        encodeURIComponent(item.setConversion(value)),
    };
  },
})`;

export const BUILTIN_DEVICE_TEMPLATES: DeviceTemplate[] = [
  {
    id: "generic-rest",
    name: "Generic REST device",
    description:
      "Polls a JSON status endpoint and writes changed values back to /set.",
    source: GENERIC_REST,
  },
];
