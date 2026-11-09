/**
 * iHome user plugin: read-only Network UPS Tools (NUT) monitor.
 *
 * Polls `LIST VAR <ups>` over TCP and writes one state per NUT variable under
 * `plugins.<id>.<variable>` in the iHome namespace (default
 * `ihome.0.plugins.nut.ups.*`; `base` can move it). Derived states make logic simple:
 * `nut.connected`, `nut.online`, `nut.onBattery`, `nut.lowBattery`,
 * `nut.charging`, `nut.discharging`, `nut.error`, `nut.lastUpdate`.
 *
 * No credentials are used. NUT normally allows `LIST VAR` read-only on the LAN.
 */
module.exports = (api) => {
  const net = require("node:net");

  const NUMERIC = {
    "battery.charge": { unit: "%", role: "value.battery" },
    "battery.charge.low": { unit: "%", role: "value.battery" },
    "battery.runtime": { unit: "s", role: "value.interval" },
    "battery.runtime.low": { unit: "s", role: "value.interval" },
    "battery.voltage": { unit: "V", role: "value.voltage" },
    "input.voltage": { unit: "V", role: "value.voltage" },
    "input.frequency": { unit: "Hz", role: "value" },
    "input.transfer.high": { unit: "V", role: "value.voltage" },
    "input.transfer.low": { unit: "V", role: "value.voltage" },
    "output.voltage": { unit: "V", role: "value.voltage" },
    "output.voltage.nominal": { unit: "V", role: "value.voltage" },
    "output.frequency.nominal": { unit: "Hz", role: "value" },
    "ups.load": { unit: "%", role: "value" },
    "ups.temperature": { unit: "°C", role: "value.temperature" },
    "ups.realpower": { unit: "W", role: "value.power" },
    "ups.power.nominal": { unit: "VA", role: "value.power" },
    "ups.delay.shutdown": { unit: "s", role: "value.interval" },
    "ups.delay.start": { unit: "s", role: "value.interval" },
    "ups.timer.shutdown": { unit: "s", role: "value.interval" },
    "ups.timer.start": { unit: "s", role: "value.interval" },
  };

  const DERIVED = {
    connected: {
      type: "boolean",
      role: "indicator.connected",
      name: "Connection to the NUT server",
    },
    error: { type: "string", role: "text", name: "Last NUT error" },
    lastUpdate: {
      type: "string",
      role: "date.start",
      name: "Last successful poll",
    },
    online: { type: "boolean", role: "indicator", name: "UPS on mains (OL)" },
    onBattery: {
      type: "boolean",
      role: "indicator.alarm",
      name: "UPS on battery (OB)",
    },
    lowBattery: {
      type: "boolean",
      role: "indicator.alarm",
      name: "Battery low (LB)",
    },
    charging: {
      type: "boolean",
      role: "indicator",
      name: "Battery charging (CHRG)",
    },
    discharging: {
      type: "boolean",
      role: "indicator",
      name: "Battery discharging (DISCHRG)",
    },
  };

  const pluginId = api.id || "nut.ups";
  const namespace = api.namespace;
  let current = api;
  let timer = null;
  let polling = null;
  let settings = readSettings(api.settings);
  let target = targetOf(settings.base);
  let last = {
    connected: false,
    status: "",
    batteryCharge: null,
    batteryRuntime: null,
    load: null,
    outputVoltage: null,
    lastUpdate: "",
    error: "not polled yet",
  };
  const known = new Set();

  function readSettings(raw) {
    const port = Number(raw && raw.port);
    const interval = Number(raw && raw.interval);
    return {
      host: String((raw && raw.host) || "localhost").trim() || "localhost",
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3493,
      ups: String((raw && raw.ups) || "ups").trim() || "ups",
      base:
        String((raw && raw.base) || "plugins." + pluginId).trim() ||
        "plugins." + pluginId,
      interval:
        (Number.isFinite(interval) ? Math.max(5, Math.round(interval)) : 30) *
        1000,
    };
  }

  /**
   * `base` may be relative (`nut` -> ihome.0.nut) or an absolute state folder
   * (`0_userdata.0.nut` -> foreign states).
   */
  function targetOf(base) {
    const value = base.replace(/^\.+|\.+$/g, "") || "nut";
    const absolute = /^[A-Za-z0-9_-]+\.[0-9]+(?:\.|$)/.test(value);
    if (!absolute || value === namespace || value.startsWith(namespace + ".")) {
      const prefix =
        value === namespace
          ? ""
          : value.startsWith(namespace + ".")
            ? value.slice(namespace.length + 1)
            : value;
      return { prefix, foreign: false };
    }
    return { prefix: value, foreign: true };
  }

  function stateId(id) {
    return target.prefix ? target.prefix + "." + id : id;
  }

  async function setValue(id, value) {
    if (target.foreign) {
      await current.state.setForeign(id, value, { ack: true });
    } else {
      await current.state.set(id, value, { ack: true });
    }
  }

  async function getObject(id) {
    return target.foreign
      ? current.objects.getForeign(id)
      : current.objects.get(id);
  }

  async function setObject(id, object) {
    if (target.foreign) await current.objects.setForeign(id, object);
    else await current.objects.set(id, object);
  }

  function toNumber(value) {
    if (value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function errorText(error) {
    if (!(error instanceof Error)) return String(error);
    if (error.message) return error.message;
    const nested = error.errors;
    if (Array.isArray(nested) && nested.length > 0) {
      return nested
        .map((entry) =>
          entry instanceof Error ? entry.message : String(entry),
        )
        .join("; ");
    }
    return error.name || "unknown error";
  }

  async function ensureFolder() {
    const id = target.prefix;
    if (!id || known.has("::" + id)) return;
    const existing = await getObject(id);
    if (!existing) {
      await setObject(id, {
        type: "folder",
        common: { name: "NUT UPS" },
        native: {},
      });
    }
    known.add("::" + id);
  }

  async function ensureObject(id, common) {
    if (known.has(id)) return;
    const existing = await getObject(id);
    if (!existing) {
      await setObject(id, {
        type: "state",
        common: { ...common, read: true, write: false },
        native: {},
      });
    }
    known.add(id);
  }

  function query(command) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({
        host: settings.host,
        port: settings.port,
      });
      let text = "";
      let finished = false;

      function finish(error) {
        if (finished) return;
        finished = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(text);
      }

      socket.setTimeout(4000, () => finish(new Error("NUT timeout after 4s")));
      socket.on("error", (error) => finish(error));
      socket.on("end", () => finish(new Error("NUT closed the connection")));
      socket.on("connect", () => socket.write(command + "\n"));
      socket.on("data", (chunk) => {
        text += chunk.toString("utf8");
        const error = /^ERR(?:\s|$)/m.exec(text);
        if (error) {
          finish(
            new Error(
              text.split(/\r?\n/).find((line) => line.startsWith("ERR")) ||
                "NUT error",
            ),
          );
          return;
        }
        if (/^END LIST(?:\s|$)/m.test(text)) finish();
      });
    });
  }

  function parseVars(text) {
    const vars = {};
    for (const line of text.split(/\r?\n/)) {
      const match = /^VAR\s+\S+\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/.exec(line);
      if (match) vars[match[1]] = match[2].replace(/\\(["\\])/g, "$1");
    }
    return vars;
  }

  async function pollOnce() {
    await ensureFolder();
    for (const [id, definition] of Object.entries(DERIVED)) {
      await ensureObject(stateId(id), {
        name: definition.name,
        type: definition.type,
        role: definition.role,
      });
    }

    const vars = parseVars(await query("LIST VAR " + settings.ups));
    if (vars["ups.status"] === undefined) {
      throw new Error(
        "NUT returned no ups.status; check the UPS name '" + settings.ups + "'",
      );
    }

    for (const [name, value] of Object.entries(vars)) {
      const id = stateId(name);
      const meta = NUMERIC[name];
      const type = meta ? "number" : "string";
      await ensureObject(id, {
        name,
        type,
        role: meta ? meta.role : "text",
        ...(meta && meta.unit ? { unit: meta.unit } : {}),
      });
      await setValue(id, type === "number" ? toNumber(value) : value);
    }

    const flags = new Set(String(vars["ups.status"]).split(/\s+/));
    const booleans = {
      online: flags.has("OL"),
      onBattery: flags.has("OB"),
      lowBattery: flags.has("LB"),
      charging: flags.has("CHRG"),
      discharging: flags.has("DISCHRG"),
    };
    for (const [id, value] of Object.entries(booleans)) {
      await setValue(stateId(id), value);
    }

    const stamp = new Date().toISOString();
    await setValue(stateId("lastUpdate"), stamp);
    await setValue(stateId("connected"), true);
    await setValue(stateId("error"), "");

    if (!last.connected && last.error && last.error !== "not polled yet") {
      current.log.info("NUT " + settings.ups + " reconnected");
    }
    last = {
      connected: true,
      status: vars["ups.status"],
      batteryCharge: toNumber(vars["battery.charge"]),
      batteryRuntime: toNumber(vars["battery.runtime"]),
      load: toNumber(vars["ups.load"]),
      outputVoltage: toNumber(vars["output.voltage"]),
      lastUpdate: stamp,
      error: "",
    };
    return last;
  }

  function poll() {
    if (polling) return polling;
    polling = (async () => {
      try {
        return await pollOnce();
      } catch (error) {
        const message = errorText(error);
        const first = message !== last.error;
        last = { ...last, connected: false, error: message };
        try {
          await ensureFolder();
          await ensureObject(stateId("connected"), {
            name: DERIVED.connected.name,
            type: DERIVED.connected.type,
            role: DERIVED.connected.role,
          });
          await ensureObject(stateId("error"), {
            name: DERIVED.error.name,
            type: DERIVED.error.type,
            role: DERIVED.error.role,
          });
          await setValue(stateId("connected"), false);
          await setValue(stateId("error"), message);
        } catch {
          // Nothing to write yet; the next interval retries.
        }
        if (first) current.log.warn("NUT poll failed: " + message);
        else current.log.debug("NUT poll failed: " + message);
        return last;
      } finally {
        polling = null;
      }
    })();
    return polling;
  }

  function startTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void poll(), settings.interval);
  }

  function logStart(log) {
    log.info(
      "NUT monitor " +
        settings.ups +
        " on " +
        settings.host +
        ":" +
        settings.port +
        " -> " +
        (target.prefix || namespace) +
        " every " +
        settings.interval / 1000 +
        "s",
    );
  }

  return {
    async start() {
      current = api;
      settings = readSettings(api.settings);
      target = targetOf(settings.base);
      startTimer();
      logStart(current.log);
      void poll();
    },

    async call(payload) {
      if (payload && payload.refresh === true) await poll();
      return { ...last };
    },

    async reload(next) {
      current = next;
      settings = readSettings(next.settings);
      target = targetOf(settings.base);
      startTimer();
      logStart(next.log);
      await poll();
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      current.log.info("NUT monitor stopped");
    },
  };
};
