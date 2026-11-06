import { instantiateTemplate } from "$logic/templates";
import { validateLogicDocument } from "$logic/validate";
import type { LogicTemplate, TemplateParam } from "$logic/types";

const PARAM_TYPES = new Set([
  "state",
  "memory",
  "number",
  "boolean",
  "duration",
]);

function placeholder(param: TemplateParam): string | number | boolean {
  if (param.default !== undefined) return param.default;
  if (param.type === "state") return "__template_state__";
  if (param.type === "memory") return "__template_memory__";
  if (param.type === "number") return 0;
  if (param.type === "boolean") return false;
  return "30s";
}

/** A strict check for a user logic template; returns the first problem. */
export function logicTemplateProblem(
  value: unknown,
  takenIds: Iterable<string>,
  logicIds: Iterable<string> = [],
  currentId?: string,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "A logic template must be an object.";
  }
  const template = value as Partial<LogicTemplate>;
  if (typeof template.id !== "string" || !template.id.trim()) {
    return "A logic template needs a non-empty id.";
  }
  const taken = new Set(takenIds);
  if (template.id !== currentId && taken.has(template.id)) {
    return `Template id ${template.id} is already used.`;
  }
  if (typeof template.name !== "string" || !template.name.trim()) {
    return "A logic template needs a name.";
  }
  if (
    template.description !== undefined &&
    typeof template.description !== "string"
  ) {
    return "description must be a string.";
  }
  if (!Array.isArray(template.params)) {
    return "params must be an array.";
  }
  if (!template.logic || typeof template.logic !== "object") {
    return "logic must be an object.";
  }
  const names = new Set<string>();
  for (const param of template.params) {
    if (
      !param ||
      typeof param.name !== "string" ||
      !param.name ||
      typeof param.label !== "string" ||
      typeof param.type !== "string" ||
      !PARAM_TYPES.has(param.type)
    ) {
      return "Each parameter needs a name, label and known type.";
    }
    if (names.has(param.name)) {
      return `Duplicate parameter: ${param.name}.`;
    }
    names.add(param.name);
  }

  const values: Record<string, string | number | boolean> = {};
  for (const param of template.params) values[param.name] = placeholder(param);
  let logic;
  try {
    logic = instantiateTemplate(template as LogicTemplate, values, template.id);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }

  const refs = new Set<string>(logicIds);
  for (const match of JSON.stringify(template.logic).matchAll(
    /\$logic\.([A-Za-z0-9_-]+)/g,
  )) {
    refs.add(match[1]);
  }
  const stubs = [...refs]
    .filter((id) => id !== logic.id)
    .map((id) => ({
      id,
      name: id,
      kind: "function" as const,
      expr: { code: "0" },
    }));
  const issues = validateLogicDocument({
    version: 3,
    logics: [logic, ...stubs],
  }).filter((issue) => issue.severity === "error");
  if (issues.length > 0) return `${issues[0].path}: ${issues[0].message}`;
  return null;
}
