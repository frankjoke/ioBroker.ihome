import type {
  Control,
  FormulaLibrary,
  FormulaTemplate,
} from "$lib/types/device";

const DEW_POINT =
  "(237.7 * (Math.log(humidity / 100) + (17.27 * temperature) / (237.7 + temperature))) / (17.27 - (Math.log(humidity / 100) + (17.27 * temperature) / (237.7 + temperature)))";

export const SEED_TEMPLATES: FormulaTemplate[] = [
  {
    id: "seed-dew-point",
    name: "Dew point",
    expr: DEW_POINT,
    precision: 1,
    unit: "°C",
    notes: "Magnus formula; needs locals temperature (°C) and humidity (%).",
  },
  {
    id: "seed-low-battery",
    name: "Count low battery",
    expr: 'count({ role: "value.battery" }, v => v < 20)',
    notes: "Number of battery states below 20%.",
  },
  {
    id: "seed-any-motion",
    name: "Any motion active",
    expr: 'any({ role: "sensor.motion" })',
  },
  {
    id: "seed-sum-power",
    name: "Sum of active power",
    expr: 'sum({ feature: "power" })',
    unit: "W",
  },
  {
    id: "seed-avg-temp",
    name: "Average temperature",
    expr: 'avg({ role: "value.temperature" })',
    unit: "°C",
    precision: 1,
  },
];

export function seedLibrary(): FormulaLibrary {
  return {
    version: 0,
    updatedAt: Date.now(),
    formulas: SEED_TEMPLATES.map((t) => ({ ...t })),
  };
}

/** Copy a template's expression + display fields onto a control. */
export function applyTemplate(
  control: Control,
  template: FormulaTemplate,
): Control {
  return {
    ...control,
    unit: template.unit,
    formulaId: template.id,
    virtual: {
      ...control.virtual,
      expr: template.expr,
      precision: template.precision,
    },
  };
}

/** Drop formulaId when the template is gone or the expression no longer matches. */
export function syncFormulaId(
  control: Control,
  library: FormulaLibrary,
): Control {
  const id = control.formulaId;
  if (!id) return control;
  const tpl = library.formulas.find((t) => t.id === id);
  if (tpl && tpl.expr === control.virtual?.expr) return control;
  const next = { ...control };
  delete next.formulaId;
  return next;
}

/** Normalise arbitrary persisted data into a FormulaLibrary; never throws. */
export function migrateLibrary(raw: unknown): FormulaLibrary {
  let val: any = raw;
  if (val && typeof val === "object" && "val" in val) val = (val as any).val;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      val = null;
    }
  }
  const formulas: FormulaTemplate[] = Array.isArray(val?.formulas)
    ? val.formulas
        .filter(
          (t: any) =>
            t && typeof t.id === "string" && typeof t.expr === "string",
        )
        .map((t: any) => ({
          id: t.id,
          name: String(t.name ?? t.id),
          expr: t.expr,
          precision: t.precision,
          unit: t.unit,
          notes: t.notes,
        }))
    : [];
  return {
    version: val?.version ?? 0,
    updatedAt: val?.updatedAt ?? Date.now(),
    formulas,
  };
}
