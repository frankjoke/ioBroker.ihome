import { parseDuration } from "./duration";
import { normalizeStates, type StateSpec } from "./state-common";
import type {
  DeviceItem,
  DeviceParam,
  DeviceTemplateShape,
  Input,
  MachineLogic,
  OnRow,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

const ITEM_NAME = /^[A-Za-z0-9_-]+$/;
const TYPES = new Set(["boolean", "number", "string", "object"]);
const PARAM_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "duration",
  "state",
]);

function isAsyncFunction(value: unknown): boolean {
  return Object.prototype.toString.call(value) === "[object AsyncFunction]";
}

/** A string is split on dots; an array is used as exact keys. */
export function pickPath(
  value: unknown,
  path: string | Array<string | number>,
): unknown {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  return parts.reduce<unknown>(
    (current, key) =>
      current == null
        ? undefined
        : (current as Record<string | number, unknown>)[key],
    value,
  );
}

/** Check the evaluated template object; never calls the request functions. */
export function validateDeviceTemplate(value: unknown): {
  errors: string[];
  template?: DeviceTemplateShape;
} {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { errors: ["template must be an object"] };
  }
  const readFrom = value.readFrom === undefined ? "http" : value.readFrom;
  if (readFrom !== "http" && readFrom !== "state") {
    errors.push("readFrom must be http or state");
  }
  const stateMode = readFrom === "state";
  if (value.deviceType !== undefined && typeof value.deviceType !== "string") {
    errors.push("deviceType must be a string");
  }

  const items = value.itemList;
  if (!Array.isArray(items) || items.length === 0) {
    errors.push("template needs a non-empty itemList");
  } else {
    const names = new Set<string>();
    for (const raw of items) {
      if (!isRecord(raw)) {
        errors.push("item must be an object");
        continue;
      }
      const name = typeof raw.name === "string" ? raw.name : "";
      if (!name) {
        errors.push("item without a name");
        continue;
      }
      if (!ITEM_NAME.test(name)) {
        errors.push(`invalid item name: ${name}`);
      }
      if (name === "poll") {
        errors.push("item name poll is reserved for the timer");
      }
      if (names.has(name)) {
        errors.push(`duplicate item name: ${name}`);
      }
      names.add(name);
      if (typeof raw.type !== "string" || !TYPES.has(raw.type)) {
        errors.push(`${name}: unknown type`);
      }
      for (const key of ["label", "role", "unit", "feature"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "string") {
          errors.push(`${name}: ${key} must be a string`);
        }
      }
      if (raw.source !== undefined) {
        const source = raw.source;
        const valid =
          typeof source === "string" ||
          (Array.isArray(source) &&
            source.every(
              (part) => typeof part === "string" || typeof part === "number",
            ));
        if (!valid) {
          errors.push(`${name}: source must be a string or an array of names`);
        }
      }
      if (
        raw.states !== undefined &&
        typeof raw.states !== "string" &&
        !isRecord(raw.states)
      ) {
        errors.push(`${name}: states must be an object or JSON string`);
      } else if (
        typeof raw.states === "string" &&
        normalizeStates(raw.states) === undefined
      ) {
        errors.push(`${name}: states is not valid JSON`);
      }
      for (const key of ["readOnly", "updateAlways", "ack", "hidden"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
          errors.push(`${name}: ${key} must be a boolean`);
        }
      }
      if (stateMode && raw.readOnly !== true) {
        errors.push(`${name}: state templates are read-only`);
      }
      for (const key of ["min", "max", "step"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "number") {
          errors.push(`${name}: ${key} must be a number`);
        }
      }
      for (const key of ["conversion", "setConversion"]) {
        if (raw[key] !== undefined && typeof raw[key] !== "function") {
          errors.push(`${name}: ${key} must be a function`);
        } else if (
          typeof raw[key] === "function" &&
          isAsyncFunction(raw[key])
        ) {
          errors.push(`${name}: ${key} must be synchronous`);
        }
      }
      const writable = raw.readOnly !== true;
      if (!stateMode && writable) {
        if (typeof raw.foreignWriteName !== "string" || !raw.foreignWriteName) {
          errors.push(`${name} needs foreignWriteName`);
        }
        if (raw.ack === false) {
          errors.push(`${name}: ack false on a writable item would loop`);
        }
      }
    }
  }

  const params = value.params;
  if (params !== undefined) {
    if (!Array.isArray(params)) {
      errors.push("params must be an array");
    } else {
      const names = new Set<string>();
      for (const raw of params as unknown[]) {
        if (!isRecord(raw)) {
          errors.push("param must be an object");
          continue;
        }
        const name = typeof raw.name === "string" ? raw.name : "";
        if (!name) {
          errors.push("param without a name");
          continue;
        }
        if (names.has(name)) errors.push(`duplicate param: ${name}`);
        names.add(name);
        if (name === "baseState") {
          errors.push("param name baseState is reserved");
        }
        if (typeof raw.label !== "string" || !raw.label) {
          errors.push(`${name}: label must be a string`);
        }
        const type = typeof raw.type === "string" ? raw.type : "";
        if (!PARAM_TYPES.has(type)) {
          errors.push(`${name}: unknown param type`);
        }
        const fallback = raw.default;
        if (fallback !== undefined) {
          const valid =
            type === "number"
              ? typeof fallback === "number"
              : type === "boolean"
                ? typeof fallback === "boolean"
                : typeof fallback === "string";
          if (!valid) errors.push(`${name}: default has the wrong type`);
          if (type === "duration" && parseDuration(String(fallback)) === null) {
            errors.push(`${name}: default is not a duration`);
          }
        }
      }
    }
  }

  if (stateMode) {
    const params = Array.isArray(value.params) ? value.params : [];
    const source = params.some(
      (param) =>
        isRecord(param) && param.name === "source" && param.type === "state",
    );
    if (!source) errors.push("state template needs a source param");
  }

  if (stateMode) {
    if (value.readRequest !== undefined) {
      if (typeof value.readRequest !== "function") {
        errors.push("readRequest must be a function");
      } else if (isAsyncFunction(value.readRequest)) {
        errors.push("readRequest must be synchronous");
      }
    }
    if (value.writeRequest !== undefined) {
      if (typeof value.writeRequest !== "function") {
        errors.push("writeRequest must be a function");
      } else if (isAsyncFunction(value.writeRequest)) {
        errors.push("writeRequest must be synchronous");
      }
    }
  } else {
    if (typeof value.readRequest !== "function") {
      errors.push("readRequest must be a function");
    } else if (isAsyncFunction(value.readRequest)) {
      errors.push("readRequest must be synchronous");
    }
    if (typeof value.writeRequest !== "function") {
      errors.push("writeRequest must be a function");
    } else if (isAsyncFunction(value.writeRequest)) {
      errors.push("writeRequest must be synchronous");
    }
  }

  return errors.length > 0
    ? { errors }
    : { errors, template: value as unknown as DeviceTemplateShape };
}

