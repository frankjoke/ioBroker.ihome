import { extractRefCalls } from "$logic/expr-code";
import type { LogicDef } from "$logic/types";
import type { Template } from "$lib/types/display";

export interface StateSuggestion {
  id: string;
  /** Logic names that read or write it. */
  usedBy: string[];
  /** The logic output: a new state the collection should own by default. */
  ownedByDefault: boolean;
}

/** Local copy: `$logic/subscriptions` pulls the node-only runtime into the SPA. */
function collectRefs(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "ref" && typeof item === "string") out.push(item);
      else collectRefs(item, out);
    }
  }
}

/** Every `code` string in a logic, including machine rows and enter/exit blocks. */
function collectCode(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCode(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "code" && typeof item === "string") out.push(item);
      else collectCode(item, out);
    }
  }
}

/** Every state the selected logics touch, with the output marked for ownership. */
export function suggestCollectionStates(
  logics: LogicDef[],
  resolveVariable: (name: string) => string | undefined,
): StateSuggestion[] {
  const rows = new Map<string, StateSuggestion>();
  const add = (ref: string, name: string, owned: boolean): void => {
    if (!ref || ref.startsWith("$")) return;
    const id = ref.includes(".") ? ref : resolveVariable(ref);
    if (!id || id.startsWith("$") || !id.includes(".")) return;
    const row = rows.get(id) ?? {
      id,
      usedBy: [],
      ownedByDefault: false,
    };
    if (!row.usedBy.includes(name)) row.usedBy.push(name);
    row.ownedByDefault = row.ownedByDefault || owned;
    rows.set(id, row);
  };

  for (const logic of logics) {
    const refs: string[] = [];
    collectRefs(logic, refs);
    const outputRef =
      logic.output?.scope === "state" ? logic.output.ref : undefined;
    for (const ref of refs) add(ref, logic.name, ref === outputRef);
    const code: string[] = [];
    collectCode(logic, code);
    for (const snippet of code) {
      for (const call of extractRefCalls(snippet)) {
        add(call.name, logic.name, false);
      }
    }
  }

  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** A tile copy without the provenance that only the live template has.
 *  `origins` maps a lower-cased item name to the owned state id, so the
 *  contributed template can pre-bind the plugin's own states on install. */
export function collectionTileDefinition(
  template: Template,
  origins: Map<string, string> = new Map(),
): Template {
  const copy = JSON.parse(JSON.stringify(template)) as Template & {
    builtin?: boolean;
    basedOn?: string;
  };
  delete copy.builtin;
  delete copy.basedOn;
  if (origins.size) {
    copy.slots = (copy.slots ?? []).map((slot) => {
      if (slot.origin) return slot;
      const label = String(slot.label ?? slot.repair?.label ?? "")
        .trim()
        .toLowerCase();
      const origin = label ? origins.get(label) : undefined;
      return origin ? { ...slot, origin } : slot;
    });
  }
  return copy;
}
