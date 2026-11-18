import type { Input, LogicDef, LogicDocument } from "./types";

/** A state ref that names a pattern rather than one id. */
const PATTERN = /[*?]/;

export interface PatternExpansion {
  /** The engine's copy: pattern refs replaced by the matched state ids. */
  doc: LogicDocument;
  /** Patterns that matched nothing, for one warning each. */
  unmatched: string[];
}

/**
 * Replace `*`/`?` state refs with the states the lookup finds, as if that many
 * sources had been added. The stored document keeps the pattern; only the
 * engine's copy is expanded, so the next engine build sees new matches.
 */
export async function expandInputPatterns(
  doc: LogicDocument,
  lookup: (pattern: string) => Promise<string[]>,
): Promise<PatternExpansion> {
  const cache = new Map<string, string[]>();
  const unmatched: string[] = [];

  const resolve = async (ref: string): Promise<string[]> => {
    if (!PATTERN.test(ref)) return [ref];
    const cached = cache.get(ref);
    if (cached) return cached;
    const matches = [...new Set(await lookup(ref))].sort();
    cache.set(ref, matches);
    if (matches.length === 0 && !unmatched.includes(ref)) unmatched.push(ref);
    return matches;
  };

  const logics: LogicDef[] = [];
  for (const logic of doc.logics) {
    const inputs = logic.inputs;
    if (!inputs) {
      logics.push(logic);
      continue;
    }
    let changed = false;
    const next: Record<string, Input> = {};
    for (const [name, input] of Object.entries(inputs)) {
      if (input.from.type !== "state") {
        next[name] = input;
        continue;
      }
      const refs = [input.from.ref, ...(input.from.refs ?? [])];
      const expanded: string[] = [];
      for (const ref of refs) expanded.push(...(await resolve(ref)));
      const ids = [...new Set(expanded)];
      const same =
        ids.length === refs.length &&
        ids.every((id, index) => id === refs[index]);
      if (same) {
        next[name] = input;
        continue;
      }
      changed = true;
      next[name] = {
        ...input,
        from: {
          ...input.from,
          ref: ids[0] ?? "",
          ...(ids.length > 1 ? { refs: ids.slice(1) } : {}),
        },
      };
    }
    logics.push(changed ? { ...logic, inputs: next } : logic);
  }

  return { doc: { ...doc, logics }, unmatched };
}
