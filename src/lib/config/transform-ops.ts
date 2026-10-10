import type { Transform, TransformStep } from "$lib/types/device";

export interface StepResult {
  value: unknown;
  error?: string;
}

/** Evaluate a formula expression with `x` bound to the value. Throws on error. */
export function evaluateFormula(expr: string, x: unknown): unknown {
  // eslint-disable-next-line no-new-func
  return new Function("x", "return (" + expr + ");")(x);
}

/** Minimal JSON path: dot segments with optional trailing [n] indices. */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: any = obj;
  for (const rawSeg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(rawSeg);
    if (!m) return undefined;
    const key = m[1];
    const idxPart = m[2];
    if (key) {
      if (typeof cur !== "object" || !(key in cur)) return undefined;
      cur = cur[key];
    }
    const idxRe = /\[(\d+)\]/g;
    let im: RegExpExecArray | null;
    while ((im = idxRe.exec(idxPart))) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(im[1])];
    }
  }
  return cur;
}

function runScale(
  step: Extract<TransformStep, { kind: "scale" }>,
  v: unknown,
): unknown {
  const num = Number(v);
  if (Number.isNaN(num)) return v;
  const clamped =
    step.clamp !== false
      ? Math.max(step.inMin, Math.min(step.inMax, num))
      : num;
  let out: number;
  if (step.inMax === step.inMin) {
    out = step.outMin;
  } else {
    out =
      step.outMin +
      ((clamped - step.inMin) * (step.outMax - step.outMin)) /
        (step.inMax - step.inMin);
  }
  if (typeof step.round === "number" && step.round >= 0 && step.round <= 100) {
    out = Number(out.toFixed(step.round));
  }
  return out;
}

/** Run a single transform step; never throws — failures return the raw value. */
export function runStep(
  step: TransformStep | undefined,
  v: unknown,
): StepResult {
  if (!step) return { value: v };
  try {
    switch (step.kind) {
      case "scale":
        return { value: runScale(step, v) };
      case "map": {
        const key = String(v);
        const map = step.map ?? {};
        return {
          value: Object.prototype.hasOwnProperty.call(map, key) ? map[key] : v,
        };
      }
      case "formula":
        return { value: evaluateFormula(step.expr, v) };
      case "jsonpath": {
        const r = resolveJsonPath(v, step.path);
        return { value: r === undefined ? v : r };
      }
      default:
        return { value: v };
    }
  } catch (e) {
    return { value: v, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Alias used by the TransformEditor for live previews. */
export const previewTransform = runStep;

/** Convert a legacy `{type:"scale"|"map"}` transform to the new step shape. */
export function migrateTransform(old: unknown): Transform | undefined {
  if (!old || typeof old !== "object") return undefined;
  const o = old as any;
  if (o.type === "scale") {
    const step: TransformStep = {
      kind: "scale",
      inMin: o.inMin,
      inMax: o.inMax,
      outMin: o.outMin,
      outMax: o.outMax,
      clamp: o.clamp,
      round: o.round,
    };
    return { read: step, write: { ...step } };
  }
  if (o.type === "map") {
    return {
      read: { kind: "map", map: o.read ?? {} },
      write: { kind: "map", map: o.write ?? {} },
    };
  }
  if (o.read || o.write) return o as Transform;
  return undefined;
}

/** Migrate every control transform in a raw registry object. */
export function migrateRegistry(raw: any): any {
  if (!raw || !Array.isArray(raw.devices)) return raw;
  return {
    ...raw,
    devices: raw.devices.map((d: any) => ({
      ...d,
      controls: Array.isArray(d.controls)
        ? d.controls.map((c: any) => ({
            ...c,
            // Legacy boolean unit was on-first ("ON/OFF"); the boolean formatter
            // reads false-first, so normalise or existing controls read inverted.
            unit: c.unit === "ON/OFF" ? "OFF/ON" : c.unit,
            transform: migrateTransform(c.transform),
          }))
        : d.controls,
    })),
  };
}
