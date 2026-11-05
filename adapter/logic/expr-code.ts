import { parse, tokenizer } from "acorn";
import type { Node, Program, Token } from "acorn";

/** Calls that read or write an ioBroker state by name. */
const REF_FUNCTIONS = new Set(["get", "state", "set"]);
/** Calls whose literal first argument names a logic action to jump to. */
const GOTO_FUNCTIONS = new Set(["goto"]);
/** Names the editor paints as functions. */
const HIGHLIGHT_NAMES = new Set([
  ...REF_FUNCTIONS,
  ...GOTO_FUNCTIONS,
  "log",
  "noop",
  "Math",
]);

interface RefCall {
  fn: string;
  name: string;
  start: number;
  end: number;
}

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

/** Literal name passed to one of `names`, with its source range. */
function refCall(
  node: Node,
  names: ReadonlySet<string> = REF_FUNCTIONS,
): RefCall | null {
  if (node.type !== "CallExpression") return null;
  const call = node as unknown as {
    callee?: { type?: string; name?: string };
    arguments?: unknown[];
  };
  if (
    !call.callee ||
    call.callee.type !== "Identifier" ||
    !call.callee.name ||
    !names.has(call.callee.name)
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
  return {
    fn: call.callee.name,
    name: arg.value,
    start: arg.start,
    end: arg.end,
  };
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

/** Parse action code as a script; `return` is allowed because the runtime wraps it in a function. */
function parseProgram(code: string): Program {
  return parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowReturnOutsideFunction: true,
  });
}

function parseOrNull(code: string): Program | null {
  try {
    return parseProgram(code);
  } catch {
    return null;
  }
}

/** Literal calls to `names` in source order, or null when the code does not parse. */
function programCalls(
  code: string,
  names: ReadonlySet<string>,
): RefCall[] | null {
  const program = parseOrNull(code);
  if (!program) return null;
  const calls: RefCall[] = [];
  walk(program, (node) => {
    const call = refCall(node, names);
    if (call) calls.push(call);
  });
  return calls;
}

/** State names referenced by literal get/state/set calls, in source order. */
export function extractRefs(code: string): string[] {
  const names = (programCalls(code, REF_FUNCTIONS) ?? []).map(
    (call) => call.name,
  );
  return [...new Set(names)];
}

/** Literal get/state/set calls, deduped by function and name. */
export function extractRefCalls(
  code: string,
): Array<{ fn: "get" | "state" | "set"; name: string }> {
  const seen = new Map<string, { fn: "get" | "state" | "set"; name: string }>();
  for (const call of programCalls(code, REF_FUNCTIONS) ?? []) {
    const key = `${call.fn}:${call.name}`;
    if (!seen.has(key)) {
      seen.set(key, {
        fn: call.fn as "get" | "state" | "set",
        name: call.name,
      });
    }
  }
  return [...seen.values()];
}

/** Literal `goto` targets; dynamic and empty calls are skipped. */
export function extractGotos(code: string): string[] {
  const names = (programCalls(code, GOTO_FUNCTIONS) ?? []).map(
    (call) => call.name,
  );
  return [...new Set(names)];
}

/** Returns a human-readable error, or null when the statement block parses. */
export function checkStatement(code: string): string | null {
  try {
    parseProgram(code);
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return `action code failed to compile: ${error.message}`;
    }
    throw error;
  }
}

/** Quote `value` like the literal it replaces, so the author's style survives. */
function quoted(quote: string, value: string): string {
  const body = JSON.stringify(value).slice(1, -1);
  return quote === "'" ? `'${body.replace(/'/g, "\\'")}'` : `"${body}"`;
}

/** Rewrite literal get/state/set state names from `from` to `to`. */
/** Ref calls with offsets into `code`; expression code is tried first, then statements. */
function refCallsInCode(code: string): RefCall[] | null {
  const wrapped = parseOrNull(wrapExpression(code));
  if (
    wrapped &&
    wrapped.body.length === 1 &&
    wrapped.body[0].type === "ExpressionStatement"
  ) {
    const calls: RefCall[] = [];
    walk(wrapped, (node) => {
      const call = refCall(node);
      // wrapExpression prepends "(", so shift AST offsets back into `code`
      if (call) {
        calls.push({ ...call, start: call.start - 1, end: call.end - 1 });
      }
    });
    return calls;
  }
  return programCalls(code, REF_FUNCTIONS);
}

/** Replace the literal of each call named `from` with `to`, keeping its quote style. */
function renameLiterals(
  code: string,
  calls: RefCall[],
  from: string,
  to: string,
): string {
  let out = code;
  for (const call of calls
    .filter((call) => call.name === from)
    .sort((a, b) => b.start - a.start)) {
    out =
      out.slice(0, call.start) +
      quoted(code[call.start], to) +
      out.slice(call.end);
  }
  return out;
}

/** Rewrite literal get/state/set state names from `from` to `to`. */
export function renameCodeRefs(code: string, from: string, to: string): string {
  const calls = refCallsInCode(code);
  if (calls) return renameLiterals(code, calls, from, to);

  // shortcut: the fallback can match inside comments, strings or `obj.set`;
  // the save stays blocked until the syntax is fixed.
  const pattern = /\b(get|state|set)(\(\s*)(["'])([^"'\\]*)\3/g;
  return code.replace(
    pattern,
    (match, fn: string, open: string, quote: string, name: string) =>
      name === from ? `${fn}${open}${quoted(quote, to)}` : match,
  );
}

/** Rewrite literal goto targets from `from` to `to`; dynamic targets stay. */
export function renameGotoRefs(code: string, from: string, to: string): string {
  const calls = programCalls(code, GOTO_FUNCTIONS);
  if (calls) return renameLiterals(code, calls, from, to);

  // shortcut: the fallback can match inside comments or strings, like renameCodeRefs
  const pattern = /\b(goto\(\s*)(["'])([^"'\\]*)\2/g;
  return code.replace(
    pattern,
    (match, head: string, quote: string, name: string) =>
      name === from ? `${head}${quoted(quote, to)}` : match,
  );
}

function tokenKind(token: Token, code: string): CodeSpanKind {
  if (token.type.keyword) return "keyword";
  if (token.type.label === "name") {
    return HIGHLIGHT_NAMES.has(code.slice(token.start, token.end))
      ? "function"
      : "plain";
  }
  if (["num", "string", "regexp", "template", "`"].includes(token.type.label)) {
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
