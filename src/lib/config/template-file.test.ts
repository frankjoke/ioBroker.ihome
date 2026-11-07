import { describe, expect, it } from "vitest";
import {
  parseTemplateFile,
  prepareTemplateImport,
  serializeTemplateFile,
  templateExport,
  templateFile,
  templateGroup,
} from "./template-file";

const formula = {
  id: "dew",
  name: "Dew point",
  expr: "1 + 1",
  unit: "°C",
  precision: 1,
  notes: "x",
};
const snippet = {
  id: "snippet",
  name: "Snippet",
  mode: "expression" as const,
  code: "1 + 1",
  description: "d",
};
const device = {
  id: "lamp",
  name: "Lamp",
  type: "Light",
  features: [],
  slots: [],
  basedOn: "Light",
  size: { w: 2, h: 2 },
  builtin: true,
};
const logic = {
  id: "logic",
  name: "Logic",
  params: [],
  logic: {
    id: "",
    name: "",
    kind: "function" as const,
    inputs: {},
    output: { scope: "memory" as const },
    expr: { code: "noop()" },
  },
};
const api = {
  id: "api",
  name: "API",
  source:
    '({ itemList: [{ name: "x", type: "number", readOnly: true }], readRequest: () => ({ url: "" }), writeRequest: () => ({ url: "" }) })',
};
const bundle = {
  id: "bundle",
  name: "Bundle",
  items: [],
  device: { type: "Custom", features: [], slots: [] },
};

const kinds = [
  ["formula", formula],
  ["snippet", snippet],
  ["device", device],
  ["logic", logic],
  ["api", api],
  ["bundle", bundle],
] as const;

describe("templateFile round trip", () => {
  it("round-trips every kind through serialize and parse", () => {
    for (const [kind, definition] of kinds) {
      const text = serializeTemplateFile(templateFile(kind, definition));
      const parsed = parseTemplateFile(text);
      expect("file" in parsed).toBe(true);
      if ("file" in parsed) {
        expect(parsed.file.kind).toBe(kind);
        expect(parsed.file.definition).toEqual(definition);
      }
    }
  });

  it("accepts a one-part bundle", () => {
    for (const only of [
      {
        id: "b1",
        name: "API only",
        items: [{ name: "x", type: "number" as const, readOnly: true }],
        api: {
          source:
            '({ readRequest: () => ({ url: "" }), writeRequest: () => ({ url: "" }) })',
        },
      },
      {
        id: "b2",
        name: "Device only",
        device: { type: "Custom", features: [], slots: [] },
      },
    ]) {
      expect("file" in parseTemplateFile(templateFile("bundle", only))).toBe(
        true,
      );
    }
  });

  it("refuses malformed JSON, wrappers and cross-kind definitions", () => {
    expect(parseTemplateFile("nope")).toEqual({
      problem: "The file is not valid JSON.",
    });
    expect(parseTemplateFile(null)).toMatchObject({
      problem: expect.stringMatching(/template object/i),
    });
    expect(
      parseTemplateFile({
        format: "other",
        version: 1,
        kind: "formula",
        definition: formula,
      }),
    ).toMatchObject({ problem: expect.stringMatching(/not an iHome/i) });
    expect(
      parseTemplateFile({
        format: "ihome-template",
        version: 2,
        kind: "formula",
        definition: formula,
      }),
    ).toMatchObject({ problem: expect.stringMatching(/version/i) });
    expect(
      parseTemplateFile({
        format: "ihome-template",
        version: 1,
        kind: "nope",
        definition: formula,
      }),
    ).toMatchObject({ problem: expect.stringMatching(/kind/i) });
    expect(parseTemplateFile(templateFile("formula", snippet))).toMatchObject({
      problem: expect.stringMatching(/expression/i),
    });
    expect(
      parseTemplateFile(templateFile("snippet", { ...snippet, code: "1 +" })),
    ).toMatchObject({ problem: expect.any(String) });
    expect(
      parseTemplateFile(templateFile("bundle", { id: "b", name: "B" })),
    ).toMatchObject({ problem: expect.stringMatching(/part/i) });
  });
});

describe("prepareTemplateImport", () => {
  it("keeps a free id and renames a taken one", () => {
    const free = prepareTemplateImport("formula", formula, ["other"]);
    expect(free.id).toBe("dew");
    expect(free.renamed).toBe(false);
    expect(free.definition.name).toBe("Dew point");

    const taken = prepareTemplateImport("formula", formula, ["dew"]);
    expect(taken.id).not.toBe("dew");
    expect(taken.renamed).toBe(true);
    expect(taken.definition.name).toBe("Dew point (imported)");
  });

  it("imports a built-in device as a user copy", () => {
    const result = prepareTemplateImport("device", device, ["lamp"]);
    expect(result.definition.builtin).toBe(false);
    expect(result.definition.name).toBe("Lamp (imported)");
  });
});

describe("export payload", () => {
  it("builds a pretty file name and text", () => {
    const payload = templateExport("formula", formula);
    expect(payload.fileName).toBe("ihome-formula-dew-point.json");
    expect(payload.text).toContain('"format": "ihome-template"');
    expect(payload.text.endsWith("\n")).toBe(true);
  });

  it("maps kinds to the page groups", () => {
    expect(templateGroup("formula")).toBe("code");
    expect(templateGroup("snippet")).toBe("code");
    for (const kind of ["device", "logic", "api", "bundle"] as const) {
      expect(templateGroup(kind)).toBe("templates");
    }
  });
});
