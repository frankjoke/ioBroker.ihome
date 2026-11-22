import { afterEach, expect, it, vi } from "vitest";
import type { PluginApi } from "../plugin-api";
import {
  createPvForecastPlugin,
  daylightWindow,
  PVFORECAST_CONTRIBUTIONS,
} from "./pvforecast";

const NAMESPACE = "ihome.0";
const STATE = `${NAMESPACE}.plugins.pvforecast.json`;

interface FakeApi {
  api: PluginApi;
  written: Record<string, unknown>;
  objects: Record<string, unknown>;
  fetches: URL[];
}

function api(
  settings: Record<string, unknown>,
  state: Record<string, unknown> = {},
  objects: Record<string, unknown> = {
    "system.config": {
      common: {
        latitude: 48.1123,
        longitude: 16.6931,
        city: "Maria Ellend",
      },
    },
  },
): FakeApi {
  const written: Record<string, unknown> = {};
  const fetches: URL[] = [];
  const fake = {
    id: "pvforecast",
    namespace: NAMESPACE,
    config: {},
    settings,
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    state: {
      get: async (id: string) => (id in written ? written[id] : state[id]),
      set: async (id: string, value: unknown) => {
        written[id] = value;
      },
      getForeign: async () => undefined,
      setForeign: async () => undefined,
    },
    objects: {
      get: async (id: string) => objects[id],
      getForeign: async (id: string) => objects[id],
      set: async (id: string, value: unknown) => {
        objects[id] = value;
      },
      setForeign: async () => undefined,
    },
    network: { list: () => [], get: () => undefined },
    sendTo: async () => undefined,
  } as unknown as PluginApi;
  vi.stubGlobal("fetch", async (url: URL) => {
    fetches.push(url);
    return {
      ok: true,
      json: async () => ({
        result: {
          watts: { "2026-11-22T10:00:00+00:00": 1000 },
          watt_hours_period: { "2026-11-22T10:00:00+00:00": 500 },
        },
      }),
    };
  });
  return { api: fake, written, objects, fetches };
}

const SITE = {
  name: "Ost",
  tilt: 40,
  azimuth: -100,
  peakpower: 1.365,
  dampingMorning: 0,
  dampingEvening: 1,
};

function todayAt(hour: number): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hour,
    0,
  ).toISOString();
}

function tomorrowAt(hour: number): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    hour,
    0,
  ).toISOString();
}

function forecast(hours: Array<Record<string, unknown>>) {
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    location: { latitude: 48.1123, longitude: 16.6931 },
    sites: [],
    hours,
    errors: [],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sums today's energy and finds today's peak from the JSON state", async () => {
  const fake = api(
    { sites: [SITE] },
    {
      [STATE]: forecast([
        { time: todayAt(10), power: 2.5, energy: 1.2, sites: {} },
        { time: todayAt(11), power: 3.1, energy: 1.4, sites: {} },
        { time: tomorrowAt(12), power: 9, energy: 5, sites: {} },
      ]),
    },
  );
  const mod = createPvForecastPlugin()(fake.api);

  await expect(mod.call!({ action: "total" })).resolves.toEqual({
    date: new Date().toLocaleDateString("sv-SE"),
    total: 2.6,
  });
  const peak = (await mod.call!({ action: "peak" })) as {
    hour: string;
    power: number;
  };
  expect(peak.hour).toBe("11:00");
  expect(peak.power).toBe(3.1);
});

it("fails clearly when there is no forecast state yet", async () => {
  const mod = createPvForecastPlugin()(api({ sites: [SITE] }).api);
  await expect(mod.call!({ action: "total" })).rejects.toThrow(
    /No forecast data yet/,
  );
  await expect(mod.call!({ action: "unknown" })).rejects.toThrow(
    /Unknown action/,
  );
});

it("fetches every site, combines power and energy and writes one state", async () => {
  const fake = api({
    sites: [
      SITE,
      {
        ...SITE,
        name: "West",
        azimuth: 80,
        dampingMorning: 1,
        dampingEvening: 0,
      },
    ],
  });
  const mod = createPvForecastPlugin()(fake.api);

  const reply = (await mod.call!({
    action: "fetch",
    force: true,
  })) as { hours: number; errors: unknown[] };
  expect(reply).toMatchObject({ hours: 1, errors: [] });
  expect(fake.fetches).toHaveLength(2);
  const first = fake.fetches[0];
  expect(first.pathname).toBe("/estimate/48.1123/16.6931/40/-100/1.365");
  expect(first.searchParams.get("damping")).toBe("0,1");
  expect(first.searchParams.get("time")).toBe("utc");
  expect(fake.fetches[1].pathname).toBe(
    "/estimate/48.1123/16.6931/40/80/1.365",
  );

  const doc = JSON.parse(fake.written[STATE] as string);
  expect(doc.location.city).toBe("Maria Ellend");
  expect(doc.hours).toHaveLength(1);
  expect(doc.hours[0]).toMatchObject({
    time: "2026-11-22T10:00:00+00:00",
    power: 2,
    energy: 1,
  });
  expect(doc.hours[0].sites.Ost).toEqual({ power: 1, energy: 0.5 });
});

