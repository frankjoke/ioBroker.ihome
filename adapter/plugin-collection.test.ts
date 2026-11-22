import { expect, it } from "vitest";
import { baselineOf, canonicalJson, collectionOf } from "./plugin-collection";

const state = {
  id: "0_userdata.0.pv.total",
  type: "state" as const,
  common: {
    name: "Total",
    type: "number",
    role: "value",
    read: true,
    write: false,
  },
};
const logic = {
  id: "calc",
  name: "Calc",
  kind: "function" as const,
  expr: { code: "1" },
};

it("accepts one state and one logic", () => {
  const parsed = collectionOf({ version: 1, states: [state], logics: [logic] });
  expect("collection" in parsed && parsed.collection.logics[0].id).toBe("calc");
});

it("accepts the mixed-case logic ids the editor allows", () => {
  const parsed = collectionOf({
    version: 1,
    states: [state],
    logics: [{ ...logic, id: "TestAction" }],
  });
  expect("collection" in parsed).toBe(true);
});

it("rejects empty ownership, unknown keys, bad version and duplicate ids", () => {
  expect(collectionOf({ version: 1, states: [], logics: [] })).toHaveProperty(
    "problem",
  );
  expect(
    collectionOf({ version: 2, states: [state], logics: [logic] }),
  ).toHaveProperty("problem");
  expect(
    collectionOf({ version: 1, states: [state], logics: [logic], extra: 1 }),
  ).toHaveProperty("problem");
  expect(
    collectionOf({ version: 1, states: [state], logics: [logic, logic] }),
  ).toHaveProperty("problem");
});

it("validates state ids, logic semantics and uses overlap", () => {
  const badState = { ...state, id: "../x" };
  expect(
    collectionOf({ version: 1, states: [badState], logics: [logic] }),
  ).toHaveProperty("problem");
  expect(
    collectionOf({
      version: 1,
      states: [state],
      logics: [{ ...logic, kind: "machine" }],
    }),
  ).toHaveProperty("problem");
  expect(
    collectionOf({
      version: 1,
      states: [state],
      logics: [logic],
      uses: [state.id],
    }),
  ).toHaveProperty("problem");
});

it("canonicalises key order and ignores ownership markers", () => {
  expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
    '{"a":{"c":3,"d":2},"b":1}',
  );
  const plain = baselineOf(logic, "logic");
  expect(
    baselineOf(
      {
        ...logic,
        managed: { plugin: "x", version: "1", baseline: "0".repeat(64) },
      },
      "logic",
    ),
  ).toBe(plain);
  expect(
    baselineOf(
      {
        ...state,
        native: {
          ihomeCollection: {
            plugin: "x",
            version: "1",
            baseline: "0".repeat(64),
          },
        },
      },
      "state",
    ),
  ).toBe(baselineOf(state, "state"));
  expect(baselineOf({ ...logic, name: "Other" }, "logic")).not.toBe(plain);
});
