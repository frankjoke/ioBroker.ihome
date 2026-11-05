import { describe, expect, it } from "vitest";
import {
  checkExpression,
  checkStatement,
  extractGotos,
  extractRefCalls,
  extractRefs,
  highlightCode,
  renameCodeRefs,
  renameGotoRefs,
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
  it("finds refs in bare object expressions", () => {
    expect(extractRefs('{"value": get("0_userdata.0.SENSOR")}.value')).toEqual([
      "0_userdata.0.SENSOR",
    ]);
  });
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

describe("checkStatement", () => {
  it("accepts statements, return, this and empty code", () => {
    expect(
      checkStatement('set("light", true)\nif (get("x")) goto("On")'),
    ).toBeNull();
    expect(checkStatement("return 1")).toBeNull();
    expect(checkStatement("this.sum = (this.sum ?? 0) + 1")).toBeNull();
    expect(checkStatement("")).toBeNull();
    expect(checkStatement("// note")).toBeNull();
  });

  it("reports a syntax error", () => {
    expect(checkStatement('set("x"')).toContain(
      "action code failed to compile",
    );
  });
});

describe("extractRefs on statements", () => {
  it("finds refs in every statement", () => {
    expect(
      extractRefs('set("a", 1)\nif (get("b")) set("c", state("d").value)'),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps ignoring dynamic names", () => {
    expect(extractRefs("get(name)")).toEqual([]);
  });
});

describe("extractRefCalls", () => {
  it("keeps the function name for validation", () => {
    expect(extractRefCalls('set("a", 1)\nget("b")')).toEqual([
      { fn: "set", name: "a" },
      { fn: "get", name: "b" },
    ]);
  });
});

describe("extractGotos", () => {
  it("returns literal targets only", () => {
    expect(extractGotos('if (get("x")) goto("A")\ngoto("B")')).toEqual([
      "A",
      "B",
    ]);
    expect(extractGotos("goto()\ngoto(NOACTION)\ngoto(name)")).toEqual([]);
  });
});

describe("renameCodeRefs on statements", () => {
  it("rewrites refs across statements", () => {
    expect(renameCodeRefs('set("old", 1)\nget("old")', "old", "new")).toBe(
      'set("new", 1)\nget("new")',
    );
  });
});

describe("renameGotoRefs", () => {
  it("leaves goto text inside valid expression strings untouched", () => {
    for (const source of [
      'get("message") === "goto(\'old\')"',
      '{"text": "goto(\'old\')"}.text === get("message")',
    ]) {
      expect(renameGotoRefs(source, "old", "new")).toBe(source);
    }
    expect(renameGotoRefs('{"value": goto("old")}.value', "old", "new")).toBe(
      '{"value": goto("new")}.value',
    );
  });
  it("rewrites literal goto targets only", () => {
    expect(renameGotoRefs('goto("old")\ngoto("other")', "old", "new")).toBe(
      'goto("new")\ngoto("other")',
    );
    expect(renameGotoRefs("goto()\ngoto(NOACTION)", "old", "new")).toBe(
      "goto()\ngoto(NOACTION)",
    );
  });
});

describe("highlightCode on statements", () => {
  it("paints goto and log as functions", () => {
    const spans = highlightCode('goto("On")\nlog("hi")');
    expect(spans.find((span) => span.text === "goto")?.kind).toBe("function");
    expect(spans.find((span) => span.text === "log")?.kind).toBe("function");
  });
});
