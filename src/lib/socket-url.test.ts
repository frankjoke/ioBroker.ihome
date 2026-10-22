import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultSocketUrl,
  resolveSocketUrl,
  socketUrlFromHostPort,
} from "./socket-url";

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

describe("socketUrlFromHostPort", () => {
  it("builds the socket.io URL of a host:port", () => {
    expect(socketUrlFromHostPort("192.168.178.9:8081")).toBe(
      "ws://192.168.178.9:8081/socket.io",
    );
  });

  it("has no URL for an empty value", () => {
    expect(socketUrlFromHostPort("")).toBe("");
  });
});

describe("resolveSocketUrl", () => {
  const page = { protocol: "http:", hostname: "localhost" };

  it("uses the configured fallback when nothing else is given", () => {
    expect(
      resolveSocketUrl({ ...page, configured: "192.168.178.9:8081" }),
    ).toBe("ws://192.168.178.9:8081/socket.io");
  });

  it("?socket= wins over the configured fallback", () => {
    expect(
      resolveSocketUrl({
        ...page,
        query: "wss://proxy/socket.io",
        configured: "192.168.178.9:8081",
      }),
    ).toBe("wss://proxy/socket.io");
  });

  it("VITE_SOCKET_URL wins over the configured fallback", () => {
    expect(
      resolveSocketUrl({
        ...page,
        env: "ws://env-host:8081/socket.io",
        configured: "192.168.178.9:8081",
      }),
    ).toBe("ws://env-host:8081/socket.io");
  });

  it("falls back to the page host when nothing is configured", () => {
    expect(resolveSocketUrl({ ...page, configured: "" })).toBe(
      "ws://localhost:8081/socket.io",
    );
    expect(
      resolveSocketUrl({
        protocol: "https:",
        hostname: "iobroker.example.com",
        configured: "",
      }),
    ).toBe("wss://iobroker.example.com:8081/socket.io");
  });
});
