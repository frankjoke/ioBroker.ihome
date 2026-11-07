import { expect, it, vi } from "vitest";

// The installer imports the persistence modules, which import the socket
// client. The test never writes, so a minimal client keeps the node test env.
vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: 0,
    namespace: "ihome.0",
    getObject: async () => null,
    getState: async () => null,
    setState: async () => {},
    emitAsync: async () => {},
    wait: async () => {},
  },
}));

import type { TemplateFile } from "./config/template-file";
import { installTemplateFile } from "./template-import";

const file = (
  kind: TemplateFile["kind"],
  definition: unknown,
): TemplateFile => ({
  format: "ihome-template",
  version: 1,
  kind,
  definition,
});

it("refuses to install while the owning store has not loaded", () => {
  for (const kind of [
    "formula",
    "snippet",
    "device",
    "logic",
    "api",
    "bundle",
  ] as const) {
    const result = installTemplateFile(file(kind, { id: "x", name: "X" }));
    expect("problem" in result).toBe(true);
  }
});