function initialFor(item: DeviceItem): unknown {
  if (item.initial !== undefined) {
    if (item.type !== "object" || typeof item.initial === "string") {
      return item.initial;
    }
    return JSON.stringify(item.initial ?? null);
  }
  if (item.type === "boolean") return false;
  if (item.type === "number") return 0;
  if (item.type === "object") return "{}";
  return "";
}

/** The desired state objects for one template application. */
export function templateStateSpecs(
  template: DeviceTemplateShape,
  baseState: string,
): StateSpec[] {
  return template.itemList.map((item) => {
    const object = item.type === "object";
    const initial = initialFor(item);
    const common: Record<string, unknown> = {
      name: item.label ?? item.name,
      type: object ? "string" : item.type,
      role: object ? "json" : (item.role ?? "state"),
      read: true,
      write: item.readOnly !== true,
      unit: item.type === "number" ? (item.unit ?? "") : "",
      states: normalizeStates(item.states) ?? {},
      def: initial,
    };
    if (item.type === "number") {
      if (typeof item.min === "number" && Number.isFinite(item.min)) {
        common.min = item.min;
      }
      if (typeof item.max === "number" && Number.isFinite(item.max)) {
        common.max = item.max;
      }
      if (typeof item.step === "number" && Number.isFinite(item.step)) {
        common.step = item.step;
      }
    }
    return { id: `${baseState}.${item.name}`, common, initial };
  });
}

function literalParams(
  template: DeviceTemplateShape,
  params: Record<string, unknown>,
  baseState: string,
): { literal: Record<string, unknown>; stateParams: DeviceParam[] } {
  const stateParams = (template.params ?? []).filter(
    (param) => param.type === "state",
  );
  const stateNames = new Set(stateParams.map((param) => param.name));
  const literal: Record<string, unknown> = { baseState };
  for (const [name, value] of Object.entries(params)) {
    if (name === "baseState" || stateNames.has(name)) continue;
    literal[name] = value;
  }
  return { literal, stateParams };
}

