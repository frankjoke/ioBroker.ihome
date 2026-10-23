import { it, expect } from "vitest";
import {
  cloudPageUrl,
  parseSocketInfo,
  resolveConnection,
  resolveTransport,
  shouldJumpToCloud,
} from "$lib/transport";

// The real file the web adapter serves (verified 2026-10-23).
const LOCAL_INFO =
  'var socketUrl = ""; var socketPath = ""; var socketSession = ""; window._authIoBroker = false; window.sysLang = "de"; window.socketForceWebSockets = false; window.materialBackground = "";';

// The cloud answers with a redirect stub instead (operator's paste, 2026-10-23).
const CLOUD_STUB =
  'window.location.href = "/#redirect=" + encodeURIComponent(window.location.href.replace(location.protocol + "//" + location.host, ""));';

it("reads the values the web adapter declares", () => {
  expect(parseSocketInfo(LOCAL_INFO)).toEqual({
    socketUrl: "",
    socketSession: "",
  });
});

it("reads non-empty values, including a bare port", () => {
  expect(
    parseSocketInfo('var socketUrl = ":8082"; var socketSession = "abc123";'),
  ).toEqual({ socketUrl: ":8082", socketSession: "abc123" });
});

it("treats the cloud's redirect stub as no information", () => {
  expect(parseSocketInfo(CLOUD_STUB)).toBe(null);
});

it("treats junk or a partial declaration as no information", () => {
  expect(parseSocketInfo("")).toBe(null);
  expect(parseSocketInfo("<!DOCTYPE html><html>404</html>")).toBe(null);
  expect(parseSocketInfo('var socketUrl = "";')).toBe(null); // session missing
  expect(parseSocketInfo('var socketSession = "abc";')).toBe(null); // url missing
});

const page = {
  origin: "http://192.168.178.9:8082",
  host: "192.168.178.9:8082",
  protocol: "http:",
};

it("an explicit address always wins, on the ws client", () => {
  const r = resolveTransport({
    ...page,
    explicit: "ws://x:8081/socket.io",
    hostPort: "y:8081",
    info: {},
  });
  expect(r).toEqual({ transport: "ws", url: "ws://x:8081/socket.io" });
});

it("a stored host:port wins over the page, on the ws client", () => {
  const r = resolveTransport({ ...page, hostPort: "10.0.0.5:8081", info: {} });
  expect(r).toEqual({ transport: "ws", url: "ws://10.0.0.5:8081/socket.io" });
});

it("a served page uses the web adapter's socket at the page origin", () => {
  const r = resolveTransport({
    ...page,
    info: { socketUrl: "", socketSession: "" },
  });
  expect(r).toEqual({
    transport: "io2",
    url: "http://192.168.178.9:8082",
    query: "key=nokey",
  });
});

it("honours a socketUrl and a session, including the bare-port form", () => {
  expect(
    resolveTransport({
      ...page,
      info: { socketUrl: ":9000", socketSession: "abc" },
    }),
  ).toEqual({
    transport: "io2",
    url: "http://192.168.178.9:9000",
    query: "key=abc",
  });
  expect(
    resolveTransport({
      ...page,
      protocol: "https:",
      origin: "https://iobroker.pro",
      host: "iobroker.pro",
      info: { socketUrl: "", socketSession: "" },
    }),
  ).toEqual({
    transport: "io2",
    url: "https://iobroker.pro",
    query: "key=nokey",
  });
});

it("without a served info file it keeps today's ws default", () => {
  const r = resolveTransport({ ...page, info: null });
  expect(r).toEqual({
    transport: "ws",
    url: "ws://192.168.178.9:8081/socket.io",
  });
  const https = resolveTransport({
    ...page,
    protocol: "https:",
    host: "ihome.local",
    info: null,
  });
  expect(https).toEqual({
    transport: "ws",
    url: "wss://ihome.local:8081/socket.io",
  });
});

it("builds the cloud page from host and path", () => {
  expect(cloudPageUrl("iobroker.pro", "/ihome/index.html")).toBe(
    "https://iobroker.pro/ihome/index.html",
  );
  expect(cloudPageUrl("https://iobroker.pro/", "/ihome/")).toBe(
    "https://iobroker.pro/ihome/",
  );
  expect(cloudPageUrl("", "/ihome/")).toBe(null);
});

it("jumps only when it is enabled, configured and not pinned", () => {
  const base = {
    enabled: true,
    cloudHost: "iobroker.pro",
    pageHost: "192.168.178.9:8082",
  };
  expect(shouldJumpToCloud(base)).toBe(true);
  expect(shouldJumpToCloud({ ...base, enabled: false })).toBe(false); // ships off
  expect(shouldJumpToCloud({ ...base, cloudHost: "" })).toBe(false); // nothing configured
  expect(
    shouldJumpToCloud({ ...base, explicit: "ws://x:8081/socket.io" }),
  ).toBe(false);
  expect(shouldJumpToCloud({ ...base, hostPort: "192.168.178.9:8081" })).toBe(
    false,
  );
  expect(shouldJumpToCloud({ ...base, pageHost: "iobroker.pro" })).toBe(false);
});

// --- the fix pass (review findings 2 and 3) -------------------------------

it("only an info file or the cloud's stub counts as 'a web instance served this page'", async () => {
  const base = {
    origin: "http://host:8082",
    host: "host:8082",
    protocol: "http:",
  };
  const spaHtml = "<!DOCTYPE html><html><body><div id=app></div></body></html>";
  // A catch-all static host answers every unknown path with the SPA, 200 — that
  // is not a web instance, and must keep today's ws default (rule 4).
  expect(
    await resolveConnection({ ...base, fetchInfo: async () => spaHtml }),
  ).toEqual({ transport: "ws", url: "ws://host:8081/socket.io" });
  // The cloud's stub says nothing, but it *is* a web instance answering.
  expect(
    await resolveConnection({ ...base, fetchInfo: async () => CLOUD_STUB }),
  ).toEqual({ transport: "io2", url: "http://host:8082", query: "key=nokey" });
  // A real file: its values are used.
  expect(
    await resolveConnection({ ...base, fetchInfo: async () => LOCAL_INFO }),
  ).toEqual({ transport: "io2", url: "http://host:8082", query: "key=nokey" });
});

it("a fetch that fails or hangs falls back to the ws default, not to a stall", async () => {
  const base = {
    origin: "http://host:8082",
    host: "host:8082",
    protocol: "http:",
  };
  expect(
    await resolveConnection({ ...base, fetchInfo: async () => null }),
  ).toEqual({ transport: "ws", url: "ws://host:8081/socket.io" });
  expect(
    await resolveConnection({
      ...base,
      fetchInfo: () => Promise.reject(new Error("boom")),
    }),
  ).toEqual({ transport: "ws", url: "ws://host:8081/socket.io" });
});
