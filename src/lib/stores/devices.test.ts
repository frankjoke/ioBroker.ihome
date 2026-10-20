import { it, expect, beforeEach } from "vitest";
import {
  getDevicesEnriched,
  getUsedStateIds,
  setCanonicalRegistry,
  setObjectSource,
} from "$lib/stores/devices.svelte";

beforeEach(() => {
  // A fresh registry object invalidates the module's cache identity check.
  setCanonicalRegistry({ version: 0, updatedAt: 0, devices: [] });
  setObjectSource(null);
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
            kind: "value",
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

it("resolves the device icon from the broker hierarchy (A65)", () => {
  setObjectSource(
    new Map([
      ["alias.0.Ch", { common: { icon: "data:image/svg+xml;base64,AA" } }],
      ["system.adapter.b.0", { common: { extIcon: "https://x/b.png" } }],
    ]) as any,
  );
  setCanonicalRegistry({
    version: 0,
    updatedAt: 0,
    devices: [
      {
        id: "d1",
        name: "D1",
        type: "Value",
        controls: [
          {
            id: "c1",
            feature: "v",
            writable: false,
            stateId: "alias.0.Ch.X",
          },
        ],
      },
      {
        id: "d2",
        name: "D2",
        type: "Value",
        controls: [
          { id: "c2", feature: "v", writable: false, stateId: "b.0.Other.Y" },
        ],
      },
      {
        id: "d3",
        name: "D3",
        type: "Value",
        icon: "widgets",
        controls: [
          {
            id: "c3",
            feature: "v",
            writable: false,
            stateId: "alias.0.Ch.X",
          },
        ],
      },
      {
        id: "d4",
        name: "D4",
        type: "Value",
        controls: [
          { id: "c4", feature: "v", writable: false, stateId: "nothing.here" },
        ],
      },
    ],
  });

  const devices = getDevicesEnriched();
  expect(devices[0].objectIcon).toBe("data:image/svg+xml;base64,AA");
  expect(devices[1].objectIcon).toBe("https://x/b.png");
  // The document's own icon still wins.
  expect(devices[2].objectIcon).toBe("widgets");
  // Nothing resolves: no icon at all, not an empty string.
  expect(devices[3].objectIcon).toBeUndefined();
});
