import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ sendTo: vi.fn() }));

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: true,
    namespace: "ihome.0",
    sendTo: h.sendTo,
  },
}));

import {
  applyCollection,
  installPlugin,
  restoreCollection,
} from "./plugins.svelte";

it("returns install conflicts and applies an overwrite", async () => {
  const conflicts = [
    { kind: "logic", id: "calc", reason: "modified" as const },
  ];
  h.sendTo.mockResolvedValueOnce({
    ok: true,
    result: { plugins: [], collection: { id: "col.test", conflicts } },
  });
  expect(await installPlugin("col.test")).toEqual(conflicts);
  expect(h.sendTo).toHaveBeenCalledWith("ihome.0", "plugins", {
    action: "install",
    id: "col.test",
  });

  h.sendTo.mockResolvedValueOnce({
    ok: true,
    result: { plugins: [], collection: { id: "col.test", conflicts: [] } },
  });
  expect(await applyCollection("col.test", true)).toEqual([]);
  expect(h.sendTo).toHaveBeenLastCalledWith("ihome.0", "plugins", {
    action: "collection.apply",
    id: "col.test",
    overwrite: true,
  });

  h.sendTo.mockResolvedValueOnce({
    ok: true,
    result: { plugins: [], collection: { id: "col.test", conflicts: [] } },
  });
  expect(await restoreCollection("col.test")).toEqual([]);
  expect(h.sendTo).toHaveBeenLastCalledWith("ihome.0", "plugins", {
    action: "collection.apply",
    id: "col.test",
    restore: true,
  });
});
