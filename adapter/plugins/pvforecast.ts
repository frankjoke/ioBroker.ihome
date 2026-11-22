// PV forecast: a catalog plugin built from the contribution model. It reads
// the ioBroker location, fetches forecast.solar per configured site and keeps
// one JSON state. The total/peak actions read that state; the logic template
// triggers the fetch; the tile draws the chart.

import { getTimes, type SunTimes } from "suncalc";
import type { PluginApi } from "../plugin-api";
import type { PluginFactory } from "../plugin-host";
import type { PluginContributions, PluginSettingDef } from "../plugin-ops";

interface Site {
  name: string;
  tilt: number;
  azimuth: number;
  peakpower: number;
  dampingMorning: number;
  dampingEvening: number;
}

interface Location {
  latitude: number;
  longitude: number;
  city?: string;
}

interface HourSite {
  power: number;
  energy: number;
}

interface ForecastHour {
  time: string;
  power: number;
  energy: number;
  sites: Record<string, HourSite>;
}

interface ForecastDoc {
  generatedAt: string;
  location: Location;
  sites: Site[];
  hours: ForecastHour[];
  errors: Array<{ site: string; error: string }>;
}

interface EstimateResponse {
  result?: {
    watts?: Record<string, number>;
    watt_hours_period?: Record<string, number>;
  };
  message?: { code?: number; type?: string; text?: string };
}

const SERVICE = "https://api.forecast.solar/estimate";
const FETCH_TIMEOUT = 5000;
const DAYLIGHT_MARGIN = 30 * 60 * 1000;
/** A stored forecast younger than this is reused instead of fetched again:
 *  the free service allows 12 calls per hour per IP and every site is a call. */
const FRESH_FOR = 55 * 60 * 1000;

const PVFORECAST_SITES: Site[] = [
  {
    name: "Ost",
    tilt: 40,
    azimuth: -100,
    peakpower: 1.365,
    dampingMorning: 0,
    dampingEvening: 1,
  },
  {
    name: "Süd",
    tilt: 40,
    azimuth: -10,
    peakpower: 3.64,
    dampingMorning: 0,
    dampingEvening: 1,
  },
  {
    name: "West",
    tilt: 40,
    azimuth: 80,
    peakpower: 1.365,
    dampingMorning: 1,
    dampingEvening: 0,
  },
  {
    name: "Terasse",
    tilt: 7,
    azimuth: 80,
    peakpower: 3.64,
    dampingMorning: 1,
    dampingEvening: 0,
  },
  {
    name: "Schaukel",
    tilt: 0,
    azimuth: 0,
    peakpower: 0.9,
    dampingMorning: 0,
    dampingEvening: 0,
  },
];

export const PVFORECAST_SETTINGS_SCHEMA: PluginSettingDef[] = [
  {
    name: "sites",
    label: "Sites",
    type: "array",
    item: {
      fields: [
        {
          name: "name",
          label: "Name",
          type: "string",
          required: true,
          description: "Short name shown in the chart.",
        },
        {
          name: "tilt",
          label: "Tilt",
          type: "number",
          default: 40,
          description: "Module tilt in degrees.",
        },
        {
          name: "azimuth",
          label: "Azimuth",
          type: "number",
          default: 0,
          description: "0 = south, -90 = east, 90 = west.",
        },
        {
          name: "peakpower",
          label: "kWp",
          type: "number",
          default: 1,
          description: "Installed peak power of this string.",
        },
        {
          name: "dampingMorning",
          label: "Damping morning",
          type: "number",
          default: 0,
        },
        {
          name: "dampingEvening",
          label: "Damping evening",
          type: "number",
          default: 0,
        },
      ],
    },
    description:
      "One row per string. The location comes from ioBroker system settings.",
  },
];

export const PVFORECAST_DEFAULT_SETTINGS = {
  sites: PVFORECAST_SITES,
};

export const PVFORECAST_HELP = `Fetches the free [forecast.solar](https://forecast.solar) estimate for every site in the table and keeps one JSON state.

- The location is read from ioBroker's system settings (\`system.config\`); do not duplicate latitude/longitude here.
- The plugin reuses a stored forecast younger than ~55 minutes and otherwise fetches once on start, then the **PV forecast hourly** logic triggers it. Fetch skips HTTP outside dawn−30 … dusk+30.
- The free service is rate-limited (12 requests/hour per IP) and every site is one request: the default five sites use 5 per hourly run, and a restart adds a round only when the stored forecast is older than ~55 minutes. If the old \`pvforecast.0\` adapter also polls the same service, stop one of them.

**State** — \`ihome.<instance>.plugins.pvforecast.json\`: generated timestamp, resolved location, sites, hourly power (kW) and energy (kWh), and per-site errors.

**Actions** — \`fetch\` (the logic target), \`total\` (today's kWh from the JSON state), \`peak\` (today's strongest hour and power). No other states.`;

