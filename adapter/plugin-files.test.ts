import { it, expect, vi } from "vitest";
import {
  listPluginFolders,
  mergePlugin,
  readPluginFiles,
  type PluginFileHost,
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
    settings: { tz: "UTC" },
  });
  expect(merged).toMatchObject({
    id: "clock",
    name: "Clock",
    enabled: true,
    debug: true,
    timeoutMs: 5000,
    settings: { tz: "UTC" },
    builtin: false,
    help: "h",
    code: "module.exports = {}",
  });
  expect(mergePlugin(files).enabled).toBe(false);
});

it("rejects an unknown id", async () => {
  expect(await readPluginFiles(host({}), "../evil")).toEqual({
    problem: "Unknown plugin id: ../evil",
  });
});

vi.restoreAllMocks();
