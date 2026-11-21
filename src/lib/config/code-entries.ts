import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import type { PluginRef, Sourced } from "./plugin-contributions";

export interface CodeEntry {
  kind: "formula" | "function";
  id: string;
  name: string;
  /** The human text: formula notes or function description; empty when none. */
  description: string;
  preview: string;
  builtin: boolean;
  search: string;
  key?: string;
  plugin?: PluginRef;
}

function entry(
  kind: CodeEntry["kind"],
  id: string,
  name: string,
  description: string,
  preview: string,
  builtin: boolean,
): CodeEntry {
  return {
    kind,
    id,
    name,
    description,
    preview,
    builtin,
    search: `${name} ${description} ${preview}`.toLowerCase(),
  };
}

function sourcedEntry<T extends { id: string; name: string }>(
  kind: CodeEntry["kind"],
  source: Sourced<T>,
  description: string,
  preview: string,
): CodeEntry {
  const base = entry(
    kind,
    source.value.id,
    source.value.name,
    description,
    preview,
    false,
  );
  return {
    ...base,
    search: `${base.search} ${source.plugin.name.toLowerCase()}`,
    key: source.key,
    plugin: source.plugin,
  };
}

export function codeEntries(
  formulas: FormulaTemplate[],
  userFunctions: FunctionTemplate[],
  builtinFunctions: FunctionTemplate[],
  pluginFormulas: Sourced<FormulaTemplate>[] = [],
  pluginFunctions: Sourced<FunctionTemplate>[] = [],
): CodeEntry[] {
  return [
    ...formulas.map((template) =>
      entry(
        "formula",
        template.id,
        template.name,
        template.notes ?? "",
        template.expr,
        false,
      ),
    ),
    ...userFunctions.map((template) =>
      entry(
        "function",
        template.id,
        template.name,
        template.description ?? "",
        template.code,
        false,
      ),
    ),
    ...builtinFunctions.map((template) =>
      entry(
        "function",
        template.id,
        template.name,
        template.description ?? "",
        template.code,
        true,
      ),
    ),
    ...pluginFormulas.map((source) =>
      sourcedEntry(
        "formula",
        source,
        source.value.notes ?? "",
        source.value.expr,
      ),
    ),
    ...pluginFunctions.map((source) =>
      sourcedEntry(
        "function",
        source,
        source.value.description ?? "",
        source.value.code,
      ),
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
