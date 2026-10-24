import { describe, it, expect } from "vitest";
import {
  buildStateId,
  constantValues,
  convertValue,
  initialValue,
  isIhomeNamespace,
  migrateVariables,
  nameTaken,
  namespaceOptions,
  relativeIdFor,
  reservedName,
  resolveVariable,
  restrictName,
  splitStateId,
  validName,
  validStateId,
  variableLocals,
} from "$lib/config/variables";

describe("buildStateId", () => {
  it("joins a namespace and a relative path", () => {
    expect(buildStateId("ihome.0", "Variables.houseMode")).toBe(
      "ihome.0.Variables.houseMode",
    );
    expect(buildStateId(" 0_userdata.0 ", ".myVar.")).toBe(
      "0_userdata.0.myVar",
    );
  });
  it("returns empty for an incomplete pair", () => {
    expect(buildStateId("", "Variables.x")).toBe("");
    expect(buildStateId("ihome.0", "  ")).toBe("");
  });
});

describe("splitStateId", () => {
  it("splits at the adapter instance", () => {
    expect(splitStateId("ihome.0.Variables.houseMode")).toEqual({
      namespace: "ihome.0",
      relative: "Variables.houseMode",
    });
    expect(splitStateId("0_userdata.0.energy.price")).toEqual({
      namespace: "0_userdata.0",
      relative: "energy.price",
    });
  });
  it("returns empty for a too-short id", () => {
    expect(splitStateId("ihome.0")).toEqual({ namespace: "", relative: "" });
  });
});

describe("validStateId", () => {
  it("accepts adapter.instance.path", () => {
    expect(validStateId("ihome.0.Variables.x")).toBe(true);
    expect(validStateId("0_userdata.0.myVar")).toBe(true);
  });
  it("rejects blank parts and whitespace", () => {
    expect(validStateId("ihome.0")).toBe(false);
    expect(validStateId("ihome.0..x")).toBe(false);
    expect(validStateId("ihome.0.my var")).toBe(false);
  });
});

describe("convertValue", () => {
  it("parses numbers and booleans", () => {
    expect(convertValue(" 21.5 ", "number")).toEqual({ value: 21.5 });
    expect(convertValue("true", "boolean")).toEqual({ value: true });
    expect(convertValue("off", "boolean")).toEqual({ value: false });
  });
  it("keeps strings as written", () => {
    expect(convertValue(" true ", "string")).toEqual({ value: " true " });
  });
  it("reports bad input without throwing", () => {
    expect(convertValue("", "number").error).toBeTruthy();
    expect(convertValue("abc", "number").error).toBeTruthy();
    expect(convertValue("maybe", "boolean").error).toBeTruthy();
  });
});

describe("initialValue", () => {
  it("gives a new state a usable value", () => {
    expect(initialValue("number")).toBe(0);
    expect(initialValue("boolean")).toBe(false);
    expect(initialValue("string")).toBe("");
  });
});

describe("isIhomeNamespace", () => {
  it("recognises iHome instances only", () => {
    expect(isIhomeNamespace("ihome.0")).toBe(true);
    expect(isIhomeNamespace(" ihome.12 ")).toBe(true);
    expect(isIhomeNamespace("0_userdata.0")).toBe(false);
    expect(isIhomeNamespace("ihome")).toBe(false);
    expect(isIhomeNamespace("ihomes.0")).toBe(false);
  });
});

describe("relativeIdFor", () => {
  it("pins an iHome instance to its Variables folder", () => {
    expect(relativeIdFor("ihome.0", "myValue")).toBe("Variables.myValue");
    expect(relativeIdFor("ihome.0", "Variables.x")).toBe("Variables.x");
    expect(relativeIdFor("ihome.0", "config.deviceList")).toBe(
      "Variables.config.deviceList",
    );
    expect(relativeIdFor("ihome.0", "  ")).toBe("");
  });
  it("leaves another namespace alone", () => {
    expect(relativeIdFor("0_userdata.0", ".myValue.")).toBe("myValue");
    expect(relativeIdFor("javascript.0", "scriptValue")).toBe("scriptValue");
  });
});

describe("restrictName / validName", () => {
  it("replaces dots and spaces, collapsing runs", () => {
    expect(restrictName("Outside temp")).toBe("Outside_temp");
    expect(restrictName("my.value")).toBe("my_value");
    // Live typing must keep a trailing underscore, so the function does not
    // trim — the migration trims a *persisted* name instead.
    expect(restrictName("  Außentemperatur  ")).toBe("_Au_entemperatur_");
    expect(restrictName("a   b")).toBe("a_b");
  });
  it("prefixes a leading digit so the name is an identifier", () => {
    expect(restrictName("1st")).toBe("v_1st");
    expect(restrictName("2")).toBe("v_2");
  });
  it("accepts only names with a letter or digit", () => {
    expect(validName("Outside_temp")).toBe(true);
    expect(validName("_")).toBe(false);
    expect(validName("")).toBe(false);
  });
});

describe("reservedName", () => {
  it("refuses the expression helpers, keywords and the tile's active", () => {
    expect(reservedName("sum")).toBe(true);
    expect(reservedName("Get")).toBe(true);
    expect(reservedName("active")).toBe(true);
    expect(reservedName("return")).toBe(true);
    expect(reservedName("gas_price")).toBe(false);
  });
});

describe("nameTaken", () => {
  const list = [
    {
      id: "a",
      name: "Outside_temp",
      kind: "constant" as const,
      type: "number",
    },
    { id: "b", name: "mode", kind: "constant" as const, type: "string" },
  ];
  it("is case-insensitive and skips the entry being edited", () => {
    expect(nameTaken(list, "outside_TEMP")).toBe(true);
    expect(nameTaken(list, "outside_temp", "a")).toBe(false);
    expect(nameTaken(list, "fresh_name")).toBe(false);
  });
});

