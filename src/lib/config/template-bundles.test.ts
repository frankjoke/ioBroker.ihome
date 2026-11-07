import { describe, expect, it } from "vitest";
import type { TemplateBundle } from "$lib/types/templates";
import {
  compileTemplateItems,
  devicePartFromTemplate,
  evaluateBundleApi,
  logicPartFromTemplate,
  migrateTemplateBundleLibrary,
  templateBundleProblem,
} from "./template-bundles";

const logic = {
  id: "tv",
  name: "TV",
  kind: "function" as const,
  inputs: {},
  output: { scope: "memory" as const },
  expr: { code: "noop()" },
};
const bundle = (over: Record<string, unknown> = {}) =>
  ({
    id: "tv",
    name: "TV",
    params: [],
    items: [],
    device: { type: "Custom", features: [], slots: [] },
    logic: { logic },
    ...over,
  }) as unknown as TemplateBundle;

describe("migrateTemplateBundleLibrary", () => {
  it("reads an object, a JSON string and a state value", () => {
    const lib = { version: 1, updatedAt: 2, bundles: [bundle()] };
    expect(migrateTemplateBundleLibrary(lib).bundles).toHaveLength(1);
    expect(
      migrateTemplateBundleLibrary(JSON.stringify(lib)).bundles,
    ).toHaveLength(1);
    expect(migrateTemplateBundleLibrary({ val: lib }).bundles).toHaveLength(1);
  });

  it("drops invalid entries and never throws", () => {
    expect(
      migrateTemplateBundleLibrary({
        bundles: [bundle(), { id: "x" }, null, { name: "x" }],
      }).bundles,
    ).toHaveLength(1);
    expect(migrateTemplateBundleLibrary("nope").bundles).toEqual([]);
    expect(migrateTemplateBundleLibrary(null).bundles).toEqual([]);
  });
});

describe("compileTemplateItems", () => {
  it("compiles conversion strings and refuses broken code", () => {
    const [item] = compileTemplateItems([
      { name: "t", type: "number", conversion: "(r, raw) => Number(raw) + 1" },
    ]);
    expect(typeof item.conversion).toBe("function");
    expect(() =>
      compileTemplateItems([{ name: "t", type: "number", conversion: "1 +" }]),
    ).toThrow();
    expect(() =>
      compileTemplateItems([{ name: "t", type: "number", conversion: "1" }]),
    ).toThrow(/function/i);
  });
});

describe("evaluateBundleApi", () => {
  it("shared items and params win over the source", () => {
    const shape = evaluateBundleApi(
      bundle({
        params: [{ name: "p", label: "P", type: "string" }],
        items: [{ name: "t", type: "number", conversion: "(r, raw) => raw" }],
        api: {
          source:
            '({ itemList: [{ name: "old", type: "string" }], params: [] })',
        },
      }),
    );
    expect(shape.itemList.map((item) => item.name)).toEqual(["t"]);
    expect(shape.params?.map((param) => param.name)).toEqual(["p"]);
  });
});

describe("templateBundleProblem", () => {
  it("accepts both, device-only, logic-only and API-only", () => {
    expect(templateBundleProblem(bundle(), [], [])).toBeNull();
    expect(
      templateBundleProblem(bundle({ logic: undefined }), [], []),
    ).toBeNull();
    expect(
      templateBundleProblem(bundle({ device: undefined }), [], []),
    ).toBeNull();
    expect(
      templateBundleProblem(
        bundle({
          device: undefined,
          logic: undefined,
          items: [{ name: "t", type: "number", readOnly: true }],
          api: {
            source:
              '({ readRequest: () => ({ url: "http://x" }), writeRequest: () => ({ url: "http://x" }) })',
          },
        }),
        [],
        [],
      ),
    ).toBeNull();
  });

  it("rejects no parts, bad ids/names and duplicate ids", () => {
    expect(
      templateBundleProblem(
        bundle({ device: undefined, logic: undefined }),
        [],
        [],
      ),
    ).toMatch(/part/i);
    expect(templateBundleProblem(bundle({ id: "" }), [], [])).toMatch(/id/i);
    expect(templateBundleProblem(bundle({ name: " " }), [], [])).toMatch(
      /name/i,
    );
    expect(templateBundleProblem(bundle(), ["tv"], [])).toMatch(/already/);
    expect(templateBundleProblem(bundle(), ["tv"], [], "tv")).toBeNull();
  });

  it("rejects duplicate items and params", () => {
    expect(
      templateBundleProblem(
        bundle({
          items: [
            { name: "a", type: "number" },
            { name: "a", type: "number" },
          ],
        }),
        [],
        [],
      ),
    ).toMatch(/duplicate item/i);
    expect(
      templateBundleProblem(
        bundle({
          params: [
            { name: "a", label: "A", type: "number" },
            { name: "a", label: "B", type: "number" },
          ],
        }),
        [],
        [],
      ),
    ).toMatch(/duplicate param/i);
  });

  it("accepts an API-only param and ignores it in the logic part", () => {
    expect(
      templateBundleProblem(
        bundle({
          params: [{ name: "onlyApi", label: "Only API", type: "string" }],
        }),
        [],
        [],
      ),
    ).toBeNull();
  });

  it("rejects a broken device part and a broken API source", () => {
    expect(
      templateBundleProblem(
        bundle({ device: { type: "Nope", features: [], slots: [] } }),
        [],
        [],
      ),
    ).toMatch(/unknown/i);
    expect(
      templateBundleProblem(bundle({ api: { source: "1 +" } }), [], []),
    ).toBeTruthy();
  });
});

describe("part helpers", () => {
  it("copies a visual template into a device part", () => {
    const part = devicePartFromTemplate({
      id: "x",
      name: "X",
      type: "Light",
      features: [],
      slots: [],
      builtin: true,
    });
    expect(part).toEqual({ type: "Light", features: [], slots: [] });
  });

  it("copies a logic template into a logic part", () => {
    const body = {
      id: "l",
      name: "L",
      kind: "function" as const,
      inputs: {},
      output: { scope: "memory" as const },
      expr: { code: "noop()" },
    };
    expect(
      logicPartFromTemplate({ id: "l", name: "L", params: [], logic: body }),
    ).toEqual({ logic: body });
  });
});
