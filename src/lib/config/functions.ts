import { checkExpression, checkStatement } from "$logic/expr-code";
import type {
  FunctionLibrary,
  FunctionTemplate,
} from "$lib/types/device";

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
  template: FunctionTemplate,
): string | null {
  if (!template.name.trim()) return "A name is required.";
  if (!template.code.trim()) return "The code is empty.";
  return template.mode === "statements"
    ? checkStatement(template.code)
    : checkExpression(template.code);
}
