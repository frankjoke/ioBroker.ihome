import { expect, it } from "vitest";
import { endpointToken, parseHttpInSettings } from "./http-in-endpoints";

it("parses string and array endpoints and the global fallback", () => {
  expect(parseHttpInSettings({ endpoints: "not json" })).toEqual({
    endpoints: [],
    globalToken: "",
    defaultPort: 8095,
  });
  const view = parseHttpInSettings({
    port: 3000,
    token: "global-secret",
    endpoints: JSON.stringify([
      { path: "phone-event", method: "GET", token: "own-secret" },
      { path: "/phone", port: 8096 },
      { path: "" },
      "junk",
    ]),
  });
  expect(view.globalToken).toBe("global-secret");
  expect(view.defaultPort).toBe(3000);
  expect(view.endpoints).toEqual([
    { path: "/phone-event", method: "GET", token: "own-secret" },
    { path: "/phone", method: "GET", token: "", port: 8096 },
  ]);
  expect(
    parseHttpInSettings({ endpoints: [{ path: "/array" }] }).endpoints[0].path,
  ).toBe("/array");
  expect(endpointToken(view.endpoints[0], view.globalToken)).toEqual({
    token: "own-secret",
    source: "endpoint",
  });
  expect(endpointToken(view.endpoints[1], view.globalToken)).toEqual({
    token: "global-secret",
    source: "global",
  });
  expect(endpointToken(view.endpoints[1], "")).toEqual({
    token: "",
    source: "none",
  });
});
