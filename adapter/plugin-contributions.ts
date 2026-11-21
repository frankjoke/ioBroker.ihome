// The JSON envelope a plugin manifest may carry. The adapter checks shape,
// ids and size; the SPA validates the individual templates.

export type ContributionKind =
  "tiles" | "bundles" | "logic" | "formulas" | "functions" | "snippets";

export interface PluginSnippet {
  id: string;
  name: string;
  description?: string;
  language?: "js" | "json" | "text";
  code: string;
}

export interface ContributionItem {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface PluginContributions {
  tiles?: ContributionItem[];
  bundles?: ContributionItem[];
  logic?: ContributionItem[];
  formulas?: ContributionItem[];
  functions?: ContributionItem[];
  snippets?: PluginSnippet[];
}

export interface ContributionSummary {
  counts: Partial<Record<ContributionKind, number>>;
  total: number;
}

export const MAX_PLUGIN_CONTRIBUTIONS = 2_000_000;
export const MAX_CONTRIBUTION = 512_000;
export const MAX_CONTRIBUTIONS_PER_KIND = 100;

const KINDS: readonly ContributionKind[] = [
  "tiles",
  "bundles",
  "logic",
  "formulas",
  "functions",
  "snippets",
];
const ITEM_ID = /^[A-Za-z0-9._-]{1,64}$/;
const LANGUAGES = new Set(["js", "json", "text"]);

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyText(value: unknown, max: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}

function itemProblem(kind: ContributionKind, value: unknown): string | null {
  if (!record(value)) return `${kind}: each item must be an object.`;
  if (!ITEM_ID.test(typeof value.id === "string" ? value.id : "")) {
    return `${kind}: every item needs an id of letters, digits, dot, dash or underscore (max 64).`;
  }
  if (!nonEmptyText(value.name, 64)) {
    return `${kind}: item ${value.id} needs a name (max 64 characters).`;
  }
  if (kind === "snippets") {
    if (!nonEmptyText(value.code, MAX_CONTRIBUTION)) {
      return `${kind}: item ${value.id} needs code (max ${MAX_CONTRIBUTION} characters).`;
    }
    if (
      value.language !== undefined &&
      (typeof value.language !== "string" || !LANGUAGES.has(value.language))
    ) {
      return `${kind}: item ${value.id} has an unknown language.`;
    }
  }
  return null;
}

/** The valid envelope, or the first reason it is not one. */
export function pluginContributionsOf(
  value: unknown,
): { contributions: PluginContributions } | { problem: string } {
  if (!record(value)) return { problem: "Contributions must be an object." };
  for (const key of Object.keys(value)) {
    if (!KINDS.includes(key as ContributionKind)) {
      return { problem: `Unknown contribution kind: ${key}.` };
    }
  }
  const contributions: PluginContributions = {};
  let total = 0;
  for (const kind of KINDS) {
    const list = value[kind];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      return { problem: `${kind}: contributions must be an array.` };
    }
    if (list.length === 0) {
      return { problem: `${kind}: the list must not be empty.` };
    }
    if (list.length > MAX_CONTRIBUTIONS_PER_KIND) {
      return {
        problem: `${kind}: at most ${MAX_CONTRIBUTIONS_PER_KIND} items are allowed.`,
      };
    }
    const ids = new Set<string>();
    for (const item of list) {
      const problem = itemProblem(kind, item);
      if (problem) return { problem };
      const recordItem = item as ContributionItem;
      if (ids.has(recordItem.id)) {
        return { problem: `${kind}: duplicate id ${recordItem.id}.` };
      }
      ids.add(recordItem.id);
      if (JSON.stringify(item).length > MAX_CONTRIBUTION) {
        return {
          problem: `${kind}: item ${recordItem.id} is too large (max ${MAX_CONTRIBUTION} characters).`,
        };
      }
      total += JSON.stringify(item).length;
    }
    (contributions as Record<string, unknown>)[kind] = list;
  }
  if (total === 0) {
    return { problem: "Contributions need at least one item." };
  }
  if (total > MAX_PLUGIN_CONTRIBUTIONS) {
    return {
      problem: `Contributions are too large (max ${MAX_PLUGIN_CONTRIBUTIONS} characters).`,
    };
  }
  return { contributions };
}

export function contributionSummary(
  value: PluginContributions | undefined,
): ContributionSummary {
  const counts: Partial<Record<ContributionKind, number>> = {};
  let total = 0;
  for (const kind of KINDS) {
    const count = value?.[kind]?.length ?? 0;
    if (count > 0) {
      counts[kind] = count;
      total += count;
    }
  }
  return { counts, total };
}
