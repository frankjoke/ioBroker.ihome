import { expect, it } from "vitest";
import {
  parseSettingsSchema,
  parseSettingsTabs,
  settingsProblem,
} from "./settings-schema";

it("parses nested objects, arrays and tabs", () => {
  const schema = parseSettingsSchema([
    { name: "port", label: "Port", type: "number" },
    {
      name: "endpoints",
      label: "Endpoints",
      type: "array",
      item: {
        fields: [
          { name: "path", label: "Path", type: "string", required: true },
          { name: "target", label: "Target", type: "string" },
          {
            name: "targets",
            label: "Targets",
            type: "array",
            item: {
              fields: [{ name: "state", label: "State", type: "string" }],
            },
          },
        ],
        exactlyOne: ["target", "targets"],
      },
    },
  ]);
  expect(schema).toHaveLength(2);
  expect(schema?.[1].item).toMatchObject({
    exactlyOne: ["target", "targets"],
  });
  expect(
    parseSettingsTabs(
      [{ id: "endpoints", label: "Endpoints", fields: ["endpoints"] }],
      schema!,
    ),
  ).toEqual([{ id: "endpoints", label: "Endpoints", fields: ["endpoints"] }]);
});

it("rejects malformed schemas whole", () => {
  expect(
    parseSettingsSchema([{ name: "x", label: "X", type: "magic" }]),
  ).toBeUndefined();
  expect(
    parseSettingsSchema([{ name: "x", label: "", type: "string" }]),
  ).toBeUndefined();
  expect(
    parseSettingsSchema([
      {
        name: "a",
        label: "A",
        type: "object",
        fields: [
          { name: "a", label: "A", type: "string" },
          { name: "a", label: "A again", type: "string" },
        ],
      },
    ]),
  ).toBeUndefined(); // duplicate name inside the object
  expect(
    parseSettingsTabs([{ id: "help", label: "Nope", fields: [] }], []),
  ).toBeUndefined();
  const fields = [{ name: "a", label: "A", type: "string" }] as const;
  expect(
    parseSettingsTabs(
      [{ id: "x", label: "X", fields: ["missing"] }],
      [...fields],
    ),
  ).toBeUndefined();
  expect(
    parseSettingsTabs(
      [
        { id: "x", label: "X", fields: ["a"] },
        { id: "y", label: "Y", fields: ["a"] },
      ],
      [...fields],
    ),
  ).toBeUndefined();
});

it("validates nested settings and exactlyOne", () => {
  const schema = parseSettingsSchema([
    {
      name: "endpoints",
      label: "Endpoints",
      type: "array",
      item: {
        fields: [
          { name: "path", label: "Path", type: "string", required: true },
          { name: "target", label: "Target", type: "string" },
          {
            name: "targets",
            label: "Targets",
            type: "array",
            item: {
              fields: [{ name: "state", label: "State", type: "string" }],
            },
          },
        ],
        exactlyOne: ["target", "targets"],
      },
    },
  ])!;
  expect(
    settingsProblem(schema, {
      endpoints: [{ path: "/a", targets: [{ state: "x" }] }],
    }),
  ).toBeNull();
  expect(settingsProblem(schema, { endpoints: [{ path: "/a" }] })).toMatch(
    /target/,
  );
  expect(
    settingsProblem(schema, {
      endpoints: [{ path: "/a", target: "s", targets: [{ state: "x" }] }],
    }),
  ).toMatch(/one/);
  expect(
    settingsProblem(schema, { endpoints: '[{"path":"/a","target":"s"}]' }),
  ).toBeNull(); // legacy JSON string
  expect(settingsProblem(schema, { endpoints: "not json" })).toMatch(/JSON/);
});
