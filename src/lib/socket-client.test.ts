import { it, expect } from "vitest";
import { connectPlan, loadIo2Client } from "$lib/socket-client";

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

it("loads the page's client and hands the ws global back (needs a DOM)", async () => {
  // `@iobroker/ws` installs `globalThis.io` at import; the socket.io bundle
  // claims the same name. The restore is load-bearing for the ws path, so it
  // is pinned here with a minimal document stand-in.
  const wsClient = { connect: () => "ws" };
  const io2Client = { connect: () => "io2" };
  const g = globalThis as Record<string, unknown>;
  g.io = wsClient;
  g.document = {
    baseURI: "http://host/ihome/index.html",
    createElement: () => ({ src: "", onload: null, onerror: null }),
    head: {
      append(script: { onload: (() => void) | null }) {
        g.io = io2Client;
        script.onload?.();
      },
    },
  };
  try {
    const loaded = await loadIo2Client();
    expect(loaded).toBe(io2Client);
    expect(g.io).toBe(wsClient);
  } finally {
    delete g.io;
    delete g.document;
  }
});
