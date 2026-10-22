import { expect, it } from "vitest";
// `@iobroker/ws` publishes no ES exports: importing it assigns
// `globalThis.io = { connect }` as a side effect. This pins that entry point
// and the surface the SPA drives — nothing else guards the transport.
import "@iobroker/ws";

/** Do-nothing WebSocket, passed through the client's own option: without it
 *  the test would open a real socket (and leak a reconnect timer). */
class Stub {
  close(): void {}
  send(): void {}
}

const io = (
  globalThis as unknown as {
    io?: { connect(url: string, options?: unknown): any };
  }
).io;

it("the package's entry point provides the client the SPA drives", () => {
  expect(typeof io?.connect).toBe("function");
  const socket = io?.connect("ws://127.0.0.1:1/socket.io", {
    WebSocket: Stub,
  });
  expect(socket).toBeDefined();
  for (const method of [
    "emit",
    "on",
    "off",
    "close",
    "disconnect",
    "destroy",
  ]) {
    expect(typeof socket[method]).toBe("function");
  }
  expect(socket.connected).toBe(false);
  socket.destroy();
});
