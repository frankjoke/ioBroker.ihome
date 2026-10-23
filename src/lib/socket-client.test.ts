import { it, expect } from "vitest";
import { connectPlan } from "$lib/socket-client";

it("the io2 transport connects with the session key and reconnection on", () => {
  expect(
    connectPlan({
      transport: "io2",
      url: "https://iobroker.pro",
      query: "key=nokey",
    }),
  ).toEqual({
    client: "io2",
    url: "https://iobroker.pro",
    options: { query: "key=nokey", reconnection: true },
  });
});

it("a missing session key still becomes 'nokey'", () => {
  expect(
    connectPlan({ transport: "io2", url: "http://192.168.178.9:8082" }).options,
  ).toEqual({ query: "key=nokey", reconnection: true });
});

it("the ws transport keeps today's call untouched", () => {
  expect(
    connectPlan({ transport: "ws", url: "ws://192.168.178.9:8081/socket.io" }),
  ).toEqual({
    client: "ws",
    url: "ws://192.168.178.9:8081/socket.io",
    options: {},
  });
});
