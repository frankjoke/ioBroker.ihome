import { expect, it } from "vitest";
import { migrateActionDocument, printActions } from "./migrate-actions";
import { parseLogicDocument } from "./validate";

it("rejects present non-array actions without losing the stored document", () => {
  expect(() => printActions({} as never)).toThrow();
  expect(printActions(undefined)).toBeUndefined();
  expect(printActions(null)).toBeUndefined();
  for (const state of [
    { on: [{ on: "e", do: { log: { text: "x" } } }] },
    { enter: { log: { text: "x" } } },
    { exit: { log: { text: "x" } } },
  ]) {
    const v2 = {
      version: 2,
      logics: [{ id: "m", name: "M", kind: "machine", states: { A: state } }],
    };
    const original = JSON.stringify(v2);
    expect(() => migrateActionDocument(v2)).toThrow();
    expect(parseLogicDocument(v2)).toBeNull();
    expect(JSON.stringify(v2)).toBe(original);
  }
});

it("migrates state exit and all-state rows", () => {
  const v3 = migrateActionDocument({
    version: 2,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        states: { A: { exit: [{ log: { text: "bye" } }] } },
        all: {
          on: [
            {
              on: "e",
              do: [{ set: { target: { ref: "x" }, value: { code: "1" } } }],
            },
          ],
        },
      },
    ],
  }) as any;
  expect(v3.logics[0].states.A.exit).toEqual({ code: 'log("bye")' });
  expect(v3.logics[0].all.on[0]).toEqual({
    on: "e",
    mode: "function",
    do: { code: 'set("x", (1\n))' },
  });
});

it("prints set, goto and log statements", () => {
  expect(
    printActions([
      { set: { target: { ref: "light" }, value: { code: "true" } } },
      { set: { target: { ref: "dim" }, value: { code: "50" }, ack: true } },
      {
        set: {
          target: { ref: "mode" },
          value: { code: '"auto"' },
          forward: "always",
        },
      },
      { goto: "On" },
      { log: { text: "saw {{v}}" } },
      { log: { text: "bad", level: "warn" } },
    ]),
  ).toBe(
    'set("light", (true\n))\n' +
      'set("dim", (50\n), true)\n' +
      'set("mode", ("auto"\n), { forward: "always" })\n' +
      'goto("On")\n' +
      'log("saw {{v}}")\n' +
      'log("bad", "warn")',
  );
});

it("prints both set options together", () => {
  expect(
    printActions([
      {
        set: {
          target: { ref: "x" },
          value: { code: "1" },
          ack: true,
          forward: "always",
        },
      },
    ]),
  ).toBe('set("x", (1\n), { ack: true, forward: "always" })');
});

it("migrates rows with both do and goto into one function block", () => {
  const v2 = {
    version: 2,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        states: {
          A: {
            enter: [{ set: { target: { ref: "x" }, value: { code: "1" } } }],
            on: [
              {
                on: "e",
                do: [{ set: { target: { ref: "x" }, value: { code: "2" } } }],
                goto: "B",
              },
              {
                on: "e",
                do: [
                  { goto: "B" },
                  { set: { target: { ref: "x" }, value: { code: "3" } } },
                ],
                goto: "C",
              },
              { on: "e", goto: "B", continue: true },
              { on: "e", continue: true },
              { on: "e" },
            ],
          },
          B: {},
          C: {},
        },
      },
    ],
  };

  const v3 = migrateActionDocument(v2) as any;
  const rows = v3.logics[0].states.A.on;

  expect(v3.version).toBe(3);
  expect(v3.logics[0].states.A.enter).toEqual({ code: 'set("x", (1\n))' });
  expect(rows[0]).toMatchObject({
    mode: "function",
    do: { code: 'set("x", (2\n))\ngoto("B")' },
  });
  expect(rows[0].goto).toBeUndefined();
  expect(rows[0].continue).toBeUndefined();
  expect(rows[1]).toMatchObject({
    mode: "function",
    do: { code: 'goto("B")\nset("x", (3\n))' },
  });
  expect(rows[1].goto).toBeUndefined();
  expect(rows[2]).toMatchObject({ mode: "goto", goto: "B" });
  expect(rows[2].continue).toBeUndefined();
  expect(rows[3]).toMatchObject({ mode: "function", continue: true });
  expect(rows[3].do).toBeUndefined();
  expect(rows[4]).toMatchObject({ mode: "goto" });

  // The source is untouched.
  expect(v2.logics[0].states.A.on[0].do).toHaveLength(1);
});

it("migrates templates and rejects an unknown action", () => {
  const v3 = migrateActionDocument({
    version: 2,
    logics: [],
    templates: [
      {
        id: "t",
        name: "T",
        params: [],
        logic: {
          id: "x",
          name: "X",
          kind: "machine",
          states: {
            A: {
              on: [
                {
                  on: "e",
                  do: [{ set: { target: { ref: "x" }, value: { code: "1" } } }],
                },
              ],
            },
          },
        },
      },
    ],
  }) as any;
  expect(v3.templates[0].logic.states.A.on[0].do).toEqual({
    code: 'set("x", (1\n))',
  });

  expect(() => printActions([{ nope: true }] as never)).toThrow();
});
