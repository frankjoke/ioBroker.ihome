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

it("prints every comparison and arithmetic operator", () => {
  const binary = (op: string, left: OldExpr, right: OldExpr): string =>
    printExpr({ op, left, right } as OldExpr);
  expect(binary("eq", ref("a"), num(1))).toBe('get("a") === 1');
  expect(binary("ne", ref("a"), num(1))).toBe('get("a") !== 1');
  expect(binary("gt", ref("a"), num(1))).toBe('get("a") > 1');
  expect(binary("gte", ref("a"), num(1))).toBe('get("a") >= 1');
  expect(binary("lt", ref("a"), num(1))).toBe('get("a") < 1');
  expect(binary("lte", ref("a"), num(1))).toBe('get("a") <= 1');
  expect(binary("div", ref("a"), num(2))).toBe('get("a") / 2');
  expect(binary("mod", ref("a"), num(2))).toBe('get("a") % 2');
  expect(printExpr({ op: "round", of: ref("a") })).toBe('Math.round(get("a"))');
  expect(printExpr({ op: "abs", of: ref("a") })).toBe('Math.abs(get("a"))');
  expect(printExpr({ op: "min", of: [ref("a"), num(1)] })).toBe(
    'Math.min(get("a"), 1)',
  );
  expect(printExpr({ op: "max", of: [ref("a"), num(1)] })).toBe(
    'Math.max(get("a"), 1)',
  );
});

it("throws on an unknown op, including prototype keys", () => {
  expect(() => printExpr({ op: "nope" } as never)).toThrow();
  expect(() => printExpr({ op: "constructor" } as never)).toThrow();
  expect(() => printExpr({ op: "__proto__" } as never)).toThrow();
});

it("keeps goto and log actions, and migrates exit values", () => {
  const v1 = {
    version: 1,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        states: {
          A: {
            exit: [{ set: { target: { ref: "out" }, value: num(1) } }],
            on: [
              {
                on: "e",
                do: [{ goto: "B" }, { log: { text: "hi" } }],
              },
            ],
          },
          B: {},
        },
      },
    ],
  };
  const v2 = migrateDocument(v1) as any;
  expect(v2.logics[0].states.A.exit[0].set.value).toEqual({ code: "1" });
  expect(v2.logics[0].states.A.on[0].do).toEqual([
    { goto: "B" },
    { log: { text: "hi" } },
  ]);
});

it("prints edge cases as valid JavaScript", () => {
  expect(printExpr({ op: "neg", of: { const: -1 } })).toBe("- -1");
  expect(printExpr({ op: "and", of: [] })).toBe("true");
  expect(printExpr({ op: "or", of: [] })).toBe("false");
});

it("prints the value-semantics changes of §5.3", () => {
  // Non-empty and/or keep their operands: `&&`/`||` return a value, not a bool.
  expect(printExpr({ op: "and", of: [ref("a"), ref("b")] })).toBe(
    'get("a") && get("b")',
  );
  expect(printExpr({ op: "or", of: [ref("a"), ref("b")] })).toBe(
    'get("a") || get("b")',
  );
  // Division and modulo by zero are JavaScript, so Infinity/NaN instead of an error.
  expect(printExpr({ op: "div", left: ref("a"), right: num(0) })).toBe(
    'get("a") / 0',
  );
  expect(printExpr({ op: "mod", left: ref("a"), right: num(0) })).toBe(
    'get("a") % 0',
  );
  // `len` of a number prints its undefined `.length`, not a helper call.
  expect(printExpr({ op: "len", of: num(5) })).toBe("(5).length");
  // A string compared with a number uses JavaScript coercion.
  expect(printExpr({ op: "gt", left: ref("s"), right: num(9) })).toBe(
    'get("s") > 9',
  );
});
