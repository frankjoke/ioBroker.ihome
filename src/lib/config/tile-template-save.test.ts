import { expect, it } from "vitest";
import { planSaveTileTemplate } from "$lib/config/tile-template-save";
import type { SourceLook } from "$lib/config/slot-source";
import type { TemplateRegistry, TileConfig } from "$lib/types/display";

const look: SourceLook = {
  states: new Map([["alias.0.Lamp.SET", { val: true, ts: 0 }]]),
  objects: new Map<string, any>([
    [
      "alias.0.Lamp.SET",
      {
        type: "state",
        common: { name: "Lamp", role: "switch.light", type: "boolean" },
      },
    ],
  ]),
  variables: [],
};

const tile: TileConfig = {
  slots: [
    {
      kind: "switch",
      source: { kind: "state", stateId: "alias.0.Lamp.SET" },
      label: "Power",
    },
  ],
};

const empty: TemplateRegistry = { version: 0, updatedAt: 0, templates: [] };

it("adds the tile as a new role-bound template", () => {
  const result = planSaveTileTemplate(empty, tile, look, {
    id: "tpl-lamp",
    name: "Lamp",
    type: "Light",
    hint: "Pick the lamp switch.",
  });
  expect(result.error).toBeUndefined();
  expect(result.note).toBe("Saved “Lamp”.");
  expect(result.next?.templates).toHaveLength(1);
  expect(result.next?.templates[0]).toMatchObject({
    id: "tpl-lamp",
    name: "Lamp",
    type: "Light",
    stateHint: "Pick the lamp switch.",
    roles: ["switch_light"],
  });
  // The input registry is not mutated.
  expect(empty.templates).toHaveLength(0);
});

it("blocks a duplicate name regardless of case and spacing", () => {
  const registry: TemplateRegistry = {
    ...empty,
    templates: [
      { id: "old", name: "Lamp", type: "Light", slots: [], features: [] },
    ],
  };
  const result = planSaveTileTemplate(registry, tile, look, {
    id: "new",
    name: "  lamp  ",
    type: "Light",
  });
  expect(result.next).toBeUndefined();
  expect(result.error).toBe("A template named “  lamp  ” already exists.");
});

it("reports a tile whose slots match no role", () => {
  const result = planSaveTileTemplate(empty, { slots: [] }, look, {
    id: "tpl",
    name: "Empty",
    type: "Value",
  });
  expect(result.next).toBeUndefined();
  expect(result.error).toBe("No slot in this tile could be bound to a role.");
});
