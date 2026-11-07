import type { FunctionTemplate } from "$lib/types/device";
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
