import { parse, parseExpressionAt, tokenizer } from "acorn";
import type { Node, Token } from "acorn";

/** Calls that read or write an ioBroker state by name. */
const REF_FUNCTIONS = new Set(["get", "state", "set"]);
/** Names the editor paints as functions. */
const HIGHLIGHT_NAMES = new Set([...REF_FUNCTIONS, "noop", "Math"]);

export type CodeSpanKind =
  "plain" | "function" | "keyword" | "literal" | "comment";

export interface CodeSpan {
  text: string;
  kind: CodeSpanKind;
}

/** Wrap bare code so a trailing `// comment` does not swallow the closing paren. */
export function wrapExpression(code: string): string {
  return `(${code}\n)`;
}

/**
 * Validate that `code` is exactly one JavaScript expression.
 * Returns a human-readable error, or null when it is valid.
 */
export function checkExpression(code: string): string | null {
  try {
    const stream = tokenizer(code, { ecmaVersion: "latest" });
    if (stream.getToken().type.label === "eof") return "expression is empty";
  } catch {
    // not empty — let the parser report the syntax error below
  }

  try {
    const program = parse(wrapExpression(code), {
      ecmaVersion: "latest",
      sourceType: "script",
    });
    if (
      program.body.length !== 1 ||
      program.body[0].type !== "ExpressionStatement"
    ) {
      return "expression failed to compile: not a single expression";
    }
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return `expression failed to compile: ${error.message}`;
    }
    throw error;
  }
}

/** Literal state name passed to get/state/set, with its source range. */
function refLiteral(
  node: Node,
): { name: string; start: number; end: number } | null {
  if (node.type !== "CallExpression") return null;
  const call = node as unknown as {
    callee?: { type?: string; name?: string };
    arguments?: unknown[];
  };
  if (
    !call.callee ||
    call.callee.type !== "Identifier" ||
    !call.callee.name ||
    !REF_FUNCTIONS.has(call.callee.name)
  ) {
    return null;
  }
  const arg = call.arguments?.[0] as
    | { type?: string; value?: unknown; start?: number; end?: number }
    | undefined;
  if (
    !arg ||
    arg.type !== "Literal" ||
    typeof arg.value !== "string" ||
    typeof arg.start !== "number" ||
    typeof arg.end !== "number"
  ) {
    return null;
  }
  return { name: arg.value, start: arg.start, end: arg.end };
}

/** Walk every node of an acorn tree. */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (typeof record.type !== "string") return;
  visit(record as unknown as Node);
  for (const [key, value] of Object.entries(record)) {
    if (key === "type" || key === "start" || key === "end") continue;
    walk(value, visit);
  }
}

/** State names referenced by literal get/state/set calls, in source order. */
export function extractRefs(code: string): string[] {
  let root: unknown;
  try {
    root = parseExpressionAt(code, 0, { ecmaVersion: "latest" });
  } catch {
    return [];
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  walk(root, (node) => {
    const ref = refLiteral(node);
    if (ref && !seen.has(ref.name)) {
      seen.add(ref.name);
      refs.push(ref.name);
    }
  });
  return refs;
}

/** Quote `value` like the literal it replaces, so the author's style survives. */
function quoted(quote: string, value: string): string {
  const body = JSON.stringify(value).slice(1, -1);
  return quote === "'" ? `'${body.replace(/'/g, "\\'")}'` : `"${body}"`;
}

/** Rewrite literal get/state/set state names from `from` to `to`. */
export function renameCodeRefs(code: string, from: string, to: string): string {
  let root: unknown;
  try {
    root = parseExpressionAt(code, 0, { ecmaVersion: "latest" });
  } catch {
    // A half-tied expression is still worth renaming: use the text pattern.
    const pattern = /\b(get|state|set)(\(\s*)(["'])([^"'\\]*)\3/g;
    return code.replace(
      pattern,
      (match, fn: string, open: string, quote: string, name: string) =>
        name === from ? `${fn}${open}${quoted(quote, to)}` : match,
    );
  }

  const ranges: Array<{ start: number; end: number; quote: string }> = [];
  walk(root, (node) => {
    const ref = refLiteral(node);
    if (ref && ref.name === from) {
      ranges.push({ ...ref, quote: code[ref.start] });
    }
  });

  let out = code;
  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    out =
      out.slice(0, range.start) +
      quoted(range.quote, to) +
      out.slice(range.end);
  }
  return out;
}

function tokenKind(token: Token, code: string): CodeSpanKind {
  if (token.type.keyword) return "keyword";
  if (token.type.label === "name") {
    return HIGHLIGHT_NAMES.has(code.slice(token.start, token.end))
      ? "function"
      : "plain";
  }
  if (["num", "string", "regexp", "`"].includes(token.type.label)) {
    return "literal";
  }
  return "plain";
}

/** Split `code` into coloured spans; the texts always join back to `code`. */
export function highlightCode(code: string): CodeSpan[] {
  const ranges: Array<{ start: number; end: number; kind: CodeSpanKind }> = [];
  try {
    const stream = tokenizer(code, {
      ecmaVersion: "latest",
      onComment: (_block, _text, start, end) =>
        ranges.push({ start, end, kind: "comment" }),
    });
    for (;;) {
      const token = stream.getToken();
      if (token.type.label === "eof") break;
      ranges.push({
        start: token.start,
        end: token.end,
        kind: tokenKind(token, code),
      });
    }
  } catch {
    // keep the prefix that did tokenize; the rest is appended as plain text
  }

  const spans: CodeSpan[] = [];
  let cursor = 0;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (range.start > cursor) {
      spans.push({ text: code.slice(cursor, range.start), kind: "plain" });
    }
    if (range.end > range.start) {
      spans.push({
        text: code.slice(range.start, range.end),
        kind: range.kind,
      });
      cursor = Math.max(cursor, range.end);
    }
  }
  if (cursor < code.length) {
    spans.push({ text: code.slice(cursor), kind: "plain" });
  }
  return spans;
}
