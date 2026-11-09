import { describe, expect, it } from "vitest";
import type { PluginApi } from "../plugin-api";
import {
  applyHttpWrites,
  buildRequestData,
  matchHttpEndpoint,
  parseHttpEndpoints,
  processHttpRequest,
  targetWrites,
} from "./http-in";

const config = [
  {
    path: "weather",
    method: "GET",
    target: "0_userdata.0.Weather.json",
  },
  {
    path: "hook",
    method: "POST",
    targets: [
      { state: "0_userdata.0.Hook.kind", value: "$.kind" },
      {
        state: "0_userdata.0.Hook.temp",
        type: "number" as const,
        value: "$.tempf",
        transform: "(Number(value) - 32) * 5 / 9",
      },
    ],
  },
];

describe("parseHttpEndpoints", () => {
  it("parses a JSON string and normalizes paths", () => {
    const endpoints = parseHttpEndpoints(JSON.stringify(config));
    expect(endpoints.map((endpoint) => endpoint.path)).toEqual([
      "/weather",
      "/hook",
    ]);
  });

  it("rejects invalid endpoint lists", () => {
    expect(() => parseHttpEndpoints("{}")).toThrow();
    expect(() => parseHttpEndpoints("[{}]")).toThrow();
    expect(() => parseHttpEndpoints('[{"path":"x","method":"GET"}]')).toThrow();
    expect(() =>
      parseHttpEndpoints(
        '[{"path":"x","method":"GET","targets":[{"state":"","value":"$"}]}]',
      ),
    ).toThrow();
  });
});

describe("matchHttpEndpoint", () => {
  it("matches method and normalized path", () => {
    const endpoints = parseHttpEndpoints(config);
    expect(matchHttpEndpoint(endpoints, "GET", "/weather/")?.path).toBe(
      "/weather",
    );
    expect(matchHttpEndpoint(endpoints, "POST", "/hook")?.path).toBe("/hook");
    expect(matchHttpEndpoint(endpoints, "PUT", "/weather")).toBeUndefined();
  });
});

describe("request data", () => {
  it("merges query parameters with an object body", () => {
    expect(buildRequestData({ a: "1" }, { b: 2, kind: "x" })).toEqual({
      a: "1",
      b: 2,
      kind: "x",
    });
    expect(buildRequestData({ a: "1" }, "text")).toBe("text");
    expect(buildRequestData({ a: "1" }, undefined)).toEqual({ a: "1" });
  });
});

describe("target writes", () => {
  it("writes the whole result to one state", () => {
    const endpoint = parseHttpEndpoints(config)[0];
    expect(targetWrites(endpoint, { tempf: "70" })).toEqual([
      {
        state: "0_userdata.0.Weather.json",
        value: '{"tempf":"70"}',
        type: "string",
        role: "text.json",
      },
    ]);
  });

  it("evaluates values, transforms and types", () => {
    const endpoint = parseHttpEndpoints(config)[1];
    const writes = targetWrites(endpoint, { kind: "x", tempf: "70" });
    expect(writes).toEqual([
      {
        state: "0_userdata.0.Hook.kind",
        value: "x",
        type: "string",
        role: undefined,
      },
      {
        state: "0_userdata.0.Hook.temp",
        value: (70 - 32) * (5 / 9),
        type: "number",
        role: undefined,
      },
    ]);
  });
});

describe("applyHttpWrites", () => {
  it("uses foreign objects and states outside the adapter namespace", async () => {
    const calls: unknown[] = [];
    const api = {
      namespace: "ihome.0",
      objects: {
        get: async (id: string) => {
          calls.push(["get", id]);
          return undefined;
        },
        getForeign: async (id: string) => {
          calls.push(["getForeign", id]);
          return undefined;
        },
        set: async (id: string) => calls.push(["set", id]),
        setForeign: async (id: string) => calls.push(["setForeign", id]),
      },
      state: {
        set: async (id: string) => calls.push(["stateSet", id]),
        setForeign: async (id: string) => calls.push(["stateSetForeign", id]),
      },
    } as unknown as PluginApi;
    await applyHttpWrites(api, [
      {
        state: "0_userdata.0.Hook.temp",
        value: 21,
        type: "number",
      },
    ]);
    expect(calls).toEqual([
      ["getForeign", "0_userdata.0.Hook.temp"],
      ["setForeign", "0_userdata.0.Hook.temp"],
      ["stateSetForeign", "0_userdata.0.Hook.temp"],
    ]);
  });
});

describe("processHttpRequest", () => {
  const settings = { endpoints: parseHttpEndpoints(config), token: "secret" };

  it("returns a token error", () => {
    const result = processHttpRequest(settings, {
      method: "GET",
      path: "/weather",
      query: {},
      body: undefined,
      token: "",
    });
    expect(result.status).toBe(401);
    expect(result.writes).toEqual([]);
  });

  it("returns path and method errors", () => {
    expect(
      processHttpRequest(settings, {
        method: "GET",
        path: "/missing",
        query: {},
        body: undefined,
        token: "secret",
      }).status,
    ).toBe(404);
    expect(
      processHttpRequest(settings, {
        method: "PUT",
        path: "/weather",
        query: {},
        body: undefined,
        token: "secret",
      }).status,
    ).toBe(405);
  });

  it("returns writes for a valid request", () => {
    const result = processHttpRequest(settings, {
      method: "POST",
      path: "/hook",
      query: {},
      body: { kind: "x", tempf: "70" },
      token: "secret",
    });
    expect(result.status).toBe(200);
    expect(result.writes).toHaveLength(2);
  });

  it("reports an invalid expression without writes", () => {
    const broken = parseHttpEndpoints(
      '[{"path":"x","method":"GET","targets":[{"state":"0_userdata.0.X","value":"$."}]}]',
    );
    const result = processHttpRequest(
      { endpoints: broken },
      {
        method: "GET",
        path: "/x",
        query: {},
        body: undefined,
        token: "",
      },
    );
    expect(result.status).toBe(500);
    expect(result.writes).toEqual([]);
  });
});
