import { it, expect, vi } from "vitest";
import {
  adoptFilePlugin,
  ensurePluginFiles,
  listPluginFolders,
  mergePlugin,
  pluginManifestOf,
  readPluginFiles,
  runtimeOnly,
  type PluginFileHost,
  type PluginWriteHost,
} from "./plugin-files";

const MANIFEST = JSON.stringify({
  id: "clock",
  name: "Clock",
  help: "Shows a clock",
  usage: "clock",
  settingsSchema: [{ name: "tz", label: "Zone", type: "string" }],
});

function host(
  files: Record<string, string>,
): PluginFileHost & { dirs: Record<string, string[]> } {
  const dirs: Record<string, string[]> = {};
  for (const path of Object.keys(files)) {
    const [adapter, dir, plugin] = path.split("/");
    if (!plugin) continue;
    dirs[`${adapter}/${dir}`] ??= [];
    if (!dirs[`${adapter}/${dir}`].includes(plugin))
      dirs[`${adapter}/${dir}`].push(plugin);
  }
  return {
    dirs,
    async readDirAsync(adapter, path) {
      return (dirs[`${adapter}/${path}`] ?? []).map((name) => ({
        file: name,
        isDir: true,
      }));
    },
    async readFileAsync(adapter, path) {
      const key = `${adapter}/${path}`;
      if (!(key in files)) throw new Error("Not exists");
      return files[key];
    },
  };
}

it("lists only valid plugin folder ids", async () => {
  const h = host({
    "ihome.meta/plugins/clock/plugin.json": MANIFEST,
    "ihome.meta/plugins/clock/index.js": "module.exports = {}",
    "ihome.meta/plugins/bad id/plugin.json": MANIFEST,
  });
  expect(await listPluginFolders(h)).toEqual(["clock"]);
});

it("reads a plugin folder", async () => {
  const h = host({
    "ihome.meta/plugins/clock/plugin.json": MANIFEST,
    "ihome.meta/plugins/clock/index.js": "module.exports = {}",
  });
  const result = await readPluginFiles(h, "clock");
  expect("files" in result).toBe(true);
  if (!("files" in result)) return;
  expect(result.files.manifest).toMatchObject({
    id: "clock",
    name: "Clock",
    settingsSchema: [{ name: "tz", label: "Zone", type: "string" }],
  });
  expect(result.files.code).toBe("module.exports = {}");
});

it("reports missing or broken files", async () => {
  expect(await readPluginFiles(host({}), "clock")).toEqual({
    problem: "plugins/clock/plugin.json is missing.",
  });
  expect(
    await readPluginFiles(
      host({ "ihome.meta/plugins/clock/plugin.json": "{oops" }),
      "clock",
    ),
  ).toEqual({ problem: "plugins/clock/plugin.json is not valid JSON." });
  expect(
    await readPluginFiles(
      host({
        "ihome.meta/plugins/clock/plugin.json": JSON.stringify({
          id: "other",
          name: "X",
        }),
        "ihome.meta/plugins/clock/index.js": "x",
      }),
      "clock",
    ),
  ).toEqual({ problem: "plugins/clock/plugin.json names another id." });
  expect(
    await readPluginFiles(
      host({
        "ihome.meta/plugins/clock/plugin.json": JSON.stringify({ name: "X" }),
        "ihome.meta/plugins/clock/index.js": "  ",
      }),
      "clock",
    ),
  ).toEqual({ problem: "plugins/clock/index.js is missing." });
});

it("merges the file content with the runtime flags", async () => {
  const files = {
    manifest: { id: "clock", name: "Clock", help: "h" },
    code: "module.exports = {}",
  };
  const merged = mergePlugin(files, {
    enabled: true,
    debug: true,
    timeoutMs: 5000,
    secured: true,
    settings: { tz: "UTC" },
  });
  expect(merged).toMatchObject({
    id: "clock",
    name: "Clock",
    enabled: true,
    debug: true,
    timeoutMs: 5000,
    secured: true,
    settings: { tz: "UTC" },
    builtin: false,
    help: "h",
    code: "module.exports = {}",
  });
  expect(mergePlugin(files).enabled).toBe(false);
});

it("lists folders even when the controller omits isDir", async () => {
  const h: PluginFileHost = {
    async readDirAsync() {
      return [{ file: "clock" }, { file: "index.js", isDir: false }];
    },
    async readFileAsync() {
      return "";
    },
  };
  expect(await listPluginFolders(h)).toEqual(["clock"]);
});

