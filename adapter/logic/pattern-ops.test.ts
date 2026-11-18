import { expect, it } from "vitest";
import { expandInputPatterns } from "./pattern-ops";
import type { LogicDocument } from "./types";

const doc = (ref: string, refs?: string[]): LogicDocument => ({
  version: 3,
  logics: [
    {
      id: "x",
      name: "X",
      kind: "function",
      inputs: {
        buttons: {
          from: { type: "state", ref, ...(refs ? { refs } : {}) },
          kind: "event",
        },
      },
      expr: { code: "1" },
    },
  ],
});

it("replaces a pattern with the matching states in order", async () => {
  const input = doc("alias.0.Gang.*.motion");
  const { doc: expanded, unmatched } = await expandInputPatterns(
    input,
    async () => ["alias.0.Gang.2.motion", "alias.0.Gang.1.motion"],
  );
  expect(expanded.logics[0].inputs!.buttons.from).toEqual({
    type: "state",
    ref: "alias.0.Gang.1.motion",
    refs: ["alias.0.Gang.2.motion"],
  });
  expect(unmatched).toEqual([]);
  // The stored document keeps the pattern.
  expect(input.logics[0].inputs!.buttons.from).toEqual({
    type: "state",
    ref: "alias.0.Gang.*.motion",
  });
});

it("keeps explicit refs and merges them with a pattern's matches", async () => {
  const { doc: expanded } = await expandInputPatterns(
    doc("alias.0.Gang.*.motion", ["0_userdata.0.Wall"]),
    async () => ["alias.0.Gang.1.motion", "0_userdata.0.Wall"],
  );
  expect(expanded.logics[0].inputs!.buttons.from).toEqual({
    type: "state",
    ref: "0_userdata.0.Wall",
    refs: ["alias.0.Gang.1.motion"],
  });
});

it("reports a pattern that matches nothing and drops it for this run", async () => {
  const { doc: expanded, unmatched } = await expandInputPatterns(
    doc("alias.0.Nope.*.motion"),
    async () => [],
  );
  expect(expanded.logics[0].inputs!.buttons.from).toEqual({
    type: "state",
    ref: "",
  });
  expect(unmatched).toEqual(["alias.0.Nope.*.motion"]);
});

it("looks a repeated pattern up once", async () => {
  const twice: LogicDocument = {
    version: 3,
    logics: [
      ...doc("alias.0.*.motion").logics,
      ...doc("alias.0.*.motion").logics.map((logic) => ({ ...logic, id: "y" })),
    ],
  };
  let calls = 0;
  await expandInputPatterns(twice, async () => {
    calls += 1;
    return ["alias.0.1.motion"];
  });
  expect(calls).toBe(1);
});
