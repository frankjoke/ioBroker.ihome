import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";

export interface CodeEntry {
  kind: "formula" | "function";
  id: string;
  name: string;
  preview: string;
  builtin: boolean;
  search: string;
}

function entry(
  kind: CodeEntry["kind"],
  id: string,
  name: string,
  preview: string,
  builtin: boolean,
): CodeEntry {
  return {
    kind,
    id,
    name,
    preview,
    builtin,
    search: `${name} ${preview}`.toLowerCase(),
  };
}

export function codeEntries(
  formulas: FormulaTemplate[],
  userFunctions: FunctionTemplate[],
  builtinFunctions: FunctionTemplate[],
): CodeEntry[] {
  return [
    ...formulas.map((template) =>
      entry("formula", template.id, template.name, template.expr, false),
    ),
    ...userFunctions.map((template) =>
      entry("function", template.id, template.name, template.code, false),
    ),
    ...builtinFunctions.map((template) =>
      entry("function", template.id, template.name, template.code, true),
    ),
  ];
}

export function filterCodeEntries(
  entries: CodeEntry[],
  query: string,
  dir: "asc" | "desc",
): CodeEntry[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? entries.filter((entry) => entry.search.includes(q))
    : [...entries];
  const direction = dir === "asc" ? 1 : -1;
  return list.sort((a, b) => direction * a.name.localeCompare(b.name));
}
