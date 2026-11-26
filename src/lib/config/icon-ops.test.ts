import { it, expect } from "vitest";
import {
  adapterIcon,
  brokerIconPath,
  deviceFaceIcon,
  deviceObjectIcon,
  objectIconValue,
  glyphForRole,
  pluginPageAdapter,
  pluginPageIcon,
  presetGlyph,
  resolveIcon,
  stateRowIcon,
} from "$lib/config/icon-ops";
import { ownerOf } from "$lib/utils/icon-url";

it("names the adapter and instance an id belongs to", () => {
  expect(ownerOf("alias.0.1Stock.TemperaturBad")).toEqual({
    adapter: "alias",
    instance: "0",
  });
  expect(ownerOf("system.adapter.bambulab.0")).toEqual({
    adapter: "bambulab",
    instance: "0",
  });
  expect(ownerOf("system.adapter.bambulab")).toEqual({
    adapter: "bambulab",
    instance: undefined,
  });
  expect(ownerOf("enum.rooms.Bad")).toEqual({
    adapter: "enum",
    instance: "rooms",
  });
});

it("reads the first icon field an object carries (A65)", () => {
  expect(
    objectIconValue({
      common: { modelIcon: "m.png", extIcon: "e.png", icon: "i.png" },
    }),
  ).toEqual({ field: "modelIcon", value: "m.png" });
  expect(
    objectIconValue({ common: { extIcon: "e.png", icon: "i.png" } }),
  ).toEqual({ field: "extIcon", value: "e.png" });
  expect(objectIconValue({ common: { icon: "i.png" } })).toEqual({
    field: "icon",
    value: "i.png",
  });
  expect(objectIconValue({ common: { icon: "  " } })).toBeUndefined();
  expect(objectIconValue({ common: {} })).toBeUndefined();
  expect(objectIconValue(undefined)).toBeUndefined();
  expect(objectIconValue({ common: { icon: 42 } })).toBeUndefined();
});

const objects = (entries: [string, unknown][]) => new Map(entries);

it("walks up: the nearest object that carries an icon wins (A65)", () => {
  const channel = objects([
    ["alias.0.Ch.X", {}],
    ["alias.0.Ch", { common: { icon: "data:image/svg+xml;base64,AA" } }],
    ["alias.0", { common: { icon: "/icons/a.png" } }],
    ["system.adapter.alias.0", { common: { extIcon: "https://x/a.png" } }],
  ]);
  expect(resolveIcon(channel, "alias.0.Ch.X")).toEqual({
    from: "alias.0.Ch",
    value: "data:image/svg+xml;base64,AA",
  });

  // A field on the child beats whatever its parent carries.
  const deeper = objects([
    ["a.0.C.X", { common: { extIcon: "https://x/e.png" } }],
    ["a.0.C", { common: { modelIcon: "m.png" } }],
  ]);
  expect(resolveIcon(deeper, "a.0.C.X")).toEqual({
    from: "a.0.C.X",
    value: "https://x/e.png",
  });

  // A parent's icon beats the adapter's.
  const parent = objects([
    ["a.0.C", { common: { icon: "p.png" } }],
    ["system.adapter.a.0", { common: { extIcon: "https://x/a.png" } }],
  ]);
  expect(resolveIcon(parent, "a.0.C.X")).toEqual({
    from: "a.0.C",
    value: "p.png",
  });
});

it("falls back to the adapter, the instance first (A65)", () => {
  const instance = objects([
    ["a.0.C", {}],
    ["system.adapter.a.0", { common: { icon: "a.png" } }],
    ["system.adapter.a", { common: { icon: "package.png" } }],
  ]);
  expect(resolveIcon(instance, "a.0.C.X")).toEqual({
    from: "system.adapter.a.0",
    value: "a.png",
  });

  const pkg = objects([
    ["a.0.C", {}],
    ["system.adapter.a", { common: { icon: "package.png" } }],
  ]);
  expect(resolveIcon(pkg, "a.0.C.X")).toEqual({
    from: "system.adapter.a",
    value: "package.png",
  });

  expect(resolveIcon(objects([]), "a.0.C.X")).toBeUndefined();
  // An id with nothing to walk to terminates instead of looping.
  expect(resolveIcon(objects([]), "single")).toBeUndefined();
});

