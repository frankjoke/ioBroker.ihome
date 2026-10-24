import { newLocalTaken } from "$lib/config/virtual-ops";

/** A global variable: either a constant kept inside iHome, or a named
 *  reference to an ioBroker state (inside ihome.0 or anywhere else). */
export interface GlobalVariable {
  id: string;
  name: string;
  kind: "constant" | "state";
  /** string | number | boolean for constants and new states; a picked state
   *  keeps its object's own type (which may be "mixed" or anything else). */
  type: string;
  /** Constant value, kept as text so the form round-trips exactly. */
  value?: string;
  /** State kind: the full ioBroker state id. */
  stateId?: string;
  unit?: string;
  notes?: string;
  /** The created state's object settings — read only when the state is created
   *  (an existing state keeps its own; nothing is ever overwritten). */
  role?: string;
  /** Enum ids (`enum.rooms.*`, `enum.functions.*`) the created state joins. */
  enums?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface VariableLibrary {
  version: number;
  updatedAt: number;
  variables: GlobalVariable[];
}

/** The adapter's variables folder, created only when a state is placed there. */
export const VARIABLES_FOLDER_ID = "ihome.0.Variables";

/** Split a state id into its adapter instance and the path below it. */
export function splitStateId(id: string): {
  namespace: string;
  relative: string;
} {
  const parts = String(id ?? "").split(".");
  if (parts.length < 3) return { namespace: "", relative: "" };
  return {
    namespace: parts.slice(0, 2).join("."),
    relative: parts.slice(2).join("."),
  };
}

/** Full state id from a namespace and a relative path; "" when incomplete. */
export function buildStateId(namespace: string, relative: string): string {
  const ns = String(namespace ?? "").trim();
  const rel = String(relative ?? "")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return ns && rel ? `${ns}.${rel}` : "";
}

/** ioBroker ids have at least adapter.instance.path and no blank/spacey parts. */
export function validStateId(id: string): boolean {
  const parts = String(id ?? "").split(".");
  return (
    parts.length >= 3 && parts.every((p) => p.trim() !== "" && !/\s/.test(p))
  );
}

/** An iHome instance namespace (`ihome.0`, `ihome.1`, …). */
export function isIhomeNamespace(namespace: string): boolean {
  return /^ihome\.\d+$/.test(String(namespace ?? "").trim());
}

/**
 * A variable's name is its reference: dots are state paths and spaces are
 * noise, so both become `_` — the name can never be mistaken for a state id.
 * A leading digit gets a `v_` prefix, so the name is always a valid identifier.
 */
export function restrictName(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^A-Za-z0-9_]+/g, "_");
  if (!cleaned) return "";
  return /^[0-9]/.test(cleaned) ? `v_${cleaned}` : cleaned;
}

/** A name that can be saved: at least one letter or digit. */
export function validName(name: string): boolean {
  return /[A-Za-z0-9]/.test(String(name ?? ""));
}

/**
 * Names an expression already uses: the scope helpers (`sum`, `get`, …), the
 * JS keywords, and the tile's own `active`. A variable of that name would
 * shadow or crash the expression, so the form refuses it.
 */
export function reservedName(name: string): boolean {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  return key === "active" || newLocalTaken().has(key);
}

/** Reference names are unique (case-insensitive) — the name *is* the handle. */
export function nameTaken(
  variables: GlobalVariable[],
  name: string,
  exceptId?: string,
): boolean {
  const key = String(name ?? "")
    .trim()
    .toLowerCase();
  if (!key) return false;
  return variables.some(
    (v) =>
      v.id !== exceptId &&
      String(v.name ?? "")
        .trim()
        .toLowerCase() === key,
  );
}

/** What a reference points at, once resolved. */
export interface VariableTarget {
  kind: "constant" | "state";
  /** state kind: the real ioBroker id. */
  stateId?: string;
  /** constant: the typed value. */
  value?: unknown;
}

/**
 * What a stored reference means. A dotted string is a state id (never a
 * variable); a bare name is looked up in the list. Unknown names, a state
 * variable without a state and a malformed constant resolve to `null`.
 */
export function resolveVariable(
  ref: string,
  variables: GlobalVariable[],
): VariableTarget | null {
  const name = String(ref ?? "").trim();
  if (!name || name.includes(".")) return null;
  const v = variables.find((x) => x.name === name);
  if (!v) return null;
  if (v.kind === "state")
    return v.stateId ? { kind: "state", stateId: v.stateId } : null;
  const parsed = convertValue(v.value ?? "", v.type);
  return parsed.error ? null : { kind: "constant", value: parsed.value };
}

/**
 * The locals a variable list contributes to an expression: constants as their
 * fixed value, state variables as the live value of the state behind them.
 */
export function variableLocals(
  variables: GlobalVariable[],
  stateValue: (stateId: string) => unknown,
): { key: string; value: unknown }[] {
  const out: { key: string; value: unknown }[] = [];
  for (const v of variables ?? []) {
    if (!v.name) continue;
    if (v.kind === "constant") {
      const parsed = convertValue(v.value ?? "", v.type);
      out.push({ key: v.name, value: parsed.error ? undefined : parsed.value });
    } else if (v.stateId) {
      out.push({ key: v.name, value: stateValue(v.stateId) });
    }
  }
  return out;
}

