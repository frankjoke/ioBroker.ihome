import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSocketUrl } from "./socket-url";

function setLocation(href: string): void {
  const url = new URL(href);
  // @ts-expect-error the test runs without a DOM; the helper only reads these
  globalThis.location = {
    protocol: url.protocol,
    hostname: url.hostname,
    search: url.search,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("defaultSocketUrl", () => {
  it("uses the page host on port 8081", () => {
    setLocation("http://192.168.178.9:8082/ihome/index.html");
    expect(defaultSocketUrl()).toBe("ws://192.168.178.9:8081/socket.io");
  });

  it("uses wss when the page is https", () => {
    setLocation("https://iobroker.example.com/ihome/index.html");
    expect(defaultSocketUrl()).toBe(
      "wss://iobroker.example.com:8081/socket.io",
    );
  });

  it("honours ?socket=", () => {
    setLocation(
      "http://host:8082/ihome/index.html?socket=wss://proxy/socket.io",
    );
    expect(defaultSocketUrl()).toBe("wss://proxy/socket.io");
  });

  it("honours VITE_SOCKET_URL", () => {
    setLocation("http://localhost:5173/");
    vi.stubEnv("VITE_SOCKET_URL", "ws://192.168.178.9:8081/socket.io");
    expect(defaultSocketUrl()).toBe("ws://192.168.178.9:8081/socket.io");
  });
});
