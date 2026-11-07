import { expressionSyntaxProblem } from "$lib/config/code-syntax";
import { evaluateDeviceTemplate } from "$lib/config/device-templates";
import { logicTemplateProblem } from "$lib/config/logic-templates";
import { visualTemplateProblem } from "$lib/config/visual-templates";
import { validateDeviceTemplate } from "$logic/device-templates";
import type {
  DeviceItem,
  DeviceParam,
  DeviceTemplateShape,
  LogicTemplate,
  TemplateParam,
} from "$logic/types";
import type { Template } from "$lib/types/display";
import type {
  TemplateBundle,
  TemplateBundleLibrary,
  TemplateDevicePart,
  TemplateItem,
  TemplateLogicPart,
} from "$lib/types/templates";

const PARAM_TYPES = new Set([
  "string",
  "state",
  "memory",
  "number",
  "boolean",
  "duration",
]);
const LOGIC_PARAM_TYPES = new Set([
  "state",
  "memory",
  "number",
  "boolean",
  "duration",
]);
const ITEM_TYPES = new Set(["boolean", "number", "string", "object"]);

/** Normalise arbitrary persisted data into a TemplateBundleLibrary; never throws. */
export function migrateTemplateBundleLibrary(
  raw: unknown,
): TemplateBundleLibrary {
  let val: any = raw;
  if (val && typeof val === "object" && "val" in val) val = val.val;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      val = null;
    }
  }
  const bundles: TemplateBundle[] = Array.isArray(val?.bundles)
    ? val.bundles
        .filter(
          (entry: any) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.name === "string",
        )
        .map((entry: any) => ({
          id: entry.id,
          name: entry.name,
          description:
            typeof entry.description === "string"
              ? entry.description
              : undefined,
          params: Array.isArray(entry.params) ? entry.params : undefined,
          items: Array.isArray(entry.items) ? entry.items : undefined,
          device:
            entry.device && typeof entry.device === "object"
              ? entry.device
              : undefined,
          logic:
            entry.logic && typeof entry.logic === "object"
              ? entry.logic
              : undefined,
          api:
            entry.api && typeof entry.api === "object" ? entry.api : undefined,
        }))
    : [];
  return {
    version: typeof val?.version === "number" ? val.version : 0,
    updatedAt: typeof val?.updatedAt === "number" ? val.updatedAt : Date.now(),
    bundles,
  };
}

function compileFunction(code: string): (...args: unknown[]) => unknown {
  const value = new Function(`return (${code});`)();
  if (typeof value !== "function") {
    throw new Error("conversion must be a function expression");
  }
  return value as (...args: unknown[]) => unknown;
}

/** Compile the shared item conversion strings into the functions the API apply expects. */
export function compileTemplateItems(items: TemplateItem[] = []): DeviceItem[] {
  return items.map((item) => {
    const { conversion, setConversion, ...rest } = item;
    const next: DeviceItem = { ...rest };
    if (conversion !== undefined) {
      next.conversion = compileFunction(
        conversion,
      ) as unknown as DeviceItem["conversion"];
    }
    if (setConversion !== undefined) {
      next.setConversion = compileFunction(
        setConversion,
      ) as unknown as DeviceItem["setConversion"];
    }
    return next;
  });
}

/** Evaluate the API source and inject the shared items and params. */
export function evaluateBundleApi(bundle: TemplateBundle): DeviceTemplateShape {
  const base = bundle.api?.source
    ? evaluateDeviceTemplate(bundle.api.source)
    : {};
  if (!base || typeof base !== "object" || Array.isArray(base)) {
    throw new Error("API source must evaluate to an object");
  }
  const params = (bundle.params ?? []).filter(
    (param) => param.type !== "memory",
  ) as unknown as DeviceParam[];
  return {
    ...(base as DeviceTemplateShape),
    itemList: compileTemplateItems(bundle.items ?? []),
    params,
  };
}

