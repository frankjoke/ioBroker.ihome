import { expect, it } from "vitest";
import { migrateDocument, printExpr, type OldExpr } from "./migrate-expr";

const ref = (name: string): OldExpr => ({ ref: name });
const num = (value: number): OldExpr => ({ const: value });

it("prints arithmetic with minimal parentheses", () => {
  expect(
    printExpr({
      op: "mul",
      left: { op: "add", left: num(1), right: num(2) },
      right: num(3),
    }),
  ).toBe("(1 + 2) * 3");
  expect(
    printExpr({
      op: "sub",
      left: ref("a"),
      right: { op: "sub", left: ref("b"), right: ref("c") },
    }),
  ).toBe('get("a") - (get("b") - get("c"))');
  expect(printExpr({ op: "neg", of: { op: "neg", of: ref("x") } })).toBe(
    '-(-get("x"))',
  );
});

it("prints helpers, if and noop", () => {
  expect(printExpr({ op: "clamp", of: ref("x"), min: 0, max: 10 })).toBe(
    'Math.min(10, Math.max(0, get("x")))',
  );
  expect(printExpr({ op: "len", of: ref("text") })).toBe(
    '(get("text")).length',
  );
  expect(
    printExpr({
      op: "if",
      cond: ref("on"),
      then: { const: "yes" },
      else: { const: "no" },
    }),
  ).toBe('get("on") ? "yes" : "no"');
  expect(printExpr({ noop: true })).toBe("noop()");
});

it("escapes string constants", () => {
  const text = 'say "hi"';
  expect(printExpr({ const: text })).toBe(JSON.stringify(text));
});

it("migrates a whole v1 document, including templates", () => {
  const v1 = {
    version: 1,
    memory: [{ name: "m", type: "number", initial: 1 }],
    logics: [
      {
        id: "f",
        name: "F",
        kind: "function",
        expr: { op: "add", left: ref("a"), right: num(1) },
      },
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: { const: "Auto" } },
        states: {
          Auto: {
            enter: [{ set: { target: { ref: "out" }, value: num(2) } }],
            on: [
              {
                on: "e",
                if: ref("on"),
                do: [{ set: { target: { ref: "out" }, value: num(3) } }],
              },
            ],
          },
        },
        all: {
          on: [{ on: "e", if: { op: "not", of: ref("on") } }],
        },
      },
    ],
    templates: [
      {
        id: "t",
        name: "T",
        params: [],
        logic: { id: "x", name: "X", kind: "function", expr: num(4) },
      },
    ],
  };

  const v2 = migrateDocument(v1) as any;
  expect(v2.version).toBe(2);
  expect(v2.logics[0].expr).toEqual({ code: 'get("a") + 1' });
  expect(v2.logics[1].init.state).toEqual({ code: '"Auto"' });
  expect(v2.logics[1].states.Auto.enter[0].set.value).toEqual({ code: "2" });
  expect(v2.logics[1].states.Auto.on[0].if).toEqual({
    code: 'get("on")',
  });
  expect(v2.logics[1].all.on[0].if).toEqual({ code: '!get("on")' });
  expect(v2.templates[0].logic.expr).toEqual({ code: "4" });
  expect(JSON.stringify(v2)).not.toMatch(/"op"|"const"/);
  // The source is untouched.
  expect((v1.logics[0].expr as any).op).toBe("add");
});

it("throws on an unknown op", () => {
  expect(() => printExpr({ op: "nope" } as never)).toThrow();
});

it("prints edge cases as valid JavaScript", () => {
  expect(printExpr({ op: "neg", of: { const: -1 } })).toBe("- -1");
  expect(printExpr({ op: "and", of: [] })).toBe("true");
  expect(printExpr({ op: "or", of: [] })).toBe("false");
});
