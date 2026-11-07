/** Compile a JS expression without evaluating it; returns the syntax error. */
export function expressionSyntaxProblem(source: string): string | null {
  try {
    new Function(`return (${source});`);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
