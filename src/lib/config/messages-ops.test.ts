import { expect, it } from "vitest";
import {
  messageLevel,
  messageToastOptions,
  parseMessagePage,
} from "./messages-ops";

it("parses a message page and rejects junk", () => {
  const page = parseMessagePage(
    JSON.stringify({
      seq: 3,
      entries: [
        {
          seq: 3,
          ts: 1,
          from: "logic",
          severity: "warn",
          message: "hello",
          timeout: 0,
        },
      ],
    }),
  );
  expect(page?.seq).toBe(3);
  expect(page?.entries[0]).toMatchObject({ message: "hello", timeout: 0 });

  expect(parseMessagePage(null)).toBeNull();
  expect(parseMessagePage("")).toBeNull();
  expect(parseMessagePage("not json")).toBeNull();
  expect(parseMessagePage(JSON.stringify({ seq: 1 }))).toBeNull();
});

it("maps adapter severities to toast levels", () => {
  expect(messageLevel("info")).toBe("info");
  expect(messageLevel("warn")).toBe("warning");
  expect(messageLevel("error")).toBe("error");
});

it("maps the timeout: 0 is sticky, seconds become milliseconds", () => {
  const entry = {
    seq: 1,
    ts: 1,
    from: "logic",
    severity: "info",
    message: "hello",
  };

  expect(messageToastOptions(entry)).toEqual({
    level: "info",
    sticky: false,
    timeout: undefined,
  });
  expect(messageToastOptions({ ...entry, timeout: 0 })).toEqual({
    level: "info",
    sticky: true,
    timeout: undefined,
  });
  expect(messageToastOptions({ ...entry, timeout: 5 })).toEqual({
    level: "info",
    sticky: false,
    timeout: 5000,
  });
});
