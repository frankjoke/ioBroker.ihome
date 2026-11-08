import { expect, it } from "vitest";
import { uiMessage } from "./ui-message";

it("reads the severity from the first word and strips it", () => {
  expect(uiMessage("Alarm: Pump is dry")).toEqual({
    level: "error",
    text: "Pump is dry",
    timeout: 0,
  });
  expect(uiMessage("Warning Door open")).toEqual({
    level: "warn",
    text: "Door open",
    timeout: 10,
  });
  expect(uiMessage("Info: Shopping list updated")).toEqual({
    level: "info",
    text: "Shopping list updated",
  });
});

it("is case-insensitive and accepts Error/Warn aliases", () => {
  expect(uiMessage("alarm - Wasser")).toMatchObject({
    level: "error",
    text: "Wasser",
  });
  expect(uiMessage("ERROR: failed")).toMatchObject({
    level: "error",
    text: "failed",
  });
  expect(uiMessage("warn: low battery")).toMatchObject({
    level: "warn",
    text: "low battery",
  });
});

it("defaults to info without a prefix", () => {
  expect(uiMessage("Pump is dry")).toEqual({
    level: "info",
    text: "Pump is dry",
  });
});

it("keeps the word when nothing follows it", () => {
  expect(uiMessage("Alarm")).toMatchObject({ level: "error", text: "Alarm" });
  expect(uiMessage("Warning:")).toMatchObject({
    level: "warn",
    text: "Warning",
  });
});

it("does not mistake a longer word for a prefix", () => {
  expect(uiMessage("Alarmierung")).toEqual({
    level: "info",
    text: "Alarmierung",
  });
});

it("ignores empty and non-string values", () => {
  expect(uiMessage("")).toBeNull();
  expect(uiMessage("   ")).toBeNull();
  expect(uiMessage(42)).toBeNull();
  expect(uiMessage(null)).toBeNull();
});
