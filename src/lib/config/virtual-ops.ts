import type { VirtualSpec } from "$lib/types/device";

export interface PoolEntry {
  stateId: string;
  value: unknown;
  role?: string;
  room?: string;
  device?: string;
  feature?: string;
  label?: string;
}

export interface Scope {
  locals: Record<string, unknown>;
  helpers: Record<string, (...args: any[]) => unknown>;
}

export interface VirtualResult {
  value: unknown;
  error?: string;
}

/** Names injected as helper globals; locals must never shadow these. */
const HELPER_NAMES = [
  "values",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "any",
  "all",
  "get",
  "device",
];

/** Words that cannot be a function parameter name (incl. strict-mode extras). */
const RESERVED_LOCAL_NAMES = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "await",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "eval",
  "arguments",
]);

/** A fresh `taken` set seeded so locals never shadow a helper or a keyword. */
export function newLocalTaken(): Set<string> {
  return new Set<string>([...HELPER_NAMES, ...RESERVED_LOCAL_NAMES]);
}

/** Turn a human label into a JS identifier; collisions get an index suffix. */
export function sanitizeLabel(
  label: string | undefined,
  taken: Set<string>,
): string {
  let base = String(label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) base = "v";
  else if (/^[0-9]/.test(base)) base = "v_" + base;
  let name = base;
  let i = 2;
  while (taken.has(name)) name = base + i++;
  taken.add(name);
  return name;
}

/** Evaluate a virtual expression with the scope bound; never throws. */
export function evaluateVirtual(expr: string, scope: Scope): VirtualResult {
  if (!expr || !expr.trim()) {
    return { value: undefined, error: "empty expression" };
  }
  try {
    const localNames = Object.keys(scope.locals);
    const helperNames = Object.keys(scope.helpers);
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      ...localNames,
      ...helperNames,
      `"use strict"; return (${expr});`,
    );
    const value = fn(
      ...localNames.map((n) => scope.locals[n]),
      ...helperNames.map((n) => scope.helpers[n]),
    );
    return { value };
  } catch (e) {
    return {
      value: undefined,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Round a numeric result to `precision` decimals; pass other values through. */
export function roundValue(v: unknown, precision?: number): unknown {
  if (typeof v !== "number" || typeof precision !== "number") return v;
  const p = Math.trunc(precision);
  if (p < 0 || p > 100) return v;
  return Number(v.toFixed(p));
}

export interface LocalControl {
  kind?: "state" | "virtual";
  label?: string;
  feature?: string;
  liveValue?: unknown;
}

export interface Filter {
  role?: string;
  room?: string;
  device?: string;
  feature?: string;
  label?: string;
}

/** Match a pool entry against a filter: `role` is a substring, the rest exact. */
function matches(e: PoolEntry, f: Filter): boolean {
  return (
    (!f.role || String(e.role ?? "").includes(f.role)) &&
    (!f.room || e.room === f.room) &&
    (!f.device || e.device === f.device) &&
    (!f.feature || e.feature === f.feature) &&
    (!f.label || String(e.label ?? "").toLowerCase() === f.label.toLowerCase())
  );
}

/** Build the helper API over the device-state pool. */
function makeHelpers(
  pool: PoolEntry[],
  resolveId?: (ref: string) => string | undefined,
): Scope["helpers"] {
  // `get("…")` may name a variable: resolve it to the state behind it first.
  const resolve = (ref: string) => resolveId?.(ref) ?? ref;
  const values = (f: Filter = {}) =>
    pool.filter((e) => matches(e, f)).map((e) => e.value);
  const numbers = (f: Filter = {}) =>
    values(f)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
  return {
    values,
    count: (f: Filter = {}, pred?: (v: unknown) => boolean) => {
      const vs = values(f);
      return pred ? vs.filter(pred).length : vs.length;
    },
    sum: (f: Filter = {}) =>
      values(f).reduce((a: number, b: unknown) => a + (Number(b) || 0), 0),
    avg: (f: Filter = {}) => {
      const ns = numbers(f);
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : undefined;
    },
    min: (f: Filter = {}) => {
      const ns = numbers(f);
      return ns.length ? Math.min(...ns) : undefined;
    },
    max: (f: Filter = {}) => {
      const ns = numbers(f);
      return ns.length ? Math.max(...ns) : undefined;
    },
    any: (f: Filter = {}, pred?: (v: unknown) => boolean) =>
      values(f).some((v) => (pred ? pred(v) : !!v)),
    all: (f: Filter = {}, pred?: (v: unknown) => boolean) => {
      const vs = values(f);
      return vs.length ? vs.every((v) => (pred ? pred(v) : !!v)) : true;
    },
    get: (ref: string | { device?: string; label?: string }) => {
      if (typeof ref === "string") {
        return pool.find((e) => e.stateId === resolve(ref))?.value;
      }
      const hit = pool.find(
        (e) =>
          (!ref.device || e.device === ref.device) &&
          (!ref.label ||
            String(e.label ?? "").toLowerCase() === ref.label.toLowerCase()),
      );
      return hit?.value;
    },
    device: (name: string) => {
      const out: Record<string, unknown> = {};
      const taken = new Set<string>();
      for (const e of pool.filter((x) => x.device === name)) {
        out[sanitizeLabel(e.label || e.feature, taken)] = e.value;
      }
      return out;
    },
  };
}

/** Extras a scope carries beyond the device's own controls: the variables. */
export interface ScopeExtras {
  /** Variable names with their current values. */
  locals?: { key: string; value: unknown }[];
  /** A variable name as the state id behind it, for `get("…")`. */
  resolveId?: (ref: string) => string | undefined;
}

/** Locals from the device's state controls + helpers over the pool. */
export function buildScope(
  controls: LocalControl[],
  pool: PoolEntry[],
  extras: ScopeExtras = {},
): Scope {
  const taken = newLocalTaken();
  const locals: Record<string, unknown> = {};
  // Variables come first: the global name is the predictable one, so a
  // control whose label collides is the one that gets a suffix.
  for (const v of extras.locals ?? []) {
    locals[v.key] = v.value;
    taken.add(v.key);
  }
  for (const c of controls) {
    if (c.kind === "virtual") continue;
    locals[sanitizeLabel(c.label || c.feature, taken)] = c.liveValue;
  }
  return { locals, helpers: makeHelpers(pool, extras.resolveId) };
}

/** Compute a virtual control's value (rounding applied); never throws. */
export function computeVirtual(
  control: { virtual?: VirtualSpec },
  siblings: LocalControl[],
  pool: PoolEntry[],
  extras: ScopeExtras = {},
): VirtualResult {
  const { value, error } = evaluateVirtual(
    control.virtual?.expr ?? "",
    buildScope(siblings, pool, extras),
  );
  if (error) return { value: undefined, error };
  return { value: roundValue(value, control.virtual?.precision) };
}
