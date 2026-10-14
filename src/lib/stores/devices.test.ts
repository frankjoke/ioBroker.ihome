import { it, expect, beforeEach } from "vitest";
import {
  getUsedStateIds,
  setCanonicalRegistry,
} from "$lib/stores/devices.svelte";

beforeEach(() => {
  // A fresh registry object invalidates the module's cache identity check.
  setCanonicalRegistry({ version: 0, updatedAt: 0, devices: [] });
});

it("includes watch and rule-referenced state ids", () => {
  setCanonicalRegistry({
    version: 0,
    updatedAt: 0,
    devices: [
      {
        id: "d",
        name: "D",
        type: "Value",
        watch: ["alias.0.EG.Relay.SET"],
        slots: [
          {
            kind: "icon",
            rules: [{ when: 'get("alias.0.EG.Slot") > 1' }],
          },
        ],
        controls: [
          {
            id: "c",
            feature: "v",
            writable: false,
            stateId: "alias.0.EG.Temp",
            rules: [{ when: "get('alias.0.EG.Other') > 1" }],
          },
        ],
      },
    ],
  });

  const ids = getUsedStateIds();
  expect(ids.has("alias.0.EG.Temp")).toBe(true);
  expect(ids.has("alias.0.EG.Relay.SET")).toBe(true);
  expect(ids.has("alias.0.EG.Other")).toBe(true);
  expect(ids.has("alias.0.EG.Slot")).toBe(true);
});

it("keeps the rule ids out of an empty registry", () => {
  expect([...getUsedStateIds()].some((id) => id.startsWith("alias."))).toBe(
    false,
  );
});
