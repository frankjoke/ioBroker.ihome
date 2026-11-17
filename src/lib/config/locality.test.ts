import { expect, it } from "vitest";
import { isLocalSession } from "./locality";

it("treats plain http as local and https as external", () => {
  expect(
    isLocalSession({ protocol: "http:", host: "192.168.178.9:8082" }),
  ).toBe(true);
  expect(
    isLocalSession({ protocol: "http:", host: "iobroker.ihome:8082" }),
  ).toBe(true);
  expect(isLocalSession({ protocol: "https:", host: "home.example.com" })).toBe(
    false,
  );
});

it("honours a configured public host as external even over http", () => {
  expect(
    isLocalSession({
      protocol: "http:",
      host: "home.example.com",
      publicHost: "HOMe.example.com",
    }),
  ).toBe(false);
  expect(
    isLocalSession({
      protocol: "http:",
      host: "192.168.178.9:8082",
      publicHost: "home.example.com",
    }),
  ).toBe(true);
});
