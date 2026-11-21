// Recursive settings schema shared by the adapter validation and the SPA
// editor. A malformed schema is rejected whole; structured values accept the
// legacy JSON-string form until the editor writes a real array/object.

export type SettingsFieldType =
  "string" | "number" | "boolean" | "select" | "json" | "object" | "array";

export interface SettingsField {
  name: string;
  label: string;
  type: SettingsFieldType;
  description?: string;
  default?: string | number | boolean;
  placeholder?: string;
  options?: string[];
  required?: boolean;
  readonly?: boolean;
  /** Show only when a sibling field has this value. */
  visibleWhen?: { field: string; equals: string | number | boolean };
  /** type: object */
  fields?: SettingsField[];
  /** type: object: at least one, at most one, of these nested fields. */
  exactlyOne?: string[];
  /** type: array */
  item?: SettingsArrayItem;
}

export interface SettingsObjectSchema {
  fields: SettingsField[];
  /** At least one, at most one, of these fields must be set. */
  exactlyOne?: string[];
}

export type SettingsArrayItem =
  "string" | "number" | "boolean" | SettingsObjectSchema;

export interface SettingsTabDef {
  id: string;
  label: string;
  fields: string[];
}

/** Backwards-compatible name for a schema field. */
export type PluginSettingDef = SettingsField;

export const MAX_SETTING_FIELDS = 40;
export const MAX_SETTINGS_FIELDS_TOTAL = 120;
export const MAX_SETTINGS_DEPTH = 4;
const MAX_OBJECT_FIELDS = 20;
const MAX_TABS = 8;
const MAX_OPTIONS = 50;
const TAB_ID = /^[a-z0-9-]{1,16}$/;
const RESERVED_TABS = new Set(["help", "code"]);

type ScalarType = "string" | "number" | "boolean" | "select" | "json";
const SCALAR_TYPES = ["string", "number", "boolean", "select", "json"] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function textOf(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function jsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isScalarType(value: unknown): value is ScalarType {
  return SCALAR_TYPES.some((type) => type === value);
}

interface ParseState {
  total: number;
}

/** undefined = absent, null = invalid. */
function exactlyOneOf(
  value: unknown,
  fields: SettingsField[],
): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2 || value.length > 8)
    return null;
  const names: string[] = [];
  for (const entry of value) {
    const name = textOf(entry, 64);
    if (!name) return null;
    names.push(name);
  }
  if (new Set(names).size !== names.length) return null;
  const known = new Set(fields.map((field) => field.name));
  if (names.some((name) => !known.has(name))) return null;
  return names;
}

function arrayItemOf(
  value: unknown,
  depth: number,
  state: ParseState,
): SettingsArrayItem | null {
  if (value === "string" || value === "number" || value === "boolean") {
    return value;
  }
  if (!record(value)) return null;
  const fields = fieldsOf(value.fields, depth, state, MAX_OBJECT_FIELDS);
  if (!fields) return null;
  const exactlyOne = exactlyOneOf(value.exactlyOne, fields);
  if (exactlyOne === null) return null;
  return { fields, ...(exactlyOne ? { exactlyOne } : {}) };
}

function fieldOf(
  value: unknown,
  depth: number,
  state: ParseState,
): SettingsField | null {
  if (!record(value) || depth > MAX_SETTINGS_DEPTH) return null;
  state.total += 1;
  if (state.total > MAX_SETTINGS_FIELDS_TOTAL) return null;
  const name = textOf(value.name, 64);
  const label = textOf(value.label, 80);
  if (!name || !label) return null;
  if (
    value.type !== "object" &&
    value.type !== "array" &&
    !isScalarType(value.type)
  ) {
    return null;
  }
  const type = value.type as SettingsFieldType;
  const def: SettingsField = { name, label, type };
  if (value.description !== undefined) {
    const description = textOf(value.description, 500);
    if (!description) return null;
    def.description = description;
  }
  if (value.placeholder !== undefined) {
    const placeholder = textOf(value.placeholder, 120);
    if (!placeholder) return null;
    def.placeholder = placeholder;
  }
  if (value.required !== undefined) {
    if (typeof value.required !== "boolean") return null;
    def.required = value.required;
  }
  if (value.readonly !== undefined) {
    if (typeof value.readonly !== "boolean") return null;
    def.readonly = value.readonly;
  }
  if (value.options !== undefined) {
    if (type !== "select") return null;
    if (
      !Array.isArray(value.options) ||
      value.options.length === 0 ||
      value.options.length > MAX_OPTIONS ||
      !value.options.every((option) => textOf(option, 80))
    ) {
      return null;
    }
    def.options = value.options as string[];
  }
  if (type === "select" && !def.options) return null;
  if (value.default !== undefined) {
    if (
      typeof value.default !== "string" &&
      typeof value.default !== "number" &&
      typeof value.default !== "boolean"
    ) {
      return null;
    }
    if (type === "json" && typeof value.default !== "string") return null;
    if (type === "select" && !def.options?.includes(String(value.default))) {
      return null;
    }
    if (type === "object" || type === "array") return null;
    def.default = value.default;
  }
  if (type === "object") {
    const fields = fieldsOf(value.fields, depth + 1, state, MAX_OBJECT_FIELDS);
    if (!fields) return null;
    const exactlyOne = exactlyOneOf(value.exactlyOne, fields);
    if (exactlyOne === null) return null;
    def.fields = fields;
    if (exactlyOne) def.exactlyOne = exactlyOne;
  }
  if (type === "array") {
    const item = arrayItemOf(value.item, depth + 1, state);
    if (!item) return null;
    def.item = item;
  }
  return def;
}