it("uses a state-path meta/folder/device icon, then the adapter", () => {
  const withFolder = objects([
    ["ihome.0.Logic", { type: "folder", common: { icon: "logic.svg" } }],
    ["ihome.0.Logic.X", { type: "state", common: {} }],
    ["system.adapter.ihome.0", { common: { icon: "ihome.png" } }],
  ]);
  expect(stateRowIcon(withFolder, "ihome.0.Logic.X")).toEqual({
    from: "ihome.0.Logic",
    value: "logic.svg",
  });

  const withMeta = objects([
    [
      "0_userdata.0",
      { type: "meta", common: { icon: "data:image/svg+xml;base64,AA" } },
    ],
    ["0_userdata.0.X", { type: "state", common: {} }],
  ]);
  expect(stateRowIcon(withMeta, "0_userdata.0.X")).toEqual({
    from: "0_userdata.0",
    value: "data:image/svg+xml;base64,AA",
  });

  const fallback = objects([
    ["a.0.C.X", { type: "state", common: {} }],
    ["system.adapter.a.0", { common: { icon: "a.png" } }],
  ]);
  expect(stateRowIcon(fallback, "a.0.C.X")).toEqual({
    from: "system.adapter.a.0",
    value: "a.png",
  });

  // The local instance file beats the package's remote extIcon.
  const local = objects([
    ["a.0.C.X", { type: "state", common: {} }],
    [
      "system.adapter.a.0",
      { common: { icon: "a.png", extIcon: "https://x/a.png" } },
    ],
  ]);
  expect(stateRowIcon(local, "a.0.C.X")).toEqual({
    from: "system.adapter.a.0",
    value: "a.png",
  });
});

it("keeps a broker icon portable for a document (A66)", () => {
  expect(
    brokerIconPath("energiefluss.png", "system.adapter.energiefluss.0"),
  ).toBe("adapter/energiefluss/energiefluss.png");
  expect(brokerIconPath("icons/echo_dot.png", "alexa2.0.Dev.1")).toBe(
    "adapter/alexa2/icons/echo_dot.png",
  );
  // Already portable, absolute, inline or a symbol: untouched.
  expect(
    brokerIconPath("adapter/admin/admin.svg", "system.adapter.admin"),
  ).toBe("adapter/admin/admin.svg");
  expect(brokerIconPath("data:image/svg+xml;base64,AA", "a.0.b")).toBe(
    "data:image/svg+xml;base64,AA",
  );
  expect(brokerIconPath("https://x/y.png", "a.0.b")).toBe("https://x/y.png");
  expect(brokerIconPath("lightbulb", "a.0.b")).toBe("lightbulb");
  expect(brokerIconPath("/icons/a.png", "a.0.b")).toBe("/icons/a.png");
  expect(brokerIconPath("", "a.0.b")).toBe("");
  // Markup is not a filename and must not gain an adapter prefix.
  const html = '<svg viewBox="0 0 24 24"><rect/></svg>';
  expect(brokerIconPath(html, "a.0.b")).toBe(html);
});

it("takes the device's first control that resolves (A65)", () => {
  const o = objects([["b.0.Ch", { common: { icon: "b.svg" } }]]);
  expect(deviceObjectIcon(o, ["a.0.none", "b.0.Ch.X", "c.0.Ch.Y"])).toEqual({
    from: "b.0.Ch",
    value: "b.svg",
  });
  expect(deviceObjectIcon(o, [undefined, "a.0.none"])).toBeUndefined();
  expect(deviceObjectIcon(o, [])).toBeUndefined();
});

it("uses the device type's preset glyph instead of the adapter fallback", () => {
  expect(presetGlyph("Button")).toBe("touch_app");
  expect(presetGlyph("Switch")).toBe("power_settings_new");
  expect(presetGlyph("Light")).toBe("lightbulb");
  // A variable-created state has no icon; its hit is only the adapter logo.
  expect(
    deviceFaceIcon(
      undefined,
      { from: "system.adapter.ihome.0", value: "ihome.png" },
      "Button",
    ),
  ).toBe("touch_app");
  // A real object icon wins over the type glyph.
  expect(
    deviceFaceIcon(
      undefined,
      { from: "alias.0.Lamp", value: "lamp.svg" },
      "Switch",
    ),
  ).toContain("lamp.svg");
  expect(deviceFaceIcon("own-icon", undefined, "Button")).toBe("own-icon");
  // Markup stays markup; it is not resolved as a broker-relative image.
  const html = '<svg viewBox="0 0 24 24"><rect/></svg>';
  expect(
    deviceFaceIcon(undefined, { from: "a.0.b", value: html }, "Custom"),
  ).toBe(html);
});

