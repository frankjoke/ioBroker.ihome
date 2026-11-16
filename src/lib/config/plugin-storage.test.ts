import { it, expect, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(async () => undefined) },
}));
import { setMetaTransport } from "$lib/config/meta-files";
import {
  removePluginFolder,
  savePluginManifest,
  writePluginFiles,
} from "$lib/config/plugin-storage";

function memory(files: Record<string, string>) {
  const calls: { event: string; args: unknown[] }[] = [];
  setMetaTransport({
    async call(event, ...args) {
      calls.push({ event, args });
      const path = String(args[1] ?? "");
      if (event === "writeFile") {
        files[path] = String(args[2] ?? "");
        return undefined;
      }
      if (event === "readFile") {
        if (!(path in files)) throw new Error("Not exists");
        return files[path];
      }
      if (event === "deleteFile") {
        delete files[path];
        return undefined;
      }
      return undefined;
    },
  });
  return { files, calls };
}

it("writes the manifest without runtime flags and the code beside it", async () => {
  const { files } = memory({});
  await writePluginFiles({
    id: "clock",
    name: "Clock",
    help: "Shows a clock",
    usage: "clock",
    timeoutMs: 8000,
    code: "module.exports = () => ({});",
  });
  const manifest = JSON.parse(files["plugins/clock/plugin.json"]);
  expect(manifest).toEqual({
    id: "clock",
    name: "Clock",
    help: "Shows a clock",
    usage: "clock",
  });
  expect(files["plugins/clock/index.js"]).toBe("module.exports = () => ({});");
  setMetaTransport(null);
});

it("rewrites name, help and usage but keeps schema and bundle", async () => {
  const { files } = memory({
    "plugins/clock/plugin.json": JSON.stringify({
      id: "clock",
      name: "Clock",
      help: "old",
      settingsSchema: [{ name: "tz", label: "Zone", type: "string" }],
      bundle: { version: 1, device: { controls: [] } },
    }),
  });
  await savePluginManifest("clock", {
    name: "Big clock",
    help: "",
    usage: "call it",
  });
  expect(JSON.parse(files["plugins/clock/plugin.json"])).toEqual({
    id: "clock",
    name: "Big clock",
    usage: "call it",
    settingsSchema: [{ name: "tz", label: "Zone", type: "string" }],
    bundle: { version: 1, device: { controls: [] } },
  });
  setMetaTransport(null);
});

it("reports a broken manifest instead of overwriting it", async () => {
  memory({ "plugins/clock/plugin.json": "{oops" });
  await expect(
    savePluginManifest("clock", { name: "X", help: "", usage: "" }),
  ).rejects.toThrow("is not valid JSON");
  setMetaTransport(null);
});

it("removes the whole folder in one call", async () => {
  const { calls } = memory({});
  await removePluginFolder("clock");
  expect(calls[0]).toEqual({
    event: "deleteFile",
    args: ["ihome.meta", "plugins/clock"],
  });
  setMetaTransport(null);
});