describe("resolveVariable", () => {
  const list = [
    {
      id: "a",
      name: "Outside_temp",
      kind: "state" as const,
      type: "number",
      stateId: "ihome.0.Variables.outsideTemp",
    },
    {
      id: "b",
      name: "gas_price",
      kind: "constant" as const,
      type: "number",
      value: "0.35",
    },
    {
      id: "c",
      name: "broken",
      kind: "constant" as const,
      type: "number",
      value: "abc",
    },
    { id: "d", name: "no_state", kind: "state" as const, type: "mixed" },
  ];
  it("resolves a bare name to the state behind it", () => {
    expect(resolveVariable("Outside_temp", list)).toEqual({
      kind: "state",
      stateId: "ihome.0.Variables.outsideTemp",
    });
  });
  it("resolves a constant to its typed value", () => {
    expect(resolveVariable("gas_price", list)).toEqual({
      kind: "constant",
      value: 0.35,
    });
  });
  it("never treats a dotted id as a variable", () => {
    expect(resolveVariable("ihome.0.Variables.outsideTemp", list)).toBeNull();
    expect(resolveVariable("Outside_temp", list)).not.toBeNull();
  });
  it("returns null for unknown, stateless and malformed entries", () => {
    expect(resolveVariable("nothing", list)).toBeNull();
    expect(resolveVariable("no_state", list)).toBeNull();
    expect(resolveVariable("broken", list)).toBeNull();
    expect(resolveVariable("", list)).toBeNull();
  });
});

describe("variableLocals", () => {
  it("gives constants their value and state variables their live value", () => {
    const locals = variableLocals(
      [
        {
          id: "a",
          name: "gas_price",
          kind: "constant",
          type: "number",
          value: "0.35",
        },
        {
          id: "b",
          name: "Outside_temp",
          kind: "state",
          type: "number",
          stateId: "ihome.0.Variables.outsideTemp",
        },
      ],
      (id) => (id === "ihome.0.Variables.outsideTemp" ? 21.5 : undefined),
    );
    expect(locals).toEqual([
      { key: "gas_price", value: 0.35 },
      { key: "Outside_temp", value: 21.5 },
    ]);
  });
});

describe("constantValues", () => {
  it("materialises constants as typed values, states only named", () => {
    const values = constantValues([
      {
        id: "a",
        name: "gas_price",
        kind: "constant",
        type: "number",
        value: "0.35",
        unit: "€/kWh",
      },
      {
        id: "b",
        name: "House_mode",
        kind: "constant",
        type: "string",
        value: "home",
      },
      {
        id: "c",
        name: "Away",
        kind: "constant",
        type: "boolean",
        value: "off",
      },
      {
        id: "d",
        name: "Outside_temp",
        kind: "state",
        type: "number",
        stateId: "ihome.0.Variables.outsideTemp",
      },
    ]);
    expect(values).toHaveLength(3);
    expect(values[0]).toMatchObject({
      id: "a",
      key: "gas_price",
      value: 0.35,
      unit: "€/kWh",
    });
    expect(values[1].value).toBe("home");
    expect(values[2].value).toBe(false);
  });
  it("drops a value that cannot be read as its type", () => {
    const values = constantValues([
      {
        id: "a",
        name: "Broken",
        kind: "constant",
        type: "number",
        value: "abc",
      },
    ]);
    expect(values[0].value).toBeUndefined();
  });
});

describe("namespaceOptions", () => {
  it("offers the current namespace, 0_userdata and discovered instances", () => {
    const objects = new Map<string, unknown>([
      ["system.adapter.admin.0", {}],
      ["system.adapter.javascript.2", {}],
      ["system.adapter.javascript", {}],
      ["ihome.0.Variables.x", {}],
    ]);
    expect(namespaceOptions(objects, "ihome.0")).toEqual([
      "0_userdata.0",
      "admin.0",
      "ihome.0",
      "javascript.2",
    ]);
  });
});

describe("migrateVariables", () => {
  it("parses a JSON document and keeps valid entries", () => {
    const lib = migrateVariables(
      JSON.stringify({
        version: 3,
        variables: [
          {
            id: "a",
            name: "Mode",
            kind: "constant",
            type: "string",
            value: "home",
          },
          { id: "b", kind: "state", stateId: "ihome.0.Variables.x" },
          { name: "no id" },
        ],
      }),
    );
    expect(lib.version).toBe(3);
    expect(lib.variables).toHaveLength(2);
    expect(lib.variables[1]).toMatchObject({
      kind: "state",
      type: "mixed",
      stateId: "ihome.0.Variables.x",
    });
  });
  it("survives junk", () => {
    expect(migrateVariables("not json").variables).toEqual([]);
    expect(migrateVariables(null).variables).toEqual([]);
  });
  it("cleans an older name into a reference and keeps the object settings", () => {
    const lib = migrateVariables({
      variables: [
        {
          id: "a",
          name: " Outside temp ",
          kind: "state",
          type: "number",
          stateId: "ihome.0.Variables.outsideTemp",
          role: "value.temperature",
          enums: ["enum.rooms.Küche", 7],
          min: 0,
          max: 50,
          step: 0.5,
        },
      ],
    });
    expect(lib.variables[0]).toMatchObject({
      name: "Outside_temp",
      role: "value.temperature",
      enums: ["enum.rooms.Küche"],
      min: 0,
      max: 50,
      step: 0.5,
    });
  });
});