function fieldsOf(
  value: unknown,
  depth: number,
  state: ParseState,
  limit: number,
): SettingsField[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > limit) {
    return null;
  }
  const fields: SettingsField[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    const field = fieldOf(entry, depth, state);
    if (!field || names.has(field.name)) return null;
    names.add(field.name);
    fields.push(field);
  }
  for (const field of fields) {
    if (!field.visibleWhen) continue;
    if (!names.has(field.visibleWhen.field)) return null;
    const equals = field.visibleWhen.equals;
    if (
      typeof equals !== "string" &&
      typeof equals !== "number" &&
      typeof equals !== "boolean"
    ) {
      return null;
    }
  }
  return fields;
}

/** Parse a plugin settings schema; undefined means invalid, as before. */
export function parseSettingsSchema(
  value: unknown,
): SettingsField[] | undefined {
  return (
    fieldsOf(jsonish(value), 1, { total: 0 }, MAX_SETTING_FIELDS) ?? undefined
  );
}

/** Backwards-compatible name used by existing importers. */
export function pluginSettingsSchema(
  value: unknown,
): SettingsField[] | undefined {
  return parseSettingsSchema(value);
}

export function parseSettingsTabs(
  value: unknown,
  schema: SettingsField[],
): SettingsTabDef[] | undefined {
  const parsed = jsonish(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MAX_TABS
  ) {
    return undefined;
  }
  const known = new Set(schema.map((field) => field.name));
  const ids = new Set<string>();
  const owners = new Set<string>();
  const tabs: SettingsTabDef[] = [];
  for (const entry of parsed) {
    if (!record(entry)) return undefined;
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const label = textOf(entry.label, 40);
    if (!TAB_ID.test(id) || RESERVED_TABS.has(id) || !label) return undefined;
    if (ids.has(id)) return undefined;
    if (!Array.isArray(entry.fields) || entry.fields.length === 0) {
      return undefined;
    }
    const fields: string[] = [];
    for (const candidate of entry.fields) {
      const name = textOf(candidate, 64);
      if (!name || !known.has(name) || owners.has(name)) return undefined;
      owners.add(name);
      fields.push(name);
    }
    ids.add(id);
    tabs.push({ id, label, fields });
  }
  return tabs;
}

function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function structured(value: unknown): { value: unknown } | null {
  if (typeof value !== "string") return { value };
  try {
    return { value: JSON.parse(value) };
  } catch {
    return null;
  }
}

function itemProblem(
  item: SettingsArrayItem,
  value: unknown,
  path: string,
): string | null {
  if (item === "string") {
    return typeof value === "string" ? null : `${path} must be a string`;
  }
  if (item === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? null
      : `${path} must be a number`;
  }
  if (item === "boolean") {
    return typeof value === "boolean" ? null : `${path} must be a boolean`;
  }
  if (!record(value)) return `${path} must be an object`;
  return objectProblem(item.fields, value, path, item.exactlyOne);
}

function fieldProblem(
  field: SettingsField,
  value: unknown,
  path: string,
): string | null {
  const at = `${path}.${field.name}`;
  if (field.type === "string") {
    return typeof value === "string" ? null : `${at} must be a string`;
  }
  if (field.type === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? null
      : `${at} must be a number`;
  }
  if (field.type === "boolean") {
    return typeof value === "boolean" ? null : `${at} must be a boolean`;
  }
  if (field.type === "select") {
    return typeof value === "string" && field.options?.includes(value)
      ? null
      : `${at} must be one of ${field.options?.join(", ")}`;
  }
  if (field.type === "json") {
    if (typeof value !== "string") return `${at} must be a JSON string`;
    try {
      JSON.parse(value);
      return null;
    } catch {
      return `${at} must be valid JSON`;
    }
  }
  const parsed = structured(value);
  if (!parsed) return `${at} must be valid JSON`;
  if (field.type === "object") {
    if (!record(parsed.value)) return `${at} must be an object`;
    return objectProblem(
      field.fields ?? [],
      parsed.value,
      at,
      field.exactlyOne,
    );
  }
  if (!Array.isArray(parsed.value)) return `${at} must be an array`;
  for (let index = 0; index < parsed.value.length; index += 1) {
    const problem = itemProblem(
      field.item!,
      parsed.value[index],
      `${at}[${index}]`,
    );
    if (problem) return problem;
  }
  return null;
}

function objectProblem(
  fields: SettingsField[],
  values: Record<string, unknown>,
  path: string,
  exactlyOne?: string[],
): string | null {
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined) {
      if (field.required) return `${path}.${field.name} is required`;
      continue;
    }
    const problem = fieldProblem(field, value, path);
    if (problem) return problem;
  }
  if (exactlyOne) {
    const set = exactlyOne.filter((name) => isSet(values[name]));
    if (set.length !== 1) {
      return `${path} must set exactly one of ${exactlyOne.join(", ")}`;
    }
  }
  return null;
}

/** Strict check used when a page/import writes settings. */
export function settingsProblem(
  schema: SettingsField[] | undefined,
  settings: Record<string, unknown> | undefined,
): string | null {
  if (!settings) return null;
  if (!record(settings)) return "settings must be an object";
  if (!schema) return null;
  return objectProblem(schema, settings, "settings");
}