/** The first problem with a bundle, or null. */
export function templateBundleProblem(
  value: unknown,
  takenIds: Iterable<string> = [],
  logicIds: Iterable<string> = [],
  currentId?: string,
  options: { validateApi?: boolean; evaluateConversions?: boolean } = {},
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "A template bundle must be an object.";
  }
  const bundle = value as Partial<TemplateBundle>;
  if (typeof bundle.id !== "string" || !bundle.id.trim()) {
    return "A template bundle needs a non-empty id.";
  }
  const taken = new Set(takenIds);
  if (bundle.id !== currentId && taken.has(bundle.id)) {
    return `Template id ${bundle.id} is already used.`;
  }
  if (typeof bundle.name !== "string" || !bundle.name.trim()) {
    return "A template bundle needs a name.";
  }
  if (!bundle.device && !bundle.logic && !bundle.api) {
    return "A template bundle needs at least one part (device, logic or API).";
  }
  if (bundle.params !== undefined) {
    if (!Array.isArray(bundle.params)) return "params must be an array.";
    const names = new Set<string>();
    for (const param of bundle.params) {
      if (!param || typeof param.name !== "string" || !param.name) {
        return "Each parameter needs a name.";
      }
      if (names.has(param.name)) return `Duplicate parameter: ${param.name}.`;
      names.add(param.name);
      if (typeof param.label !== "string" || !param.label) {
        return `Parameter ${param.name} needs a label.`;
      }
      if (!PARAM_TYPES.has(param.type)) {
        return `Parameter ${param.name} has an unknown type.`;
      }
    }
  }
  if (bundle.items !== undefined) {
    if (!Array.isArray(bundle.items)) return "items must be an array.";
    const names = new Set<string>();
    for (const item of bundle.items) {
      if (!item || typeof item.name !== "string" || !item.name) {
        return "Each item needs a name.";
      }
      if (names.has(item.name)) return `Duplicate item: ${item.name}.`;
      names.add(item.name);
      if (!ITEM_TYPES.has(item.type)) {
        return `Item ${item.name} has an unknown type.`;
      }
      for (const field of ["conversion", "setConversion"] as const) {
        const code = item[field];
        if (code === undefined) continue;
        if (typeof code !== "string") {
          return `Item ${item.name}: ${field} must be a code string.`;
        }
        let problem: string | null = null;
        if (options.evaluateConversions === false) {
          problem = expressionSyntaxProblem(code);
        } else {
          try {
            compileFunction(code);
          } catch (e) {
            problem = e instanceof Error ? e.message : String(e);
          }
        }
        if (problem) {
          return `Item ${item.name}: ${field} does not compile: ${problem}`;
        }
      }
    }
  }
  if (bundle.device) {
    const problem = visualTemplateProblem(
      { ...bundle.device, id: bundle.id, name: bundle.name },
      [],
      bundle.id,
    );
    if (problem) return problem;
  }
  if (bundle.logic) {
    if (!bundle.logic.logic || typeof bundle.logic.logic !== "object") {
      return "logic must be an object.";
    }
    const logicParams = (bundle.params ?? []).filter((param) =>
      LOGIC_PARAM_TYPES.has(param.type),
    ) as unknown as TemplateParam[];
    const problem = logicTemplateProblem(
      {
        id: bundle.id,
        name: bundle.name,
        params: logicParams,
        logic: bundle.logic.logic,
      },
      [],
      logicIds,
      bundle.id,
    );
    if (problem) return problem;
  }
  if (bundle.api) {
    if (typeof bundle.api.source !== "string" || !bundle.api.source.trim()) {
      return "The API source is empty.";
    }
    if (options.validateApi === false) {
      const problem = expressionSyntaxProblem(bundle.api.source);
      if (problem) return `API source does not compile: ${problem}`;
    } else {
      try {
        const checked = validateDeviceTemplate(
          evaluateBundleApi(bundle as TemplateBundle),
        );
        if (checked.errors.length > 0) return checked.errors[0];
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }
  }
  return null;
}

/** Copy a visual template into a bundle's device part (drop its identity). */
export function devicePartFromTemplate(template: Template): TemplateDevicePart {
  const part: TemplateDevicePart = {
    type: template.type,
    features: structuredClone(template.features),
    slots: structuredClone(template.slots),
  };
  if (template.size) part.size = template.size;
  if (template.background) part.background = template.background;
  return part;
}

/** Copy a logic template into a bundle's logic part (drop its identity). */
export function logicPartFromTemplate(
  template: LogicTemplate,
): TemplateLogicPart {
  return { logic: structuredClone(template.logic) };
}
