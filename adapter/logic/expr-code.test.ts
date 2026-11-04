import { describe, expect, it } from "vitest";
import {
  checkExpression,
  extractRefs,
  highlightCode,
  renameCodeRefs,
  wrapExpression,
} from "./expr-code";

describe("checkExpression", () => {
  it("accepts a bare expression", () => {
    expect(checkExpression('get("temp") > 20 ? "On" : "Off"')).toBeNull();
    expect(checkExpression("({ a: 1 })")).toBeNull();
    expect(checkExpression("/* note */ 1 + 2")).toBeNull();
  });

  it("rejects statements, empty and broken code", () => {
    expect(checkExpression("")).toBe("expression is empty");
    expect(checkExpression("// only a comment")).toBe("expression is empty");
    expect(checkExpression("1; 2")).toContain("expression failed to compile");
    expect(checkExpression("return 1")).toContain(
      "expression failed to compile",
    );
    expect(checkExpression('get("x"')).toContain(
      "expression failed to compile",
    );
    expect(checkExpression('get("x)')).toContain(
      "expression failed to compile",
    );
  });

  it("wraps the code so a trailing comment is safe", () => {
    expect(wrapExpression("1 // note")).toBe("(1 // note\n)");
  });
});

describe("extractRefs", () => {
  it("collects literal get/state/set names", () => {
    expect(extractRefs('get("a") + state("b").value + set("c", 1)')).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("ignores dynamic names", () => {
    expect(extractRefs("get(name) + get(`tpl`)")).toEqual([]);
  });

  it("walks nested calls", () => {
    expect(extractRefs('set("out", get("in1") + get("in2"))')).toEqual([
      "out",
      "in1",
      "in2",
    ]);
  });
});

describe("renameCodeRefs", () => {
  it("rewrites literal refs in place", () => {
    expect(
      renameCodeRefs(
        'get("old") + state(\'old\') + set("old", 1)',
        "old",
        "new",
      ),
    ).toBe('get("new") + state(\'new\') + set("new", 1)');
    expect(renameCodeRefs('getState("old")', "old", "new")).toBe(
      'getState("old")',
    );
  });

  it("falls back on invalid code", () => {
    expect(renameCodeRefs('get("old"', "old", "new")).toBe('get("new"');
  });

  it("falls back when trailing content breaks the expression", () => {
    expect(renameCodeRefs('get("old") get("old")', "old", "new")).toBe(
      'get("new") get("new")',
    );
    expect(renameCodeRefs('foo; get("old")', "old", "new")).toBe(
      'foo; get("new")',
    );
  });

  it("escapes quotes in renamed names", () => {
    expect(renameCodeRefs('get("a\\"b")', 'a"b', 'c"d')).toBe('get("c\\"d")');
    expect(renameCodeRefs("get('a\\'b')", "a'b", "c'd")).toBe("get('c\\'d')");
  });
});

describe("highlightCode", () => {
  it("covers the whole input and classifies tokens", () => {
    const spans = highlightCode('get("x") + Math.round(1) // hi');
    expect(spans.map((span) => span.text).join("")).toBe(
      'get("x") + Math.round(1) // hi',
    );
    expect(spans.find((span) => span.text === "get")?.kind).toBe("function");
    expect(spans.find((span) => span.text === "Math")?.kind).toBe("function");
    expect(spans.find((span) => span.text === '"x"')?.kind).toBe("literal");
    expect(spans.find((span) => span.text === "1")?.kind).toBe("literal");
    expect(spans.find((span) => span.kind === "comment")?.text).toBe("// hi");
  });

  it("keeps the valid prefix when code is incomplete", () => {
    const spans = highlightCode('get("x"');
    expect(spans.map((span) => span.text).join("")).toBe('get("x"');
  });

  it("paints template literal text", () => {
    const code = "`a ${get('b')} c`";
    const spans = highlightCode(code);
    expect(spans.map((span) => span.text).join("")).toBe(code);
    expect(spans.find((span) => span.text === "a ")?.kind).toBe("literal");
    expect(spans.find((span) => span.text === " c")?.kind).toBe("literal");
    expect(spans.find((span) => span.text === "get")?.kind).toBe("function");
    expect(spans.find((span) => span.text === "'b'")?.kind).toBe("literal");
  });

  it("keeps everything visible when the tokenizer throws", () => {
    const spans = highlightCode('get("x');
    expect(spans.map((span) => span.text).join("")).toBe('get("x');
  });
});
