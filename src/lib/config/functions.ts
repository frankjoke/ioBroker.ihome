import { checkExpression, checkStatement } from "$logic/expr-code";
import type { FunctionLibrary, FunctionTemplate } from "$lib/types/device";

/** Normalise arbitrary persisted data into a FunctionLibrary; never throws. */
export function migrateFunctionLibrary(raw: unknown): FunctionLibrary {
  let val: any = raw;
  if (val && typeof val === "object" && "val" in val) val = val.val;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      val = null;
    }
  }
  const functions: FunctionTemplate[] = Array.isArray(val?.functions)
    ? val.functions
        .filter(
          (t: any) =>
            t && typeof t.id === "string" && typeof t.code === "string",
        )
        .map((t: any) => ({
          id: t.id,
          name: String(t.name ?? t.id),
          description:
            typeof t.description === "string" ? t.description : undefined,
          mode: t.mode === "statements" ? "statements" : "expression",
          code: t.code,
        }))
    : [];
  return {
    version: val?.version ?? 0,
    updatedAt: val?.updatedAt ?? Date.now(),
    functions,
  };
}

/** The first problem with a function template, or null. */
export function functionTemplateProblem(
  value: FunctionTemplate,
): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "A function template must be an object.";
  }
  const template = value as Partial<FunctionTemplate>;
  if (typeof template.id !== "string" || !template.id.trim()) {
    return "A snippet needs a non-empty id.";
  }
  if (typeof template.name !== "string" || !template.name.trim()) {
    return "A name is required.";
  }
  if (template.mode !== "expression" && template.mode !== "statements") {
    return "mode must be expression or statements.";
  }
  if (typeof template.code !== "string" || !template.code.trim()) {
    return "The code is empty.";
  }
  return template.mode === "statements"
    ? checkStatement(template.code)
    : checkExpression(template.code);
}
