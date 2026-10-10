import { describe, it, expect } from "vitest";
import {
  SEED_TEMPLATES,
  seedLibrary,
  applyTemplate,
  syncFormulaId,
  detachTemplate,
  migrateLibrary,
} from "$lib/config/formulas";
import type { Control } from "$lib/types/device";

describe("SEED_TEMPLATES", () => {
  it("ships five examples", () => {
    expect(SEED_TEMPLATES).toHaveLength(5);
  });
  it("dew point uses the real Magnus formula", () => {
    const dew = SEED_TEMPLATES.find((t) => t.name === "Dew point");
    expect(dew?.expr).toContain("Math.log");
    expect(dew?.unit).toBe("°C");
    expect(dew?.precision).toBe(1);
  });
});

describe("seedLibrary", () => {
  it("returns a fresh library with the seed templates", () => {
    const lib = seedLibrary();
    expect(lib.formulas).toHaveLength(5);
    expect(lib.version).toBe(0);
  });
});

const tpl = {
  id: "t1",
  name: "Dew point",
  expr: "a - b",
  precision: 1,
  unit: "°C",
  notes: "x",
};

describe("applyTemplate", () => {
  it("copies expr/precision/unit and sets formulaId", () => {
    const c: Control = {
      id: "c",
      kind: "virtual",
      feature: "value",
      writable: false,
    };
    const out = applyTemplate(c, tpl);
    expect(out.virtual).toEqual({ expr: "a - b", precision: 1 });
    expect(out.unit).toBe("°C");
    expect(out.formulaId).toBe("t1");
  });
});

describe("syncFormulaId", () => {
  const lib = { version: 0, updatedAt: 0, formulas: [tpl] };
  it("keeps formulaId while the expression still matches", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a - b" },
      formulaId: "t1",
    };
    expect(syncFormulaId(c, lib).formulaId).toBe("t1");
  });
  it("clears formulaId when the expression changed", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a + b" },
      formulaId: "t1",
    };
    expect(syncFormulaId(c, lib).formulaId).toBeUndefined();
  });
  it("clears a dangling formulaId", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a - b" },
      formulaId: "gone",
    };
    expect(syncFormulaId(c, lib).formulaId).toBeUndefined();
  });
});

describe("detachTemplate", () => {
  it("removes formulaId but keeps the expression", () => {
    const c: Control = {
      id: "c",
      feature: "value",
      writable: false,
      virtual: { expr: "a - b" },
      formulaId: "t1",
    };
    const out = detachTemplate(c);
    expect(out.formulaId).toBeUndefined();
    expect(out.virtual?.expr).toBe("a - b");
  });
});

describe("migrateLibrary", () => {
  it("parses a JSON string and keeps well-formed entries", () => {
    const raw = JSON.stringify({
      version: 2,
      formulas: [{ id: "a", name: "A", expr: "1" }, { bad: true }],
    });
    const lib = migrateLibrary(raw);
    expect(lib.version).toBe(2);
    expect(lib.formulas).toHaveLength(1);
    expect(lib.formulas[0].id).toBe("a");
  });
  it("unwraps a { val } state and tolerates garbage", () => {
    expect(migrateLibrary({ val: "{not json" }).formulas).toEqual([]);
    expect(migrateLibrary(null).formulas).toEqual([]);
  });
});