it("reports a folder that cannot be listed", async () => {
  const logs: string[] = [];
  const h: PluginFileHost = {
    async readDirAsync() {
      throw new Error("not a meta object");
    },
    async readFileAsync() {
      return "";
    },
  };
  expect(await listPluginFolders(h, (message) => logs.push(message))).toEqual(
    [],
  );
  expect(logs[0]).toContain("not a meta object");
});

it("rejects an invalid settings schema or bundle", async () => {
  const base = {
    "ihome.meta/plugins/clock/index.js": "module.exports = {}",
  };
  expect(
    await readPluginFiles(
      host({
        ...base,
        "ihome.meta/plugins/clock/plugin.json": JSON.stringify({
          id: "clock",
          name: "Clock",
          settingsSchema: [null],
        }),
      }),
      "clock",
    ),
  ).toMatchObject({ problem: expect.stringMatching(/settings schema/) });
  expect(
    await readPluginFiles(
      host({
        ...base,
        "ihome.meta/plugins/clock/plugin.json": JSON.stringify({
          id: "clock",
          name: "Clock",
          bundle: { device: {} },
        }),
      }),
      "clock",
    ),
  ).toMatchObject({ problem: expect.stringMatching(/bundle/) });
});

it("reads the controller's { file, mimeType } result", async () => {
  const h: PluginFileHost = {
    async readDirAsync() {
      return [{ file: "clock", isDir: true }];
    },
    async readFileAsync(_adapter, path) {
      return path.endsWith("plugin.json")
        ? { file: MANIFEST, mimeType: "application/json" }
        : {
            file: Buffer.from("module.exports = {}"),
            mimeType: "text/javascript",
          };
    },
  };
  const result = await readPluginFiles(h, "clock");
  expect("files" in result && result.files.code).toBe("module.exports = {}");
});

it("keeps usable files and repairs a broken folder from the config code", async () => {
  const store: Record<string, string> = {
    "ihome.meta/plugins/clock/plugin.json": MANIFEST,
    "ihome.meta/plugins/clock/index.js": "  ",
  };
  const h: PluginWriteHost = {
    async readDirAsync() {
      return [{ file: "clock", isDir: true }];
    },
    async readFileAsync(_adapter, path) {
      const key = `ihome.meta/${path}`;
      if (!(key in store)) throw new Error("Not exists");
      return store[key];
    },
    async writeFileAsync(_adapter, path, text) {
      store[`ihome.meta/${path}`] = text;
    },
  };
  const plugin = {
    id: "clock",
    name: "Clock",
    enabled: true,
    timeoutMs: 5000,
    debug: false,
    code: "module.exports = () => ({ call() {} });",
  };
  expect(await ensurePluginFiles(h, plugin)).toEqual({ ok: true });
  expect(store["ihome.meta/plugins/clock/index.js"]).toBe(plugin.code);
});

it("reports a folder it cannot repair", async () => {
  const h: PluginWriteHost = {
    async readDirAsync() {
      return [];
    },
    async readFileAsync() {
      throw new Error("Not exists");
    },
    async writeFileAsync() {
      // The controller keeps dropping the file.
    },
  };
  const result = await ensurePluginFiles(h, {
    id: "clock",
    name: "Clock",
    enabled: true,
    timeoutMs: 5000,
    debug: false,
    code: "module.exports = () => ({ call() {} });",
  });
  expect(result).toMatchObject({ problem: expect.stringMatching(/missing/) });
});

it("rejects an unknown id", async () => {
  expect(await readPluginFiles(host({}), "../evil")).toEqual({
    problem: "Unknown plugin id: ../evil",
  });
});

vi.restoreAllMocks();

it("splits a config plugin into manifest and runtime", () => {
  const plugin = {
    id: "clock",
    name: "Clock",
    enabled: true,
    builtin: false,
    timeoutMs: 5000,
    debug: false,
    help: "h",
    usage: "u",
    settingsSchema: [{ name: "tz", label: "Zone", type: "string" as const }],
    settings: { tz: "UTC" },
    code: "code",
  };
  expect(pluginManifestOf(plugin)).toEqual({
    id: "clock",
    name: "Clock",
    help: "h",
    usage: "u",
    settingsSchema: [{ name: "tz", label: "Zone", type: "string" }],
  });
  expect(runtimeOnly(plugin)).toEqual({
    id: "clock",
    name: "Clock",
    enabled: true,
    timeoutMs: 5000,
    debug: false,
  });
});