function paramHeader(
  template: DeviceTemplateShape,
  params: Record<string, unknown>,
  baseState: string,
): string {
  const { literal, stateParams } = literalParams(template, params, baseState);
  const lines = [`const P = ${JSON.stringify(literal)};`];
  for (const param of stateParams) {
    const id = params[param.name];
    if (typeof id === "string" && id) {
      lines.push(`P.${param.name} = get(${JSON.stringify(id)});`);
    }
  }
  return lines.join("\n");
}

function mapItemsCode(): string {
  return `const pick = (value, path) => {
  const parts = Array.isArray(path) ? path : String(path).split(".");
  return parts.reduce((v, key) => (v == null ? undefined : v[key]), value);
};
for (const item of T.itemList) {
  try {
    const raw = item.source ? pick(result, item.source) : result;
    const converted = item.conversion ? item.conversion(result, raw) : raw;
    const next = item.type === "object" && typeof converted !== "string"
      ? JSON.stringify(converted ?? null)
      : converted;
    set(P.baseState + "." + item.name, next, {
      ack: item.ack ?? true,
      forward: item.updateAlways ? "always" : "changed",
    });
  } catch (e) {
    log("template item " + item.name + ": " + e, "warn");
  }
}`;
}

function readCode(
  template: DeviceTemplateShape,
  source: string,
  params: Record<string, unknown>,
  baseState: string,
): string {
  return `const T = (${source});
${paramHeader(template, params, baseState)}
const req = T.readRequest(P);
fetchJson(req.url, (result, error) => {
  if (error) { log(error, "warn"); return; }
${mapItemsCode()}
}, req.options);`;
}

function readStateCode(
  template: DeviceTemplateShape,
  source: string,
  params: Record<string, unknown>,
  baseState: string,
): string {
  const sourceId = typeof params.source === "string" ? params.source : "";
  return `const T = (${source});
const P = { baseState: ${JSON.stringify(baseState)} };
const value = get(${JSON.stringify(sourceId)});
let result = value;
if (typeof value === "string") {
  try { result = JSON.parse(value); } catch (e) { log("template source: " + e, "warn"); return; }
}
${mapItemsCode()}`;
}

function writeCode(
  template: DeviceTemplateShape,
  source: string,
  params: Record<string, unknown>,
  baseState: string,
  itemName: string,
): string {
  return `const T = (${source});
${paramHeader(template, params, baseState)}
const item = T.itemList.find((entry) => entry.name === ${JSON.stringify(itemName)});
const req = T.writeRequest(get(${JSON.stringify(itemName)}), item, P);
fetchJson(req.url, (data, error) => {
  if (error) log(error, "warn");
}, req.options);`;
}

/** Build the normal machine that polls and writes this template. */
export function buildDeviceLogic(
  template: DeviceTemplateShape,
  source: string,
  params: Record<string, unknown>,
  baseState: string,
  id: string,
  name: string,
): MachineLogic {
  if (template.readFrom === "state") {
    const sourceId = typeof params.source === "string" ? params.source : "";
    if (!sourceId) throw new Error("state template needs a source state");
    return {
      id,
      name,
      kind: "machine",
      inputs: {
        source: {
          from: { type: "state", ref: sourceId },
          kind: "event",
        },
      },
      output: { scope: "memory", name: id },
      init: { run: false },
      start: "Run",
      states: {
        Run: {
          on: [
            {
              on: "source",
              mode: "function",
              do: { code: readStateCode(template, source, params, baseState) },
            },
          ],
        },
      },
    };
  }
  const poll =
    typeof params.poll === "string" && parseDuration(params.poll) !== null
      ? params.poll
      : "30s";
  const inputs: Record<string, Input> = {
    poll: { from: { type: "timer", every: poll }, kind: "event" },
  };
  const rows: OnRow[] = [
    {
      on: "poll",
      mode: "function",
      do: { code: readCode(template, source, params, baseState) },
    },
  ];
  for (const item of template.itemList) {
    if (item.readOnly === true) continue;
    inputs[item.name] = {
      from: { type: "state", ref: `${baseState}.${item.name}` },
      kind: "event",
    };
    rows.push({
      on: item.name,
      ack: "false",
      edge: item.updateAlways ? "any" : "change",
      mode: "function",
      do: {
        code: writeCode(template, source, params, baseState, item.name),
      },
    });
  }
  return {
    id,
    name,
    kind: "machine",
    inputs,
    output: { scope: "memory", name: id },
    init: { run: false },
    start: "Run",
    states: { Run: { on: rows } },
  };
}
