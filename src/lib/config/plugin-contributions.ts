import type { FormulaTemplate, FunctionTemplate } from "$lib/types/device";
import type { Template } from "$lib/types/display";
import type { TemplateBundle } from "$lib/types/templates";
import type { LogicTemplate } from "$logic/types";
import { logicTemplateProblem } from "./logic-templates";
import { templateBundleProblem } from "./template-bundles";
import { visualTemplateProblem } from "./visual-templates";

export interface PluginSnippet {
  id: string;
  name: string;
  description?: string;
  language?: "js" | "json" | "text";
  code: string;
}

export interface PluginRef {
  id: string;
  name: string;
  enabled: boolean;
}

export interface Sourced<T> {
  key: string;
  plugin: PluginRef;
  value: T;
}

export interface PluginContributionSet {
  tiles: Sourced<Template>[];
  bundles: Sourced<TemplateBundle>[];
  logic: Sourced<LogicTemplate>[];
  formulas: Sourced<FormulaTemplate>[];
  functions: Sourced<FunctionTemplate>[];
  snippets: Sourced<PluginSnippet>[];
  problems: string[];
}

export function emptyPluginContributions(): PluginContributionSet {
  return {
    tiles: [],
    bundles: [],
    logic: [],
    formulas: [],
    functions: [],
    snippets: [],
    problems: [],
  };
}

export function contributionKey(
  pluginId: string,
  kind: string,
  itemId: string,
): string {
  return `plugin:${pluginId}:${kind}:${itemId}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Give a plugin's tile the state ids its slots name, so applying it needs no
 *  pick. Only the plugin's own states and logic outputs are candidates. */
function tileWithOrigins(
  item: Record<string, unknown>,
  owned: unknown,
): Template {
  const byName = new Map<string, string | null>();
  if (record(owned)) {
    for (const kind of ["states", "logics"] as const) {
      const list = owned[kind];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!record(entry)) continue;
        const id = text(entry.id);
        const name = text(entry.name).toLowerCase();
        if (!id || !name) continue;
        const known = byName.get(name);
        byName.set(name, known === undefined || known === id ? id : null);
      }
    }
  }
  if (!byName.size || !Array.isArray(item.slots)) {
    return item as unknown as Template;
  }
  const slots = item.slots.map((slot) => {
    if (!record(slot)) return slot;
    const repair = record(slot.repair) ? slot.repair : undefined;
    const label = (text(slot.label) || text(repair?.label) || "").toLowerCase();
    const origin = label ? byName.get(label) : null;
    return origin ? { ...slot, origin } : slot;
  });
  return { ...item, slots } as Template;
}

function formulaProblem(value: unknown): string | null {
  if (!record(value)) return "a formula must be an object.";
  if (!text(value.id)) return "a formula needs an id.";
  if (!text(value.name)) return "a formula needs a name.";
  if (typeof value.expr !== "string" || !value.expr.trim()) {
    return "a formula needs an expression.";
  }
  return null;
}

function functionProblem(value: unknown): string | null {
  if (!record(value)) return "a function must be an object.";
  if (!text(value.id)) return "a function needs an id.";
  if (!text(value.name)) return "a function needs a name.";
  if (value.mode !== "expression" && value.mode !== "statements") {
    return "a function needs mode expression or statements.";
  }
  if (typeof value.code !== "string" || !value.code.trim()) {
    return "a function needs code.";
  }
  return null;
}

function snippetProblem(value: unknown): string | null {
  if (!record(value)) return "a snippet must be an object.";
  if (!text(value.id)) return "a snippet needs an id.";
  if (!text(value.name)) return "a snippet needs a name.";
  if (typeof value.code !== "string" || !value.code.trim()) {
    return "a snippet needs code.";
  }
  return null;
}

/**
 * Validate and source a `plugins contributions` reply. Invalid items are
 * hidden with a message; a malformed reply is empty, never an exception.
 */
export function readPluginContributions(reply: unknown): PluginContributionSet {
  const set = emptyPluginContributions();
  if (!record(reply)) {
    set.problems.push("The plugin contributions reply is not an object.");
    return set;
  }
  if (!Array.isArray(reply.plugins)) {
    set.problems.push("The plugin contributions reply has no plugins array.");
    return set;
  }

  for (const raw of reply.plugins) {
    if (!record(raw) || !text(raw.id)) {
      set.problems.push("A plugin contribution entry has no id.");
      continue;
    }
    const plugin: PluginRef = {
      id: text(raw.id),
      name: text(raw.name) || text(raw.id),
      enabled: raw.enabled === true,
    };
    if (typeof raw.problem === "string" && raw.problem.trim()) {
      set.problems.push(`${plugin.name}: ${raw.problem.trim()}`);
    }
    if (raw.contributions === undefined) continue;
    if (!record(raw.contributions)) {
      set.problems.push(`${plugin.name}: contributions is not an object.`);
      continue;
    }

    const source = <T>(kind: string, itemId: string, value: T): Sourced<T> => ({
      key: contributionKey(plugin.id, kind, itemId),
      plugin,
      value,
    });

    for (const [kind, items] of Object.entries(raw.contributions)) {
      if (!Array.isArray(items)) {
        set.problems.push(`${plugin.name}: ${kind} is not an array.`);
        continue;
      }
      for (const item of items) {
        if (!record(item) || !text(item.id)) {
          set.problems.push(`${plugin.name}: ${kind} has an item without id.`);
          continue;
        }
        const id = text(item.id);
        let problem: string | null = null;
        if (kind === "tiles") {
          problem = visualTemplateProblem(item, [], id);
        } else if (kind === "bundles") {
          problem = templateBundleProblem(
            item as unknown as TemplateBundle,
            [],
            [],
            id,
          );
        } else if (kind === "logic") {
          problem = logicTemplateProblem(item, [], [], id);
        } else if (kind === "formulas") {
          problem = formulaProblem(item);
        } else if (kind === "functions") {
          problem = functionProblem(item);
        } else if (kind === "snippets") {
          problem = snippetProblem(item);
        } else {
          problem = `unknown contribution kind ${kind}.`;
        }
        if (problem) {
          set.problems.push(`${plugin.name}: ${kind} ${id}: ${problem}`);
          continue;
        }
        if (kind === "tiles") {
          set.tiles.push(source("tiles", id, tileWithOrigins(item, raw.owned)));
        } else if (kind === "bundles") {
          set.bundles.push(
            source("bundles", id, item as unknown as TemplateBundle),
          );
        } else if (kind === "logic") {
          set.logic.push(source("logic", id, item as unknown as LogicTemplate));
        } else if (kind === "formulas") {
          set.formulas.push(
            source("formulas", id, item as unknown as FormulaTemplate),
          );
        } else if (kind === "functions") {
          set.functions.push(
            source("functions", id, item as unknown as FunctionTemplate),
          );
        } else if (kind === "snippets") {
          set.snippets.push(
            source("snippets", id, item as unknown as PluginSnippet),
          );
        }
      }
    }
  }
  return set;
}
