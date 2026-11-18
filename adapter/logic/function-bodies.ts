import type { LogicDocument } from "./types";

/**
 * Older function logics store one expression whose value is the output. The
 * editor and the runtime now use a function body, so an expression is wrapped
 * as `return (…)`. The stored document is rewritten the next time it is saved.
 */
export function toStatementBodies(doc: LogicDocument): LogicDocument {
  let changed = false;
  const logics = doc.logics.map((logic) => {
    if (
      logic.kind !== "function" ||
      logic.mode === "statements" ||
      typeof logic.expr?.code !== "string"
    ) {
      return logic;
    }
    changed = true;
    return {
      ...logic,
      mode: "statements" as const,
      // The newline keeps a trailing `// comment` from swallowing the `)`.
      expr: { code: `return (${logic.expr.code}\n);` },
    };
  });
  return changed ? { ...doc, logics } : doc;
}
