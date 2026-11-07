import { expressionSyntaxProblem } from "$lib/config/code-syntax";
import { validateDeviceTemplate } from "$logic/device-templates";
import type { DeviceTemplate } from "$logic/types";

/** Evaluate the user-authored JS object literal in the browser. */
export function evaluateDeviceTemplate(source: string): unknown {
  return new Function(`return (${source});`)();
}

/** The first problem with an API template, or null.
 *  `evaluate: false` only compiles the source, so importing never runs it. */
export function deviceTemplateProblem(
  value: unknown,
  options: { evaluate?: boolean } = {},
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "An API template must be an object.";
  }
  const template = value as Partial<DeviceTemplate>;
  if (typeof template.id !== "string" || !template.id.trim()) {
    return "An API template needs a non-empty id.";
  }
  if (typeof template.name !== "string" || !template.name.trim()) {
    return "An API template needs a name.";
  }
  if (typeof template.source !== "string" || !template.source.trim()) {
    return "The API source is empty.";
  }
  if (options.evaluate === false) {
    return expressionSyntaxProblem(template.source);
  }
  let shape: unknown;
  try {
    shape = evaluateDeviceTemplate(template.source);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return validateDeviceTemplate(shape).errors[0] ?? null;
}

const SHRDZM_METER = `({
  readFrom: "state",
  deviceType: "Meter",
  params: [
    {
      name: "source",
      label: "MQTT sensor state",
      type: "state",
      description: "e.g. mqtt.0.SHRDZM.3C6105FB24B9.3C6105FB24B9.sensor",
    },
  ],
  itemList: [
    { name: "energy_total", label: "Energy total", type: "number",
      role: "value.energy", unit: "kWh", source: ["1.8.0"], readOnly: true,
      conversion: (result, raw) => Number(raw) / 1000 },
    { name: "energy_export", label: "Energy export", type: "number",
      role: "value.energy", unit: "kWh", source: ["2.8.0"], readOnly: true,
      conversion: (result, raw) => Number(raw) / 1000 },
    { name: "power", label: "Power import", type: "number",
      role: "value.power", unit: "W", source: ["1.7.0"], readOnly: true,
      decimals: 0 },
    { name: "power_export", label: "Power export", type: "number",
      role: "value.power", unit: "W", source: ["2.7.0"], readOnly: true,
      decimals: 0 },
    { name: "voltage_l1", label: "Voltage L1", type: "number",
      role: "value.voltage", unit: "V", source: ["32.7.0"], readOnly: true,
      decimals: 1 },
    { name: "voltage_l2", label: "Voltage L2", type: "number",
      role: "value.voltage", unit: "V", source: ["52.7.0"], readOnly: true,
      decimals: 1 },
    { name: "voltage_l3", label: "Voltage L3", type: "number",
      role: "value.voltage", unit: "V", source: ["72.7.0"], readOnly: true,
      decimals: 1 },
    { name: "current_l1", label: "Current L1", type: "number",
      role: "value.current", unit: "A", source: ["31.7.0"], readOnly: true,
      decimals: 2 },
    { name: "current_l2", label: "Current L2", type: "number",
      role: "value.current", unit: "A", source: ["51.7.0"], readOnly: true,
      decimals: 2 },
    { name: "current_l3", label: "Current L3", type: "number",
      role: "value.current", unit: "A", source: ["71.7.0"], readOnly: true,
      decimals: 2 },
    { name: "timestamp", label: "Timestamp", type: "string", role: "text",
      source: ["timestamp"], readOnly: true, hidden: true },
    { name: "uptime", label: "Uptime", type: "string", role: "text",
      source: ["uptime"], readOnly: true, hidden: true },
  ],
})`;

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
  {
    id: "shrdzm-mqtt-meter",
    name: "SHRDZM / MQTT electricity meter",
    description:
      "Reads the SHRDZM JSON from an MQTT state and creates a Meter device with energy, power, voltage and current.",
    source: SHRDZM_METER,
  },
];
