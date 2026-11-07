import { describe, expect, it } from "vitest";
import {
  isFormulasWritable,
  setFormulasLoadKind,
} from "./formulas.svelte";

describe("formula store guards", () => {
  it("only allows writes after a successful or absent load", () => {
    setFormulasLoadKind("pending");
    expect(isFormulasWritable()).toBe(false);
    setFormulasLoadKind("unreadable");
    expect(isFormulasWritable()).toBe(false);
    setFormulasLoadKind("absent");
    expect(isFormulasWritable()).toBe(true);
    setFormulasLoadKind("loaded");
    expect(isFormulasWritable()).toBe(true);
  });
});
