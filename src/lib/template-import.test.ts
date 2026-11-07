import { expect, it, vi } from "vitest";

const logicState = vi.hoisted(() => ({
  writable: false,
  blocked: false,
  commits: 0,
}));

// The installer imports the persistence modules, which import the socket
// client. The tests never persist, so a minimal client keeps the node env.
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

vi.mock("$lib/stores/logics.svelte", () => ({
  getLogicDocument: () => ({
    version: 3,
    logics: [],
    templates: [],
    deviceTemplates: [],
  }),
  isLogicsWritable: () => logicState.writable,
  logicBlocked: () => logicState.blocked,
  commitLogics: () => {
    logicState.commits += 1;
    return true;
  },
}));

import type { TemplateFile } from "./config/template-file";
import {
  getFunctions,
  setFunctionLibrary,
  setFunctionsLoadKind,
} from "./stores/functions.svelte";
import { setFormulasLoadKind } from "./stores/formulas.svelte";
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

it("refuses an unreadable formula store", () => {
  setFormulasLoadKind("unreadable");
  const result = installTemplateFile(
    file("formula", { id: "f", name: "F", expr: "1" }),
  );
  expect("problem" in result).toBe(true);
  setFormulasLoadKind("pending");
});

it("refuses a logic import while the document is blocked, before committing", () => {
  logicState.writable = true;
  logicState.blocked = true;
  logicState.commits = 0;
  const result = installTemplateFile(
    file("logic", { id: "l", name: "L", params: [], logic: {} }),
  );
  expect("problem" in result).toBe(true);
  expect(logicState.commits).toBe(0);
  logicState.writable = false;
  logicState.blocked = false;
});

it("renames a snippet id that collides with a built-in", () => {
  vi.useFakeTimers();
  try {
    setFunctionsLoadKind("absent");
    setFunctionLibrary({ version: 0, updatedAt: 0, functions: [] });
    const result = installTemplateFile(
      file("snippet", {
        id: "celsius-to-fahrenheit",
        name: "C",
        mode: "expression",
        code: "1 + 1",
      }),
    );
    expect("id" in result).toBe(true);
    if ("id" in result) {
      expect(result.id).not.toBe("celsius-to-fahrenheit");
      expect(getFunctions().find((entry) => entry.id === result.id)?.name).toBe(
        "C (imported)",
      );
    }
  } finally {
    setFunctionsLoadKind("pending");
    vi.useRealTimers();
  }
});
