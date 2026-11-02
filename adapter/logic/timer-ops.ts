import type { AstroEvent, TimerSpec } from "./types";

/** The astro times SunCalc names; the editor offers exactly these. */
export const ASTRO_EVENTS: AstroEvent[] = [
  "nightEnd",
  "nauticalDawn",
  "dawn",
  "sunrise",
  "sunriseEnd",
  "goldenHourEnd",
  "solarNoon",
  "goldenHour",
  "sunsetStart",
  "sunset",
  "dusk",
  "nauticalDusk",
  "night",
  "nadir",
];

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isAstroEvent(name: string): name is AstroEvent {
  return (ASTRO_EVENTS as string[]).includes(name);
}

export interface CronParts {
  hour: number | "*";
  minute: number | "*";
  second: number | "*";
}

const CRON_PART = /^(\*|\d{1,2})$/;

/** `HH:MM[:SS]`, each part `*` or a number; never all `*`. */
export function parseCronAt(at: string): CronParts | undefined {
  const parts = at.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const [rawHour, rawMinute, rawSecond] = parts;
  if (
    !CRON_PART.test(rawHour) ||
    !CRON_PART.test(rawMinute) ||
    (rawSecond !== undefined && !CRON_PART.test(rawSecond))
  ) {
    return undefined;
  }
  const parse = (raw: string, max: number): number | "*" | undefined => {
    if (raw === "*") return "*";
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value <= max
      ? value
      : undefined;
  };
  const hour = parse(rawHour, 23);
  const minute = parse(rawMinute, 59);
  const second = rawSecond === undefined ? 0 : parse(rawSecond, 59);
  if (hour === undefined || minute === undefined || second === undefined) {
    return undefined;
  }
  if (hour === "*" && minute === "*" && second === "*") return undefined;
  return { hour, minute, second };
}

/** The next second a cron spec matches after `from` (local time). */
export function nextCron(
  spec: Extract<TimerSpec, { kind: "cron" }>,
  from: number,
): number | undefined {
  const parts = parseCronAt(spec.at);
  if (!parts) return undefined;
  const days =
    spec.days === undefined || spec.days === "*" ? null : new Set(spec.days);
  const first = Math.floor(from / 1000) * 1000 + 1000;
  const base = new Date(first);
  const hours =
    parts.hour === "*" ? Array.from({ length: 24 }, (_, i) => i) : [parts.hour];
  const minutes =
    parts.minute === "*"
      ? Array.from({ length: 60 }, (_, i) => i)
      : [parts.minute];
  const seconds =
    parts.second === "*"
      ? Array.from({ length: 60 }, (_, i) => i)
      : [parts.second];

  for (let offset = 0; offset <= 366; offset++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    day.setDate(day.getDate() + offset);
    if (days && !days.has(day.getDay())) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        for (const second of seconds) {
          const at = new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            hour,
            minute,
            second,
            0,
          ).getTime();
          if (at >= first) return at;
        }
      }
    }
  }
  return undefined;
}

/** A timer as the editor and the chips show it. */
export function timerLabel(timer: TimerSpec): string {
  if (typeof timer === "string") return `every ${timer}`;
  if (timer.kind === "astro") {
    const offset = timer.offset ?? 0;
    const suffix =
      offset === 0 ? "" : offset > 0 ? ` +${offset}m` : ` ${offset}m`;
    return `astro ${timer.event}${suffix}`;
  }
  const days =
    timer.days === undefined ||
    timer.days === "*" ||
    (Array.isArray(timer.days) && timer.days.length === 7)
      ? "*"
      : timer.days.map((day) => DAY_NAMES[day] ?? day).join(",");
  return `cron ${timer.at} · ${days}`;
}
