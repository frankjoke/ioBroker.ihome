import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    calls: [] as { kind: string; id?: string; value?: string }[],
    registry: { version: 1, updatedAt: 0, overrides: [] as any[] },
    failBackup: "",
    pagesOk: true,
    templatesOk: true,
  };
  return {
    state,
    OVERRIDE_LIST: "ihome.0.config.overrideList",
    PAGE_LIST: "ihome.0.config.pageList",
    TEMPLATE_LIST: "ihome.0.config.templateList",
    devices: [
      {
        id: "light",
        name: "Lamp",
        type: "Light",
        controls: [
          {
            id: "c1",
            feature: "power",
            stateId: "hm.0.light.power",
            writable: true,
          },
        ],
      },
    ],
    pages: {
      version: 2,
      updatedAt: 4,
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
                  tile: {
                    slots: [
                      {
                        kind: "switch",
                        source: {
                          kind: "control",
                          device: "light",
                          control: "c1",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    templates: {
      version: 1,
      updatedAt: 4,
      templates: [
        {
          id: "tpl",
          name: "Tpl",
          type: "Light",
          features: [
            {
              feature: "power",
              label: "Power",
              widget: "switch",
              roleHints: ["switch.light"],
            },
          ],
          slots: [{ kind: "switch", source: "power" }],
        },
      ],
    },
  };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    namespace: "ihome.0",
    connected: true,
    objects: new Map(),
    getObject: vi.fn(async () => ({})),
    emitAsync: vi.fn(async () => ({})),
    getState: vi.fn(async (id: string) => {
      if (id === "ihome.0.config.deviceList") {
        return {
          val: JSON.stringify({ version: 1, updatedAt: 1, devices: h.devices }),
        };
      }
      if (id === h.PAGE_LIST) return { val: JSON.stringify(h.pages) };
      if (id === h.TEMPLATE_LIST) {
        // The legacy state is stale on upgraded installs (files are the truth).
        return {
          val: JSON.stringify({ version: 0, updatedAt: 0, templates: [] }),
        };
      }
      return null;
    }),
    setState: vi.fn(async (id: string, value: string) => {
      h.state.calls.push({ kind: "write", id, value });
      if (id === h.state.failBackup) throw new Error("backup unavailable");
    }),
  },
}));

vi.mock("$lib/registry.svelte.js", () => ({
  isRegistryWritable: () => true,
}));

vi.mock("$lib/stores/devices.svelte", () => ({
  deviceListId: () => "ihome.0.config.deviceList",
  getCanonicalRegistry: () => ({
    version: 1,
    updatedAt: 1,
    devices: h.devices,
  }),
}));

vi.mock("$lib/stores/pages.svelte", () => ({
  pageListId: () => h.PAGE_LIST,
  getPageRegistry: () => h.pages,
  isLayoutWritable: () => true,
  commitLayoutNow: async () => {
    h.state.calls.push({ kind: "pages" });
    return h.state.pagesOk;
  },
}));

vi.mock("$lib/stores/templates.svelte", () => ({
  TEMPLATE_LIST_ID: h.TEMPLATE_LIST,
  getTemplateRegistry: () => h.templates,
  isTemplatesWritable: () => true,
  commitTemplatesNow: async () => {
    h.state.calls.push({ kind: "templates" });
    return h.state.templatesOk;
  },
}));

vi.mock("$lib/stores/overrides.svelte", () => ({
  OVERRIDE_LIST_ID: h.OVERRIDE_LIST,
  getOverrideRegistry: () => h.state.registry,
  isOverridesWritable: () => true,
  commitOverrides: async (next: any) => {
    h.state.calls.push({ kind: "overrides", value: JSON.stringify(next) });
    h.state.registry = { ...next, updatedAt: h.state.registry.updatedAt + 1 };
    return "saved";
  },
}));

vi.mock("$lib/stores/variables.svelte", () => ({
  getVariableLibrary: () => ({ variables: [] }),
}));

vi.mock("$lib/stores/toasts.svelte", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import {
  applyDeviceMigration,
  deviceBackupId,
  dryRunDeviceMigration,
  pageMigrationBackupId,
  templateBackupId,
} from "./device-migration.svelte";
import { toast } from "$lib/stores/toasts.svelte";

function reset(over: Partial<typeof h.state> = {}) {
  h.state.calls = [];
  h.state.failBackup = "";
  h.state.pagesOk = true;
  h.state.templatesOk = true;
  h.state.registry = { version: 1, updatedAt: 0, overrides: [] };
  Object.assign(h.state, over);
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
}

describe("device migration runner", () => {
  it("the dry run reads and reports without writing", async () => {
    reset();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const run = await dryRunDeviceMigration();
    info.mockRestore();
    expect(run.status).toBe("ready");
    expect(run.changed).toBe(true);
    expect(h.state.calls).toEqual([]);
  });

  it("refuses to write without confirmation", async () => {
    reset();
    const run = await applyDeviceMigration(false);
    expect(run.status).toBe("skipped");
    expect(h.state.calls).toEqual([]);
  });

  it("backs up first, then writes overrides, pages, templates and the marker", async () => {
    reset();
    const run = await applyDeviceMigration(true);
    expect(run.status).toBe("applied");
    expect(h.state.calls.map((call) => call.kind)).toEqual([
      "write",
      "write",
      "write",
      "overrides",
      "pages",
      "templates",
      "overrides",
    ]);
    expect(h.state.calls.slice(0, 3).map((call) => call.id)).toEqual([
      deviceBackupId(),
      pageMigrationBackupId(),
      templateBackupId(),
    ]);
    // Templates are file-backed: the backup is the loaded registry, never the
    // stale legacy state.
    expect(JSON.parse(h.state.calls[2].value!)).toEqual(h.templates);
    const stored = h.state.calls[3].value;
    expect(stored).toContain('"mig-light-c1"');
    const marker = h.state.calls[6].value;
    expect(marker).toContain('"migratedDevices":true');
    expect(marker).toContain('"mig-light-c1"');
    expect(toast.success).toHaveBeenCalled();
  });

  it("a failed backup stops before any document write", async () => {
    reset({ failBackup: pageMigrationBackupId() });
    const run = await applyDeviceMigration(true);
    expect(run.status).toBe("failed");
    expect(h.state.calls.map((call) => call.kind)).toEqual(["write", "write"]);
    expect(h.state.calls.some((call) => call.kind === "overrides")).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it("a failed page write leaves the marker unset", async () => {
    reset({ pagesOk: false });
    const run = await applyDeviceMigration(true);
    expect(run.status).toBe("failed");
    expect(
      h.state.calls.filter((call) => call.kind === "overrides"),
    ).toHaveLength(1);
    expect(
      h.state.calls.some(
        (call) =>
          call.kind === "overrides" && call.value?.includes("migratedDevices"),
      ),
    ).toBe(false);
  });

  it("does nothing once the marker is set", async () => {
    reset({
      registry: {
        version: 1,
        updatedAt: 1,
        migratedDevices: true,
        overrides: [],
      } as any,
    });
    const dry = await dryRunDeviceMigration();
    const applied = await applyDeviceMigration(true);
    expect(dry.status).toBe("skipped");
    expect(dry.reason).toBe("already migrated");
    expect(applied.status).toBe("skipped");
    expect(h.state.calls).toEqual([]);
  });
});
