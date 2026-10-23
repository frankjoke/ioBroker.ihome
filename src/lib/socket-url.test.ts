import { expect, it } from "vitest";
import { socketUrlFromHostPort } from "./socket-url";

// The transport rules live in transport.ts now; this helper is the one shape
// the ws transport still needs (rules 2 and 4 build their URL through it).
it("builds the socket.io URL of a host:port", () => {
  expect(socketUrlFromHostPort("192.168.178.9:8081")).toBe(
    "ws://192.168.178.9:8081/socket.io",
  );
});

it("has no URL for an empty value", () => {
  expect(socketUrlFromHostPort("")).toBe("");
});