it("ignores page and adapter logos on the state's path", () => {
  const o = new Map<string, any>([
    [
      "0_userdata.0",
      { _id: "0_userdata.0", type: "meta", common: { icon: "page.svg" } },
    ],
    ["0_userdata.0.X", { _id: "0_userdata.0.X", type: "state", common: {} }],
    [
      "system.adapter.0_userdata",
      {
        _id: "system.adapter.0_userdata",
        type: "adapter",
        common: { icon: "adapter.png" },
      },
    ],
  ]);
  // The meta root's page icon is skipped; only the adapter fallback remains.
  expect(resolveIcon(o, "0_userdata.0.X")).toEqual({
    from: "system.adapter.0_userdata",
    value: "adapter.png",
  });
  // With no adapter fallback, there is no icon at all (the type glyph is used).
  expect(
    resolveIcon(new Map([...o].slice(0, 2)), "0_userdata.0.X"),
  ).toBeUndefined();
});

it("suggests a default glyph for a bare state's role", () => {
  expect(glyphForRole("switch")).toBe("power_settings_new");
  expect(glyphForRole("switch.light")).toBe("lightbulb");
  expect(glyphForRole("switch.lock")).toBe("lock");
  expect(glyphForRole("sensor.window")).toBe("sensor_door");
  expect(glyphForRole("sensor.motion")).toBe("directions_walk");
  expect(glyphForRole("button.next")).toBe("touch_app");
  expect(glyphForRole("value.battery")).toBe("battery_full");
  expect(glyphForRole("value.temperature")).toBe("thermostat");
  expect(glyphForRole("button")).toBe("touch_app");
  expect(glyphForRole("text")).toBe("text_fields");
  expect(glyphForRole("text.json")).toBe("text_fields");
  expect(glyphForRole("value.time")).toBe("schedule");
  expect(glyphForRole("indicator.updates")).toBe("sensors");
  expect(glyphForRole("state", "boolean")).toBe("toggle_on");
  expect(glyphForRole("state", "string")).toBeUndefined();
});

it("reads an adapter's own icon, instance first", () => {
  const objects = new Map<string, any>([
    ["system.adapter.admin.0", { common: { icon: "admin-instance.svg" } }],
    ["system.adapter.admin", { common: { icon: "admin.svg" } }],
    ["system.adapter.ihome", { common: { extIcon: "https://x/ihome.png" } }],
  ]);
  expect(adapterIcon(objects, "admin")).toEqual({
    value: "admin-instance.svg",
    owner: "system.adapter.admin.0",
  });
  expect(adapterIcon(objects, "ihome")).toEqual({
    value: "https://x/ihome.png",
    owner: "system.adapter.ihome",
  });
  expect(adapterIcon(objects, "nope")).toBeUndefined();
  expect(adapterIcon(objects, "")).toBeUndefined();
});

it("derives a plugin page's adapter icon from its URL", () => {
  expect(pluginPageAdapter("/iqontrol/")).toBe("iqontrol");
  expect(
    pluginPageAdapter("http://192.168.178.9:8082/iqontrol/index.html"),
  ).toBe("iqontrol");
  expect(pluginPageAdapter("https://example.com/")).toBeUndefined();

  const objects = new Map<string, any>([
    ["system.adapter.iqontrol", { common: { icon: "iqontrol.png" } }],
  ]);
  expect(
    pluginPageIcon(objects, { icon: "web_asset", url: "/iqontrol/" }),
  ).toEqual({ value: "iqontrol.png", owner: "system.adapter.iqontrol" });
  expect(
    pluginPageIcon(objects, { icon: "custom.png", url: "/iqontrol/" }),
  ).toEqual({ value: "custom.png" });
  expect(pluginPageIcon(objects, { icon: "web_asset", url: "/nope/" })).toEqual(
    { value: "web_asset" },
  );
});
