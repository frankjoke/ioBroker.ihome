import { it, expect } from "vitest";
import { nextCron, timerLabel } from "./timer-ops";

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
