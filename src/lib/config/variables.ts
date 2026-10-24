import { newLocalTaken, sanitizeLabel } from "$lib/config/virtual-ops";

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
  name: string;
  /** The reference an expression/local can use (identifier-safe, unique). */
  key: string;
  value: unknown;
  type: string;
  unit?: string;
}

/** Split a list into its in-memory constants: values now, states only named. */
export function constantValues(variables: GlobalVariable[]): InternalValue[] {
  const taken = newLocalTaken();
  const out: InternalValue[] = [];
  for (const v of variables) {
    if (v.kind !== "constant") continue;
    const parsed = convertValue(v.value ?? "", v.type);
    out.push({
      id: v.id,
      name: v.name,
      key: sanitizeLabel(v.name, taken),
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
          return {
            id: v.id,
            name: String(v.name ?? v.id),
            kind,
            type: String(v.type ?? (kind === "state" ? "mixed" : "string")),
            value: kind === "constant" ? String(v.value ?? "") : undefined,
            stateId:
              kind === "state" && typeof v.stateId === "string"
                ? v.stateId
                : undefined,
            unit: v.unit ? String(v.unit) : undefined,
            notes: v.notes ? String(v.notes) : undefined,
          };
        })
    : [];
  return {
    version: val?.version ?? 0,
    updatedAt: val?.updatedAt ?? Date.now(),
    variables,
  };
}
