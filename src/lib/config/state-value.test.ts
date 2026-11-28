import { describe, expect, it } from "vitest";
import { parseValueText, valueText } from "./state-value";

describe("valueText", () => {
  it("renders primitives as text", () => {
    expect(valueText(undefined)).toBe("");
    expect(valueText(null)).toBe("null");
    expect(valueText(true)).toBe("true");
    expect(valueText(12)).toBe("12");
    expect(valueText("hello")).toBe("hello");
  });

  it("pretty-prints objects and arrays", () => {
    expect(valueText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(valueText([1, 2])).toBe("[\n  1,\n  2\n]");
  });
});

describe("parseValueText", () => {
  it("parses numbers and multistate values", () => {
    expect(parseValueText(" 12.5 ", "number")).toEqual({
      ok: true,
      value: 12.5,
    });
    expect(parseValueText("2", "multistate")).toEqual({ ok: true, value: 2 });
    expect(parseValueText("", "number")).toEqual({
      ok: false,
      error: "Enter a number.",
    });
    expect(parseValueText("abc", "number")).toEqual({
      ok: false,
      error: "Enter a valid number.",
    });
  });

  it("parses booleans", () => {
    expect(parseValueText("true", "boolean")).toEqual({
      ok: true,
      value: true,
    });
    expect(parseValueText("FALSE", "boolean")).toEqual({
      ok: true,
      value: false,
    });
    expect(parseValueText("yes", "boolean")).toEqual({
      ok: false,
      error: "Enter true or false.",
    });
  });

  it("writes strings unchanged", () => {
    expect(parseValueText("", "string")).toEqual({ ok: true, value: "" });
    expect(parseValueText("hello", "string")).toEqual({
      ok: true,
      value: "hello",
    });
    expect(parseValueText("42", "string")).toEqual({ ok: true, value: "42" });
  });

  it("parses object, array and json values", () => {
    expect(parseValueText('{"a":1}', "object")).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(parseValueText("[1,2]", "array")).toEqual({
      ok: true,
      value: [1, 2],
    });
    expect(parseValueText('"text"', "json")).toEqual({
      ok: true,
      value: "text",
    });
    expect(parseValueText("null", "json")).toEqual({ ok: true, value: null });
  });

  it("rejects the wrong JSON shape and invalid JSON", () => {
    expect(parseValueText("[1]", "object")).toEqual({
      ok: false,
      error: "Enter a JSON object.",
    });
    expect(parseValueText("null", "object")).toEqual({
      ok: false,
      error: "Enter a JSON object.",
    });
    expect(parseValueText("{}", "array")).toEqual({
      ok: false,
      error: "Enter a JSON array.",
    });
    expect(parseValueText("{", "object")).toEqual({
      ok: false,
      error: "Enter valid JSON.",
    });
    expect(parseValueText("", "json")).toEqual({
      ok: false,
      error: "Enter JSON.",
    });
  });

  it("parses mixed values as JSON when possible and text otherwise", () => {
    expect(parseValueText("42", "mixed")).toEqual({ ok: true, value: 42 });
    expect(parseValueText('{"a":1}', "mixed")).toEqual({
      ok: true,
      value: { a: 1 },
    });
    expect(parseValueText("hello", "mixed")).toEqual({
      ok: true,
      value: "hello",
    });
    expect(parseValueText("", "mixed")).toEqual({ ok: true, value: "" });
  });

  it("falls back to text for unknown types", () => {
    expect(parseValueText("x", "weird")).toEqual({ ok: true, value: "x" });
  });
});
