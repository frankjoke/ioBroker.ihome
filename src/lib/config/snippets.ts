import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import { BUILTIN_FUNCTIONS } from "./function-presets";

export type SnippetMode = "expression" | "statements" | "both";

/** Built-ins first, then user snippets, filtered by the field's mode. */
export function snippetChoices(
  user: FunctionTemplate[],
  mode: SnippetMode,
): FunctionTemplate[] {
  const all = [...BUILTIN_FUNCTIONS, ...user];
  return mode === "both" ? all : all.filter((entry) => entry.mode === mode);
}

/** Snippets plus the saved formula code templates, which are expressions. */
export function codeTemplateChoices(
  functions: FunctionTemplate[],
  formulas: FormulaTemplate[],
  mode: SnippetMode,
): FunctionTemplate[] {
  const snippets = snippetChoices(functions, mode);
  if (mode === "statements") return snippets;
  const templates: FunctionTemplate[] = formulas
    .filter((formula) => String(formula.expr ?? "").trim())
    .map((formula) => ({
      id: `formula:${formula.id}`,
      name: `ƒ ${formula.name}`,
      description: formula.notes,
      mode: "expression" as const,
      code: formula.expr,
    }));
  return [...snippets, ...templates];
}
