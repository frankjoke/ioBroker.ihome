import { it, expect, vi } from "vitest";
import type { Device } from "$lib/types/device";

const PAGE_LIST_ID = "ihome.0.config.pageList";
const PAGE_BACKUP_ID = "ihome.0.config.pageListV1";

const h = vi.hoisted(() => {
  const state = { pageRaw: null as unknown, backup: null as unknown };
  const getState = vi.fn(async (id: string) =>
    id === "ihome.0.config.pageList"
      ? { val: state.pageRaw }
      : id === "ihome.0.config.pageListV1" && state.backup !== null
        ? { val: state.backup }
        : null,
  );
  const setState = vi.fn(async (id: string, value: unknown) => {
    if (id === "ihome.0.config.pageList") state.pageRaw = value;
    if (id === "ihome.0.config.pageListV1") state.backup = value;
  });
  return { state, getState, setState };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: true,
    getState: h.getState,
    setState: h.setState,
    getObject: vi.fn(async () => ({})),
    emitAsync: vi.fn(async () => ({})),
    wait: vi.fn(async () => {}),
    states: new Map(),
    objects: new Map(),
    enums: new Map(),
  },
}));

import { migrateLayout } from "./pages.svelte";

const v1 = {
  version: 1,
  updatedAt: 1,
  pages: [
    {
      id: "p",
      title: "P",
      groups: [
        {
          id: "g",
          tiles: [
            {
              id: "t",
              device: "light",
              tile: { slots: [{ kind: "switch", source: "power" }] },
            },
          ],
        },
      ],
    },
  ],
};

const light = {
  id: "light",
  name: "Lamp",
  type: "Light",
  controls: [
    { id: "c1", feature: "power", stateId: "light.0.power", writable: true },
  ],
} as Device;

it("an empty re-read leaves the seed in memory and writes nothing", async () => {
  // First: nothing was loaded yet (the seed-overwrite race). The guard must
  // re-read the broker and refuse to commit the in-memory seed.
  h.state.pageRaw = "";
  h.state.backup = null;

  expect(await migrateLayout([light], [])).toBe(false);
  expect(h.setState).not.toHaveBeenCalled();
});

it("re-reads the stored v1 document before migrating a seed", async () => {
  h.state.pageRaw = v1;
  h.state.backup = null;

  expect(await migrateLayout([light], [])).toBe(true);

  // The backup is the document as stored, written before the v2 commit.
  expect(JSON.parse(String(h.state.backup))).toEqual(v1);

  // The commit is debounced by savePages.
  await new Promise((r) => setTimeout(r, 350));
  const saved = JSON.parse(String(h.state.pageRaw));
  expect(saved.version).toBe(2);
  expect(saved.pages[0].groups[0].tiles[0].device).toBeUndefined();
  expect(saved.pages[0].groups[0].tiles[0].tile.slots[0].source).toEqual({
    kind: "control",
    device: "light",
    control: "c1",
  });
  expect(h.setState).toHaveBeenCalledWith(PAGE_BACKUP_ID, JSON.stringify(v1));
  expect(h.setState).toHaveBeenCalledWith(PAGE_LIST_ID, expect.any(String));
});
