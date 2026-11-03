import { expect, it } from "vitest";
import { createLogBuffer } from "./log-buffer";

it("keeps the newest lines and pages by sequence", () => {
  const buffer = createLogBuffer(3);
  buffer.push({ ts: 1, from: "ihome.0", severity: "info", message: "one" });
  buffer.push({ ts: 2, from: "hue.0", severity: "warn", message: "two" });
  buffer.push({ ts: 3, from: "ihome.0", severity: "error", message: "three" });
  buffer.push({ ts: 4, from: "ihome.0", severity: "info", message: "four" });

  expect(buffer.slice(0, 10)).toEqual({
    seq: 4,
    entries: [
      { seq: 2, ts: 2, from: "hue.0", severity: "warn", message: "two" },
      { seq: 3, ts: 3, from: "ihome.0", severity: "error", message: "three" },
      { seq: 4, ts: 4, from: "ihome.0", severity: "info", message: "four" },
    ],
  });
  expect(buffer.slice(3, 10).entries.map((entry) => entry.message)).toEqual([
    "four",
  ]);
  expect(buffer.slice(4, 10).entries).toEqual([]);
});

it("clear keeps the sequence monotonic", () => {
  const buffer = createLogBuffer(10);
  buffer.push({ message: "one" });
  buffer.push({ message: "two" });
  buffer.clear();
  buffer.push({ message: "after" });

  const page = buffer.slice(0, 10);
  expect(page.entries.map((entry) => entry.message)).toEqual(["after"]);
  expect(page.entries[0].seq).toBe(3);
});

it("fills missing fields with safe defaults", () => {
  const buffer = createLogBuffer(10);
  buffer.push({});
  expect(buffer.slice(0, 10).entries[0]).toEqual({
    seq: 1,
    ts: 0,
    from: "",
    severity: "info",
    message: "",
  });
});
