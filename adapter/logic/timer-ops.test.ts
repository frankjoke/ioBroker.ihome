import { it, expect } from "vitest";
import { nextCron, parseCronAt, timerInputName, timerLabel } from "./timer-ops";

it("finds the next matching cron minute", () => {
  const from = new Date(2026, 10, 3, 7, 30, 20).getTime(); // Tue 3 Nov 2026
  expect(
    new Date(nextCron({ kind: "cron", at: "08:00", days: "*" }, from)!),
  ).toEqual(new Date(2026, 10, 3, 8, 0, 0));
  // A time already past today moves to tomorrow.
  const late = new Date(2026, 10, 3, 9, 0, 0).getTime();
  expect(
    new Date(nextCron({ kind: "cron", at: "08:00", days: "*" }, late)!),
  ).toEqual(new Date(2026, 10, 4, 8, 0, 0));
  // Day of week: the next Wednesday.
  expect(
    new Date(
      nextCron({ kind: "cron", at: "08:00", days: [3] }, from)!,
    ).getDay(),
  ).toBe(3);
  // *:* is the next minute.
  expect(new Date(nextCron({ kind: "cron", at: "*:*" }, from)!)).toEqual(
    new Date(2026, 10, 3, 7, 31, 0),
  );
});

it("labels every, astro and cron timers", () => {
  expect(timerLabel("5m")).toBe("every 5m");
  expect(timerLabel({ kind: "astro", event: "sunset", offset: 20 })).toBe(
    "astro sunset +20m",
  );
  expect(timerLabel({ kind: "astro", event: "dawn", offset: -10 })).toBe(
    "astro dawn -10m",
  );
  expect(timerLabel({ kind: "cron", at: "07:30", days: "*" })).toBe(
    "cron 07:30 · *",
  );
  expect(timerLabel({ kind: "cron", at: "07:30", days: [1, 2, 3, 4, 5] })).toBe(
    "cron 07:30 · Mon,Tue,Wed,Thu,Fri",
  );
});

it("suggests a code-friendly name from the timer value", () => {
  expect(timerInputName("2m")).toBe("every2m");
  expect(timerInputName({ kind: "cron", at: "20:30" })).toBe("at20_30");
  expect(timerInputName({ kind: "cron", at: "@06:30", days: [1] })).toBe(
    "at06_30",
  );
  expect(timerInputName({ kind: "astro", event: "night" })).toBe("astro_night");
  expect(timerInputName({ kind: "astro", event: "sunset", offset: -10 })).toBe(
    "astro_sunset_minus10",
  );
  expect(timerInputName({ kind: "cron", at: "*:15" })).toBe("at_15");
});

it("accepts lists and the @ / at: forms", () => {
  expect(parseCronAt("@10,12,15,17:10")).toEqual({
    hour: [10, 12, 15, 17],
    minute: [10],
    second: [0],
  });
  expect(parseCronAt("at:*:15")).toEqual({
    hour: "*",
    minute: [15],
    second: [0],
  });
  expect(parseCronAt("25:00")).toBeUndefined();
  expect(parseCronAt("*:*:*")).toBeUndefined();
});

it("finds the next hour of a list", () => {
  const from = new Date(2026, 10, 3, 9, 30).getTime();
  const next = nextCron(
    { kind: "cron", at: "10,12,15,17:10", days: "*" },
    from,
  )!;
  expect(new Date(next)).toEqual(new Date(2026, 10, 3, 10, 10, 0));
});
