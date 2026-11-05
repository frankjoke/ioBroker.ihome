import { expect, it } from "vitest";
import { connectionStatus } from "./connection-status";

it("reports no connection as an error, whatever the adapter says", () => {
  expect(connectionStatus(false, undefined)).toBe("error");
  expect(connectionStatus(false, true)).toBe("error");
  expect(connectionStatus(false, false)).toBe("error");
});

it("is green only when connected and the adapter is alive", () => {
  expect(connectionStatus(true, true)).toBe("ok");
});

it("warns when connected but the adapter is not alive", () => {
  expect(connectionStatus(true, false)).toBe("warning");
});

it("stays pending until the alive state is known", () => {
  expect(connectionStatus(true, undefined)).toBe("pending");
});
