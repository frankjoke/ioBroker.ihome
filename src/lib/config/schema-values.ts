// Value-side helpers for the schema settings editor: legacy JSON parsing,
// per-field validation, row defaults and conditional visibility. The adapter
// remains authoritative; these keep the editor honest before a save.

import type {
  SettingsArrayItem,
  SettingsField,
  SettingsObjectSchema,
} from "$adapter/settings-schema";

function parseLegacy(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function structuredValue(
  field: SettingsField,
  value: unknown,
): { value: unknown } | { problem: string } {
  if (field.type !== "array" && field.type !== "object") {
    return { value };
  }
  const parsed = parseLegacy(value);
  if (field.type === "array") {
    return Array.isArray(parsed)
      ? { value: parsed }
      : { problem: `${field.label} must be an array or valid JSON.` };
  }
  return isRecord(parsed)
    ? { value: parsed }
    : { problem: `${field.label} must be an object or valid JSON.` };
}

function itemProblem(
  item: SettingsArrayItem,
  value: unknown,
  label: string,
): string | null {
  if (item === "string") {
    return typeof value === "string" ? null : `${label} must be a string.`;
  }
  if (item === "number") {
    return typeof value === "number" && Number.isFinite(value)
      ? null
      : `${label} must be a number.`;
  }
  if (item === "boolean") {
    return typeof value === "boolean"
      ? null
      : `${label} must be true or false.`;
  }
  if (!isRecord(value)) return `${label} must be an object.`;
  return objectProblem(item, value);
}

export function valueProblem(
  field: SettingsField,
  value: unknown,
): string | null {
  if (!isSet(value)) {
    return field.required ? `${field.label} is required.` : null;
  }
  switch (field.type) {
    case "string":
      return typeof value === "string" ? null : `${field.label} must be text.`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${field.label} must be a number.`;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `${field.label} must be true or false.`;
    case "select":
      return typeof value === "string" && field.options?.includes(value)
        ? null
        : `${field.label} must be one of ${field.options?.join(", ")}.`;
    case "json":
      if (typeof value !== "string") return `${field.label} must be JSON text.`;
      try {
        JSON.parse(value);
        return null;
      } catch {
        return `${field.label} must be valid JSON.`;
      }
    case "object": {
      const parsed = structuredValue(field, value);
      if ("problem" in parsed) return parsed.problem;
      if (!isRecord(parsed.value)) return `${field.label} must be an object.`;
      return objectProblem(
        { fields: field.fields ?? [], exactlyOne: field.exactlyOne },
        parsed.value,
      );
    }
    case "array": {
      const parsed = structuredValue(field, value);
      if ("problem" in parsed) return parsed.problem;
      const rows = parsed.value as unknown[];
      for (const row of rows) {
        const problem = itemProblem(field.item!, row, `${field.label} entry`);
        if (problem) return problem;
      }
      return null;
    }
  }
}

export function objectProblem(
  schema: SettingsObjectSchema,
  value: Record<string, unknown>,
): string | null {
  for (const field of schema.fields) {
    const problem = valueProblem(field, value[field.name]);
    if (problem) return problem;
  }
  if (schema.exactlyOne) {
    const set = schema.exactlyOne.filter((name) => isSet(value[name]));
    if (set.length !== 1) {
      return `Set exactly one of ${schema.exactlyOne.join(", ")}.`;
    }
  }
  return null;
}

export function itemDefaults(item: SettingsArrayItem): unknown {
  if (item === "string") return "";
  if (item === "number") return 0;
  if (item === "boolean") return false;
  const row: Record<string, unknown> = {};
  for (const field of item.fields) {
    if (field.default !== undefined) row[field.name] = field.default;
  }
  return row;
}

export function visibleFields(
  fields: SettingsField[],
  values: Record<string, unknown>,
): SettingsField[] {
  return fields.filter(
    (field) =>
      !field.visibleWhen ||
      values[field.visibleWhen.field] === field.visibleWhen.equals,
  );
}

export function rowSummary(
  fields: SettingsField[],
  row: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const field of fields) {
    if (field.type === "object" || field.type === "array") continue;
    const value = row[field.name];
    if (!isSet(value) || typeof value === "object") continue;
    parts.push(String(value));
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}