it("carries the manifest api and version into the plugin", () => {
  const files = {
    manifest: { id: "clock", name: "Clock", api: 1, version: "2.0.0" },
    code: "module.exports = {}",
  };
  expect(mergePlugin(files)).toMatchObject({ api: 1, version: "2.0.0" });
});

it("refuses a newer api or a bad version in a folder", async () => {
  const base = { id: "clock", name: "Clock" };
  const newer = host({
    "ihome.meta/plugins/clock/plugin.json": JSON.stringify({ ...base, api: 2 }),
    "ihome.meta/plugins/clock/index.js": "module.exports = {}",
  });
  expect(await readPluginFiles(newer, "clock")).toMatchObject({
    problem: expect.stringContaining("plugin API"),
  });
  const badVersion = host({
    "ihome.meta/plugins/clock/plugin.json": JSON.stringify({
      ...base,
      version: 5,
    }),
    "ihome.meta/plugins/clock/index.js": "module.exports = {}",
  });
  expect(await readPluginFiles(badVersion, "clock")).toMatchObject({
    problem: expect.stringContaining("version"),
  });
});

it("adopts a retired built-in as a file plugin and keeps the runtime flags", async () => {
  const store: Record<string, string> = {};
  const h: PluginWriteHost = {
    async readDirAsync() {
      return [];
    },
    async readFileAsync(_adapter, path) {
      const key = `ihome.meta/${path}`;
      if (!(key in store)) throw new Error("Not exists");
      return store[key];
    },
    async writeFileAsync(_adapter, path, text) {
      store[`ihome.meta/${path}`] = text;
    },
  };
  const result = await adoptFilePlugin(
    h,
    {
      id: "external-access",
      name: "External access (Caddy)",
      enabled: true,
      builtin: true,
      timeoutMs: 20_000,
      debug: false,
      secured: true,
    },
    {
      id: "external-access",
      name: "External access (Caddy)",
      api: 1,
      version: "1.0.0",
      code: "module.exports = () => ({ call() {} });",
    },
  );
  expect(result).toEqual({
    entry: {
      id: "external-access",
      name: "External access (Caddy)",
      enabled: true,
      secured: true,
      timeoutMs: 20_000,
      debug: false,
    },
  });
  const manifest = JSON.parse(
    store["ihome.meta/plugins/external-access/plugin.json"],
  );
  expect(manifest).toMatchObject({
    id: "external-access",
    api: 1,
    version: "1.0.0",
  });
  expect(store["ihome.meta/plugins/external-access/index.js"]).toContain(
    "module.exports",
  );
});

it("leaves an existing valid folder alone when adopting", async () => {
  const store: Record<string, string> = {
    "ihome.meta/plugins/external-access/plugin.json": JSON.stringify({
      id: "external-access",
      name: "External access (Caddy)",
      api: 1,
      version: "1.0.0",
    }),
    "ihome.meta/plugins/external-access/index.js": "module.exports = () => 1",
  };
  let writes = 0;
  const h: PluginWriteHost = {
    async readDirAsync() {
      return [{ file: "external-access", isDir: true }];
    },
    async readFileAsync(_adapter, path) {
      const key = `ihome.meta/${path}`;
      if (!(key in store)) throw new Error("Not exists");
      return store[key];
    },
    async writeFileAsync() {
      writes += 1;
    },
  };
  const result = await adoptFilePlugin(
    h,
    {
      id: "external-access",
      name: "External access (Caddy)",
      enabled: false,
      builtin: true,
      timeoutMs: 20_000,
      debug: true,
    },
    {
      id: "external-access",
      name: "External access (Caddy)",
      api: 1,
      version: "1.0.0",
      code: "module.exports = () => 1",
    },
  );
  expect(writes).toBe(0);
  expect(result).toMatchObject({ entry: { enabled: false, debug: true } });
  expect((result as { entry: { builtin?: boolean } }).entry.builtin).toBe(
    undefined,
  );
});

it("reports a failed adoption so the caller keeps the built-in", async () => {
  const h: PluginWriteHost = {
    async readDirAsync() {
      return [];
    },
    async readFileAsync() {
      throw new Error("Not exists");
    },
    async writeFileAsync() {
      throw new Error("storage offline");
    },
  };
  expect(
    await adoptFilePlugin(
      h,
      {
        id: "external-access",
        name: "External access (Caddy)",
        enabled: true,
        builtin: true,
        timeoutMs: 20_000,
        debug: false,
      },
      {
        id: "external-access",
        name: "External access (Caddy)",
        api: 1,
        code: "module.exports = () => 1",
      },
    ),
  ).toEqual({ problem: "Error: storage offline" });
});