/** Extras an expression scope needs to know about the variables. */
export interface VariableScope {
  /** The names, with their current values. */
  locals: { key: string; value: unknown }[];
  /** A variable name as the state id behind it (for `get("name")`). */
  resolveId: (ref: string) => string | undefined;
}

/** Build the scope extras once, for both the rule engine and the formulas. */
export function variableScope(
  variables: GlobalVariable[],
  stateValue: (stateId: string) => unknown,
): VariableScope {
  return {
    locals: variableLocals(variables, stateValue),
    resolveId: (ref: string) => {
      const target = resolveVariable(ref, variables);
      return target?.kind === "state" ? target.stateId : undefined;
    },
  };
}

/**
 * The id the broker side works with for a stored reference: a variable name
 * gives the state behind it, everything else (an id, a feature name, a
 * constant) passes through unchanged.
 */
export function stateIdFor(ref: string, variables: GlobalVariable[]): string {
  const target = resolveVariable(ref, variables);
  return target?.kind === "state" && target.stateId ? target.stateId : ref;
}

/**
 * The relative id a new state gets. iHome instances are pinned to their
 * `Variables` folder: everything else under `ihome.*` (the config documents,
 * …) belongs to the adapter and must never be overwritten from this form.
 */
export function relativeIdFor(namespace: string, typed: string): string {
  const rel = String(typed ?? "")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  if (!isIhomeNamespace(namespace)) return rel;
  if (rel.startsWith("Variables.")) return rel;
  return rel ? `Variables.${rel}` : "";
}

/** The adapter instances that can host a new state, with the two obvious ones. */
export function namespaceOptions(
  objects: Map<string, unknown>,
  current: string,
): string[] {
  const set = new Set<string>();
  if (current) set.add(current);
  set.add("0_userdata.0");
  for (const id of objects.keys()) {
    const m = /^system\.adapter\.([^.]+)\.(\d+)$/.exec(id);
    if (m) set.add(`${m[1]}.${m[2]}`);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** A constant's text value as the type it claims to be; never throws. */
export function convertValue(
  raw: string,
  type: string,
): { value?: unknown; error?: string } {
  const text = String(raw ?? "").trim();
  if (type === "number") {
    if (!text) return { error: "Enter a number." };
    const value = Number(text);
    return Number.isFinite(value) ? { value } : { error: "Enter a number." };
  }
  if (type === "boolean") {
    const s = text.toLowerCase();
    if (["true", "1", "on", "yes"].includes(s)) return { value: true };
    if (["false", "0", "off", "no"].includes(s)) return { value: false };
    return { error: "Enter true or false." };
  }
  return { value: String(raw ?? "") };
}

/** The value a newly created state starts with. */
export function initialValue(type: string): unknown {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}

/** The constants as iHome-internal values: they exist only while the config is
 *  loaded — no broker state, no subscription, nothing to update. Recreated from
 *  the list on every load (by the SPA here, by the adapter in `main.js`). */
export interface InternalValue {
  /** The variable's id: stable across renames. */
  id: string;
  /** The name, which is also the reference (`Object.name` stands in). */
  name: string;
  /** The reference an expression/local can use. */
  key: string;
  value: unknown;
  type: string;
  unit?: string;
}

/** Split a list into its in-memory constants: values now, states only named. */
export function constantValues(variables: GlobalVariable[]): InternalValue[] {
  const out: InternalValue[] = [];
  for (const v of variables) {
    if (v.kind !== "constant") continue;
    const parsed = convertValue(v.value ?? "", v.type);
    out.push({
      id: v.id,
      name: v.name,
      key: v.name,
      value: parsed.error ? undefined : parsed.value,
      type: v.type,
      unit: v.unit,
    });
  }
  return out;
}

/** Normalise arbitrary persisted data into a VariableLibrary; never throws. */
export function migrateVariables(raw: unknown): VariableLibrary {
  let val: any = raw;
  if (val && typeof val === "object" && "val" in val) val = (val as any).val;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      val = null;
    }
  }
  const variables: GlobalVariable[] = Array.isArray(val?.variables)
    ? val.variables
        .filter((v: any) => v && typeof v.id === "string")
        .map((v: any): GlobalVariable => {
          const kind = v.kind === "state" ? "state" : "constant";
          const enums = Array.isArray(v.enums)
            ? v.enums.filter((e: any) => typeof e === "string" && e)
            : undefined;
          return {
            id: v.id,
            // Names are the reference: an older list gets its dots/spaces
            // cleaned up here, once, on load — and trimmed, which the live
            // form must not do (a trailing space would eat the next word).
            name: restrictName(String(v.name ?? v.id)).replace(/^_+|_+$/g, ""),
            kind,
            type: String(v.type ?? (kind === "state" ? "mixed" : "string")),
            value: kind === "constant" ? String(v.value ?? "") : undefined,
            stateId:
              kind === "state" && typeof v.stateId === "string"
                ? v.stateId
                : undefined,
            unit: v.unit ? String(v.unit) : undefined,
            notes: v.notes ? String(v.notes) : undefined,
            role: v.role ? String(v.role) : undefined,
            enums: enums?.length ? enums : undefined,
            min: Number.isFinite(v.min) ? Number(v.min) : undefined,
            max: Number.isFinite(v.max) ? Number(v.max) : undefined,
            step: Number.isFinite(v.step) ? Number(v.step) : undefined,
          };
        })
    : [];
  return {
    version: val?.version ?? 0,
    updatedAt: val?.updatedAt ?? Date.now(),
    variables,
  };
}
