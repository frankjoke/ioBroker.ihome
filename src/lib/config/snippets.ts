import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import { BUILTIN_FUNCTIONS } from "./function-presets";
import type { Sourced } from "./plugin-contributions";

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
  pluginFunctions: Sourced<FunctionTemplate>[] = [],
  pluginFormulas: Sourced<FormulaTemplate>[] = [],
): FunctionTemplate[] {
  const snippets = snippetChoices(functions, mode);
  const pluginSnippets = pluginFunctions
    .map((source) => ({
      ...source.value,
      id: source.key,
      name: `${source.value.name} — ${source.plugin.name}`,
    }))
    .filter((entry) => mode === "both" || entry.mode === mode);
  if (mode === "statements") return [...snippets, ...pluginSnippets];
  const templates: FunctionTemplate[] = formulas
    .filter((formula) => String(formula.expr ?? "").trim())
    .map((formula) => ({
      id: `formula:${formula.id}`,
      name: `ƒ ${formula.name}`,
      description: formula.notes,
      mode: "expression" as const,
      code: formula.expr,
    }));
  const pluginTemplates: FunctionTemplate[] = pluginFormulas
    .filter((source) => String(source.value.expr ?? "").trim())
    .map((source) => ({
      id: source.key,
      name: `ƒ ${source.value.name} — ${source.plugin.name}`,
      description: source.value.notes,
      mode: "expression" as const,
      code: source.value.expr,
    }));
  return [...snippets, ...pluginSnippets, ...templates, ...pluginTemplates];
}