it("keeps the other sites when one fetch fails", async () => {
  const fake = api({
    sites: [SITE, { ...SITE, name: "West" }],
  });
  let call = 0;
  vi.stubGlobal("fetch", async () => {
    call += 1;
    if (call === 1) return { ok: false, status: 429, json: async () => ({}) };
    return {
      ok: true,
      json: async () => ({
        result: {
          watts: { "2026-11-22T10:00:00+00:00": 500 },
          watt_hours_period: { "2026-11-22T10:00:00+00:00": 250 },
        },
      }),
    };
  });
  const mod = createPvForecastPlugin()(fake.api);

  const reply = (await mod.call!({ action: "fetch", force: true })) as {
    errors: Array<{ site: string; error: string }>;
  };
  expect(reply.errors).toEqual([{ site: "Ost", error: "HTTP 429" }]);
  const doc = JSON.parse(fake.written[STATE] as string);
  expect(doc.hours[0].power).toBe(0.5);
});

it("keeps the last good forecast when every site fails", async () => {
  const previous = forecast([
    { time: todayAt(10), power: 2, energy: 1, sites: {} },
  ]);
  const fake = api({ sites: [SITE] }, { [STATE]: previous });
  vi.stubGlobal("fetch", async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
  }));
  const mod = createPvForecastPlugin()(fake.api);

  const reply = (await mod.call!({ action: "fetch", force: true })) as {
    hours: number;
    errors: unknown[];
  };
  expect(reply).toMatchObject({ hours: 0 });
  expect(reply.errors).toHaveLength(1);
  expect(fake.written[STATE]).toBeUndefined();
  await expect(mod.call!({ action: "total" })).resolves.toMatchObject({
    total: 1,
  });
});

it("does not fetch on start when the stored forecast is fresh", async () => {
  const fake = api(
    { sites: [SITE] },
    {
      [STATE]: forecast([
        { time: todayAt(10), power: 2, energy: 1, sites: {} },
      ]),
    },
  );
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    throw new Error("must not fetch");
  });
  const mod = createPvForecastPlugin()(fake.api);
  await mod.start!();
  expect(calls).toBe(0);
});

it("refuses to fetch without an ioBroker location", async () => {
  const fake = api({ sites: [SITE] }, {}, { "system.config": { common: {} } });
  const mod = createPvForecastPlugin()(fake.api);
  await expect(mod.call!({ action: "fetch", force: true })).rejects.toThrow(
    /system settings/,
  );
});

it("refuses duplicate site names and a missing kWp", async () => {
  const duplicate = createPvForecastPlugin()(
    api({ sites: [SITE, { ...SITE }] }).api,
  );
  await expect(
    duplicate.call!({ action: "fetch", force: true }),
  ).rejects.toThrow(/listed twice/);
  const zero = createPvForecastPlugin()(
    api({ sites: [{ ...SITE, peakpower: 0 }] }).api,
  );
  await expect(zero.call!({ action: "fetch", force: true })).rejects.toThrow(
    /kWp/,
  );
});

it("builds a daylight window around dawn and dusk", () => {
  const noon = Date.parse("2026-06-21T12:00:00Z");
  const window = daylightWindow(new Date(noon), {
    latitude: 48.1123,
    longitude: 16.6931,
  });
  expect(window).not.toBeNull();
  expect(window!.from.getTime()).toBeLessThan(noon);
  expect(window!.to.getTime()).toBeGreaterThan(noon);

  const night = Date.parse("2026-06-21T00:30:00Z");
  const wide = daylightWindow(new Date(night), {
    latitude: 48.1123,
    longitude: 16.6931,
  })!;
  expect(night < wide.from.getTime() || night > wide.to.getTime()).toBe(true);
});

it("ships the chart tile, hourly logic and read snippet", () => {
  expect(PVFORECAST_CONTRIBUTIONS.tiles?.[0]?.id).toBe("pvforecast-chart");
  const html = (
    PVFORECAST_CONTRIBUTIONS.tiles?.[0]?.slots as Array<{
      options: { html: string };
    }>
  )[0].options.html;
  expect(html).toContain(".plugins.pvforecast.json");
  expect(html).toContain("ihome.call");
  expect(html).toContain('id="age"');
  expect(html).toContain('id="total"');
  expect(html).toContain('id="peak"');
  expect(html).toContain("setAge(doc.generatedAt)");
  const logic = PVFORECAST_CONTRIBUTIONS.logic?.[0] as {
    logic: {
      inputs: { tick: { from: { spec: unknown } } };
      expr: { code: string };
    };
  };
  expect(logic.logic.inputs.tick.from.spec).toEqual({
    kind: "cron",
    at: "*:00",
    days: "*",
  });
  expect(logic.logic.expr.code).toContain('action: "fetch"');
  const snippets = PVFORECAST_CONTRIBUTIONS.snippets ?? [];
  expect(snippets[0].code).toContain('ihome.call("pvforecast"');
  expect(snippets[1].code).toContain('call("pvforecast", { action: "fetch" }');
});