export const PVFORECAST_USAGE = `**In an HTML tile (interactive)**

\`\`\`js
const total = await ihome.call("pvforecast", { action: "total" });
const peak = await ihome.call("pvforecast", { action: "peak" });
document.body.textContent =
  total.total + " kWh today · peak " + peak.hour + " (" + peak.power + " kW)";
\`\`\`

**From an iHome action**

\`\`\`js
call("pvforecast", { action: "fetch" }, (data, error) => {
  if (error) return log("PV forecast: " + error, "warn");
  if (data && data.skipped) return log("PV forecast skipped: " + data.reason);
  log("PV forecast updated");
});
\`\`\`

**Tile** — apply **PV forecast** from Templates → Plugins; it reads the JSON state and calls \`total\`/\`peak\`.`;

const PVFORECAST_TILE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { --text: #ddd; --muted: #999; --surface: #222; --border: #444; --primary: #4a9eff; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; padding: 10px; font: 13px/1.4 system-ui, sans-serif; color: var(--text); background: transparent; display: flex; flex-direction: column; overflow: hidden; }
  .head { margin-bottom: 2px; flex: 0 0 auto; }
  .title { font-weight: 600; }
  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; flex: 0 0 auto; }
  .badge { border: 1px solid var(--border); border-radius: 999px; padding: 1px 7px; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .badge.total { color: var(--text); border-color: var(--primary); }
  .badge.stale { color: #e5a33a; border-color: #e5a33a; }
  #plot { flex: 1 1 auto; min-height: 0; }
  .chart { width: 100%; height: 100%; display: block; }
  .empty, .note { color: var(--muted); font-size: 12px; margin: 2px 0 0; flex: 0 0 auto; }
  .error { color: #e55353; font-size: 12px; margin: 2px 0 0; flex: 0 0 auto; }
  .hidden { display: none; }
  .axis { stroke: var(--border); stroke-width: 1; }
  .grid { stroke: var(--border); stroke-width: 1; opacity: .35; }
  .line { fill: none; stroke: var(--primary); stroke-width: 2; }
  .area { fill: var(--primary); opacity: .18; }
  .label { fill: var(--muted); font-size: 10px; }
</style>
</head>
<body>
  <div class="head"><span class="title">PV forecast</span></div>
  <div class="badges">
    <span class="badge hidden" id="age"></span>
    <span class="badge total" id="total">—</span>
    <span class="badge hidden" id="peak"></span>
  </div>
  <div id="plot"></div>
  <p class="empty" id="empty">Waiting for the first forecast…</p>
  <p class="note hidden" id="note"></p>
  <p class="error hidden" id="error"></p>
<script>
  (function () {
    var JSON_ID = (ihome.namespace || "ihome.0") + ".plugins.pvforecast.json";
    var $ = function (id) { return document.getElementById(id); };
    function show(id, text) {
      var el = $(id);
      if (!el) return;
      el.textContent = text;
      el.classList.remove("hidden");
    }
    function hide(id) {
      var el = $(id);
      if (el) el.classList.add("hidden");
    }
    function syncTheme() {
      try {
        var s = parent.getComputedStyle(parent.document.documentElement);
        var root = document.documentElement.style;
        root.setProperty("--text", s.getPropertyValue("--text-color") || "#ddd");
        root.setProperty("--muted", s.getPropertyValue("--text-muted") || "#999");
        root.setProperty("--surface", s.getPropertyValue("--surface-color") || "#222");
        root.setProperty("--border", s.getPropertyValue("--border-color") || "#444");
        root.setProperty("--primary", s.getPropertyValue("--primary-color") || "#4a9eff");
      } catch (e) {}
    }
    syncTheme();
    try {
      new MutationObserver(syncTheme).observe(parent.document.documentElement, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
    function dayKey(date) {
      return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    }
    function hhmm(iso) {
      var d = new Date(iso);
      return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
    function setAge(iso) {
      var el = $("age");
      var at = new Date(iso).getTime();
      if (isNaN(at)) {
        el.textContent = "";
        el.title = "";
        el.classList.remove("stale");
        el.classList.add("hidden");
        return;
      }
      var minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
      var text = minutes < 1 ? "just now" : minutes < 60 ? minutes + "m ago" : Math.floor(minutes / 60) < 24 ? Math.floor(minutes / 60) + "h ago" : Math.floor(minutes / 1440) + "d ago";
      el.textContent = "updated " + text;
      el.title = new Date(at).toLocaleString();
      el.classList.remove("hidden");
      el.classList.toggle("stale", Date.now() - at > 2 * 3600000);
    }
    var lastDoc = null;
    function draw(doc) {
      lastDoc = doc;
      var plot = $("plot");
      var today = dayKey(new Date());
      var hours = (doc.hours || []).filter(function (h) { return dayKey(new Date(h.time)) === today; });
      hide("empty");
      if (!hours.length) {
        plot.innerHTML = "";
        show("empty", "No forecast for today yet.");
        return;
      }
      var max = Math.max.apply(null, hours.map(function (h) { return h.power || 0; }));
      max = Math.max(max, 0.1);
      var W = Math.max(280, plot.clientWidth || 600), H = Math.max(80, plot.clientHeight || 150), L = 34, R = 8, T = 8, B = 22;
      var w = W - L - R, h = H - T - B;
      var points = hours.map(function (row, i) {
        var x = L + (hours.length === 1 ? w / 2 : (i / (hours.length - 1)) * w);
        var y = T + h - (Math.max(0, row.power || 0) / max) * h;
        return [x, y];
      });
      var line = points.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      var area = line + " L" + (L + w).toFixed(1) + " " + (T + h) + " L" + L + " " + (T + h) + " Z";
      var labels = "";
      var grid = "";
      for (var g = 0; g <= 2; g++) {
        var y = T + (g / 2) * h;
        grid += '<line class="grid" x1="' + L + '" y1="' + y + '" x2="' + (L + w) + '" y2="' + y + '"/>';
        labels += '<text class="label" x="' + (L - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + (max * (1 - g / 2)).toFixed(1) + "</text>";
      }
      [0, Math.floor((hours.length - 1) / 2), hours.length - 1].forEach(function (index) {
        if (index < 0) return;
        var x = points[index][0];
        labels += '<text class="label" x="' + x + '" y="' + (H - 4) + '" text-anchor="middle">' + hhmm(hours[index].time) + "</text>";
      });
      plot.innerHTML = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="PV power forecast for today">' +
        '<line class="axis" x1="' + L + '" y1="' + (T + h) + '" x2="' + (L + w) + '" y2="' + (T + h) + '"/>' +
        grid + '<path class="area" d="' + area + '"/><path class="line" d="' + line + '"/>' + labels + "</svg>";
    }
    function refresh() {
      hide("error");
      var job = ihome.getState(JSON_ID).then(function (raw) {
        if (raw === undefined || raw === null || raw === "") throw new Error("No forecast data yet.");
        var doc = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!doc || !Array.isArray(doc.hours)) throw new Error("No forecast data yet.");
        draw(doc);
        setAge(doc.generatedAt);
        if (doc.errors && doc.errors.length) {
          show("note", "Failed: " + doc.errors.map(function (e) { return e.site; }).join(", "));
        } else {
          hide("note");
        }
        return Promise.all([
          ihome.call("pvforecast", { action: "total" }),
          ihome.call("pvforecast", { action: "peak" })
        ]).then(function (values) {
          var total = values[0] && values[0].total;
          var peak = values[1] && values[1];
          $("total").textContent = total === undefined ? "—" : total + " kWh today";
          if (peak && peak.hour) {
            $("peak").textContent = "peak " + peak.hour + " · " + peak.power + " kW";
            $("peak").classList.remove("hidden");
          } else {
            $("peak").textContent = "";
            $("peak").classList.add("hidden");
          }
        }).catch(function () {
          $("total").textContent = "Plugin not answering";
          $("peak").classList.add("hidden");
        });
      }).catch(function (error) {
        $("plot").innerHTML = "";
        show("empty", "Waiting for the first forecast…");
        show("error", String(error && error.message ? error.message : error));
        $("total").textContent = "—";
        $("age").textContent = "";
        $("age").classList.add("hidden");
        $("peak").classList.add("hidden");
      });
      return job;
    }
    refresh();
    setInterval(refresh, 60000);
    try {
      new ResizeObserver(function () { if (lastDoc) draw(lastDoc); }).observe($("plot"));
    } catch (e) {}
    window.addEventListener("resize", function () { if (lastDoc) draw(lastDoc); });
  })();
</script>
</body>
</html>`;

const PVFORECAST_LOGIC = {
  id: "pvforecast-hourly",
  name: "PV forecast hourly",
  kind: "function",
  inputs: {
    tick: {
      from: { type: "timer", spec: { kind: "cron", at: "*:00", days: "*" } },
      kind: "event",
    },
  },
  output: { scope: "memory", name: "pvforecastTick" },
  mode: "statements",
  expr: {
    code: `call("pvforecast", { action: "fetch" }, (data, error) => {
  if (error) return log("PV forecast: " + error, "warn");
  if (data && data.skipped) return log("PV forecast skipped: " + data.reason);
  log("PV forecast updated: " + data.hours + " hours, " + data.errors.length + " errors");
});`,
  },
} as const;

export const PVFORECAST_CONTRIBUTIONS: PluginContributions = {
  tiles: [
    {
      id: "pvforecast-chart",
      name: "PV forecast",
      description:
        "Today's PV power curve with the day total, peak hour and update age.",
      help: `Apply this tile after installing and enabling the PV forecast plugin and applying the **PV forecast hourly** logic.

It reads \`ihome.<instance>.plugins.pvforecast.json\` through the HTML bridge and calls the \`total\` and \`peak\` actions every minute. That state holds the generated time, resolved location, sites and the hourly power/energy; the tile is not a bound value slot because an HTML slot's source means "this state holds the HTML document". The location comes from ioBroker system settings.`,
      type: "Custom",
      bindings: "none",
      size: { w: 12, h: 5 },
      features: [],
      slots: [{ kind: "html", options: { html: PVFORECAST_TILE_HTML } }],
    },
  ],
  logic: [
    {
      id: "pvforecast-hourly",
      name: "PV forecast hourly",
      description:
        "Calls the PV forecast plugin every hour; the plugin skips outside daylight.",
      help: `Calls \`fetch\` on the PV forecast plugin every hour. The plugin itself skips HTTP outside dawn−30 … dusk+30 (using the ioBroker location), so the logic can stay a simple hourly timer.

Install and enable the PV forecast plugin first; apply this template from Templates → Templates or the logic editor.`,
      params: [],
      logic: PVFORECAST_LOGIC,
    },
  ],
  snippets: [
    {
      id: "pvforecast-tile",
      name: "Read the forecast in an HTML tile",
      description: "Interactive: paste into an HTML tile on the dashboard.",
      language: "js",
      code: `const total = await ihome.call("pvforecast", { action: "total" });
const peak = await ihome.call("pvforecast", { action: "peak" });
document.body.textContent =
  total.total + " kWh today · peak " + peak.hour + " (" + peak.power + " kW)";`,
    },
    {
      id: "pvforecast-action",
      name: "Fetch from an iHome action",
      description: "Runs in an iHome logic action and logs the result.",
      language: "js",
      code: `call("pvforecast", { action: "fetch" }, (data, error) => {
  if (error) return log("PV forecast: " + error, "warn");
  if (data && data.skipped) return log("PV forecast skipped: " + data.reason);
  log("PV forecast updated: " + data.hours + " hours");
});`,
    },
  ],
};

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** `YYYY-MM-DD` in the machine's local timezone. */
function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The fetch window around sunrise/sunset, or null when the sun is not
 *  computable (polar day/night or a broken suncalc). */
export function daylightWindow(
  now: Date,
  location: { latitude: number; longitude: number },
): { from: Date; to: Date } | null {
  let times: SunTimes;
  try {
    times = getTimes(now, location.latitude, location.longitude);
  } catch {
    return null;
  }
  const dawn = times.dawn;
  const dusk = times.dusk;
  if (
    !(dawn instanceof Date) ||
    !(dusk instanceof Date) ||
    Number.isNaN(dawn.getTime()) ||
    Number.isNaN(dusk.getTime())
  ) {
    return null;
  }
  return {
    from: new Date(dawn.getTime() - DAYLIGHT_MARGIN),
    to: new Date(dusk.getTime() + DAYLIGHT_MARGIN),
  };
}

function readSites(raw: unknown): Site[] {
  let rows: unknown = raw;
  if (typeof raw === "string") {
    try {
      rows = JSON.parse(raw) as unknown;
    } catch {
      throw new Error("The sites setting is not valid JSON.");
    }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Add at least one site in the plugin settings.");
  }
  const seen = new Set<string>();
  return rows.map((value, index) => {
    const row =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) throw new Error(`Site ${index + 1} needs a name.`);
    if (seen.has(name)) throw new Error(`Site ${name} is listed twice.`);
    seen.add(name);
    const number = (key: string, fallback: number): number => {
      const value = Number(row[key]);
      return Number.isFinite(value) ? value : fallback;
    };
    const peakpower = number("peakpower", 1);
    if (!(peakpower > 0)) {
      throw new Error(`Site ${name} needs a positive kWp value.`);
    }
    return {
      name,
      tilt: number("tilt", 40),
      azimuth: number("azimuth", 0),
      peakpower,
      dampingMorning: number("dampingMorning", 0),
      dampingEvening: number("dampingEvening", 0),
    };
  });
}

async function fetchJson(url: URL): Promise<EstimateResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as EstimateResponse;
  } finally {
    clearTimeout(timer);
  }
}

