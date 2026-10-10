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
  return Number(v.toFixed(precision));
}
