import { it, expect } from "vitest";
import { parseSocketInfo } from "$lib/transport";

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
