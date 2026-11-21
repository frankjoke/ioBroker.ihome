import { expect, it } from "vitest";
import type {
  SettingsField,
  SettingsObjectSchema,
} from "$adapter/settings-schema";
import {
  itemDefaults,
  objectProblem,
  rowSummary,
  structuredValue,
  valueProblem,
  visibleFields,
} from "./schema-values";

it("reads legacy JSON strings and reports broken ones", () => {
  const arrayField: SettingsField = {
    name: "rows",
    label: "Rows",
    type: "array",
    item: "string",
  };
  expect(structuredValue(arrayField, '["a","b"]')).toEqual({
    value: ["a", "b"],
  });
  expect(structuredValue(arrayField, ["a"])).toEqual({ value: ["a"] });
  expect(structuredValue(arrayField, undefined)).toEqual({ value: [] });
  expect(structuredValue(arrayField, "nope")).toMatchObject({
    problem: /JSON/,
  });
});

it("validates required, select and exactlyOne", () => {
  const path: SettingsField = {
    name: "path",
    label: "Path",
    type: "string",
    required: true,
  };
  expect(valueProblem(path, "")).toMatch(/required/);
  expect(valueProblem(path, "/a")).toBeNull();
  const method: SettingsField = {
    name: "method",
    label: "Method",
    type: "select",
    options: ["GET", "POST"],
  };
  expect(valueProblem(method, "PUT")).toMatch(/GET/);
  const item: SettingsObjectSchema = {
    fields: [
      { name: "target", label: "Target", type: "string" },
      { name: "targets", label: "Targets", type: "array", item: "string" },
    ],
    exactlyOne: ["target", "targets"],
  };
  expect(objectProblem(item, {})).toMatch(/one/);
  expect(objectProblem(item, { target: "s", targets: ["x"] })).toMatch(/one/);
  expect(objectProblem(item, { target: "s" })).toBeNull();
});

it("defaults new rows and filters hidden fields", () => {
  expect(
    itemDefaults({
      fields: [
        { name: "method", label: "Method", type: "string", default: "GET" },
        { name: "enabled", label: "Enabled", type: "boolean", default: true },
      ],
    }),
  ).toEqual({ method: "GET", enabled: true });
  expect(
    visibleFields(
      [
        { name: "path", label: "Path", type: "string" },
        {
          name: "strip",
          label: "Strip",
          type: "boolean",
          visibleWhen: { field: "kind", equals: "proxy" },
        },
      ],
      { kind: "webhook" },
    ).map((field) => field.name),
  ).toEqual(["path"]);
  expect(
    rowSummary(
      [
        { name: "path", label: "Path", type: "string" },
        { name: "upstream", label: "Upstream", type: "string" },
      ],
      { path: "/a", upstream: "127.0.0.1:1" },
    ),
  ).toBe("/a · 127.0.0.1:1");
  expect(
    rowSummary(
      [
        { name: "path", label: "Path", type: "string" },
        { name: "token", label: "Token", type: "string" },
      ],
      { path: "/a", token: "secret" },
    ),
  ).toBe("/a");
});

it("skips required fields that are hidden for the current kind", () => {
  const schema: SettingsObjectSchema = {
    fields: [
      { name: "kind", label: "Kind", type: "string" },
      {
        name: "path",
        label: "Path",
        type: "string",
        required: true,
        visibleWhen: { field: "kind", equals: "proxy" },
      },
    ],
  };
  expect(objectProblem(schema, { kind: "site" })).toBeNull();
  expect(objectProblem(schema, { kind: "proxy" })).toMatch(/required/);
});