export class PvForecastPlugin {
  private ready = false;
  private readonly api: PluginApi;

  constructor(api: PluginApi) {
    this.api = api;
  }

  private stateId(name: string): string {
    return `${this.api.namespace}.plugins.${this.api.id}.${name}`;
  }

  private async ensureState(): Promise<void> {
    if (this.ready) return;
    const folder = `${this.api.namespace}.plugins.${this.api.id}`;
    const json = this.stateId("json");
    if (!(await this.api.objects.get(folder))) {
      await this.api.objects.set(folder, {
        type: "folder",
        common: { name: "PV forecast" },
        native: {},
      });
    }
    if (!(await this.api.objects.get(json))) {
      await this.api.objects.set(json, {
        type: "state",
        common: {
          name: "Forecast JSON",
          type: "string",
          role: "json",
          read: true,
          write: false,
        },
        native: {},
      });
    }
    this.ready = true;
  }

  private async location(): Promise<Location> {
    const config = await this.api.objects.getForeign("system.config");
    const common =
      config && typeof config.common === "object" && config.common
        ? (config.common as Record<string, unknown>)
        : {};
    const latitude = Number(common.latitude);
    const longitude = Number(common.longitude);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180 ||
      (latitude === 0 && longitude === 0)
    ) {
      throw new Error(
        "Set the location in ioBroker system settings (system.config).",
      );
    }
    const city =
      typeof common.city === "string" && common.city.trim()
        ? common.city.trim()
        : undefined;
    return { latitude, longitude, ...(city ? { city } : {}) };
  }

  private async fetchForecast(force: boolean): Promise<unknown> {
    const sites = readSites(this.api.settings.sites);
    const location = await this.location();
    const now = new Date();
    if (!force) {
      const daylight = daylightWindow(now, location);
      if (daylight && (now < daylight.from || now > daylight.to)) {
        return {
          skipped: true,
          reason: "outside daylight",
          from: daylight.from.toISOString(),
          to: daylight.to.toISOString(),
        };
      }
    }
    const hours = new Map<string, ForecastHour>();
    const errors: Array<{ site: string; error: string }> = [];
    for (const site of sites) {
      const url = new URL(
        `${SERVICE}/${location.latitude}/${location.longitude}/${site.tilt}/${site.azimuth}/${site.peakpower}`,
      );
      url.searchParams.set(
        "damping",
        `${site.dampingMorning},${site.dampingEvening}`,
      );
      url.searchParams.set("time", "utc");
      try {
        const body = await fetchJson(url);
        if (!body.result) {
          throw new Error(body.message?.text || "no result");
        }
        for (const [time, watts] of Object.entries(body.result.watts ?? {})) {
          const hour =
            hours.get(time) ??
            ({ time, power: 0, energy: 0, sites: {} } satisfies ForecastHour);
          const power = Number(watts) / 1000;
          hour.power += power;
          hour.sites[site.name] = {
            ...(hour.sites[site.name] ?? { power: 0, energy: 0 }),
            power,
          };
          hours.set(time, hour);
        }
        for (const [time, wh] of Object.entries(
          body.result.watt_hours_period ?? {},
        )) {
          const hour =
            hours.get(time) ??
            ({ time, power: 0, energy: 0, sites: {} } satisfies ForecastHour);
          const energy = Number(wh) / 1000;
          hour.energy += energy;
          hour.sites[site.name] = {
            ...(hour.sites[site.name] ?? { power: 0, energy: 0 }),
            energy,
          };
          hours.set(time, hour);
        }
      } catch (error) {
        errors.push({ site: site.name, error: errorText(error) });
      }
    }
    const doc: ForecastDoc = {
      generatedAt: now.toISOString(),
      location,
      sites,
      hours: [...hours.values()]
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((hour) => ({
          time: hour.time,
          power: round(hour.power),
          energy: round(hour.energy),
          sites: Object.fromEntries(
            Object.entries(hour.sites).map(([name, value]) => [
              name,
              {
                power: round(value.power),
                energy: round(value.energy),
              },
            ]),
          ),
        })),
      errors,
    };
    // A rate limit or an outage must not wipe the last good forecast.
    if (doc.hours.length === 0) {
      this.api.log.warn(
        `PV forecast: every site failed (${errors
          .map((entry) => `${entry.site}: ${entry.error}`)
          .join("; ")}); keeping the last forecast`,
      );
      return { generatedAt: doc.generatedAt, hours: 0, errors };
    }
    await this.ensureState();
    await this.api.state.set(this.stateId("json"), JSON.stringify(doc), {
      ack: true,
    });
    return {
      generatedAt: doc.generatedAt,
      hours: doc.hours.length,
      errors: doc.errors,
    };
  }

  private async readDoc(): Promise<ForecastDoc> {
    const raw = await this.api.state.get(this.stateId("json"));
    if (typeof raw !== "string" || !raw.trim()) {
      throw new Error("No forecast data yet; run fetch first.");
    }
    let doc: ForecastDoc;
    try {
      doc = JSON.parse(raw) as ForecastDoc;
    } catch {
      throw new Error("The forecast JSON state is not valid JSON.");
    }
    if (!doc || !Array.isArray(doc.hours)) {
      throw new Error("The forecast JSON state has no hours.");
    }
    return doc;
  }

  private todayHours(doc: ForecastDoc): ForecastHour[] {
    const date = localDay(new Date());
    return doc.hours.filter((hour) => localDay(new Date(hour.time)) === date);
  }

  private async total(): Promise<{ date: string; total: number }> {
    const doc = await this.readDoc();
    const date = localDay(new Date());
    const total = this.todayHours(doc).reduce(
      (sum, hour) => sum + (Number(hour.energy) || 0),
      0,
    );
    return { date, total: round(total) };
  }

  private async peak(): Promise<{
    hour: string | null;
    time: string | null;
    power: number | null;
  }> {
    const doc = await this.readDoc();
    const hours = this.todayHours(doc);
    if (hours.length === 0) return { hour: null, time: null, power: null };
    const best = hours.reduce((a, b) =>
      (Number(b.power) || 0) > (Number(a.power) || 0) ? b : a,
    );
    const at = new Date(best.time);
    return {
      hour: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`,
      time: best.time,
      power: round(Number(best.power) || 0),
    };
  }

  private async fresh(): Promise<boolean> {
    try {
      const doc = await this.readDoc();
      const at = Date.parse(doc.generatedAt);
      return (
        doc.hours.length > 0 &&
        Number.isFinite(at) &&
        Date.now() - at < FRESH_FOR
      );
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    if (await this.fresh()) {
      this.api.log.debug(
        "PV forecast: the stored forecast is fresh; not fetching",
      );
      return;
    }
    void this.fetchForecast(true).catch((error) => {
      this.api.log.warn(`PV forecast start: ${errorText(error)}`);
    });
  }

  async stop(): Promise<void> {
    // The logic owns the schedule; nothing to clean up.
  }

  async call(payload: unknown): Promise<unknown> {
    const action =
      payload && typeof payload === "object"
        ? String((payload as { action?: unknown }).action ?? "")
        : "";
    switch (action) {
      case "fetch":
        return this.fetchForecast(
          (payload as { force?: unknown }).force === true,
        );
      case "total":
        return this.total();
      case "peak":
        return this.peak();
      default:
        throw new Error(`Unknown action: ${action || "(none)"}`);
    }
  }
}

export function createPvForecastPlugin(): PluginFactory {
  return (api: PluginApi) => {
    const plugin = new PvForecastPlugin(api);
    return {
      start: () => plugin.start(),
      // Reads settings and system.config per call, so a save hot-applies.
      reload: () => undefined,
      stop: () => plugin.stop(),
      call: (payload: unknown) => plugin.call(payload),
    };
  };
}
