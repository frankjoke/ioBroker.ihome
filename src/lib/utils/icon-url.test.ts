import { it, expect, vi } from "vitest";
import type { PageRegistry, TemplateRegistry } from "$lib/types/display";
import { collectDocumentIcons, iconBase, iconSrc } from "./icon-url";
import { isImageIcon } from "$lib/config/icon-ops";

it("classifies symbols vs images", () => {
  expect(isImageIcon("lightbulb")).toBe(false);
  expect(isImageIcon("power_settings_new")).toBe(false);
  expect(isImageIcon("")).toBe(false);
  expect(isImageIcon(undefined)).toBe(false);
  expect(isImageIcon("https://x/y.png")).toBe(true);
  expect(isImageIcon("//x/y.svg")).toBe(true);
  expect(isImageIcon("data:image/svg+xml;base64,AAA")).toBe(true);
  expect(isImageIcon("/icons/a.png")).toBe(true);
  expect(isImageIcon("adapter/thing.png")).toBe(true);
  expect(isImageIcon("adapter/thing")).toBe(true); // broker-relative path
  expect(isImageIcon("two words")).toBe(false); // not a path, not a symbol - rendered as text
});

it("iconSrc resolves against the ioBroker base (A66)", () => {
  const b = "http://192.168.178.9:8081";
  // A symbol name is never a path.
  expect(iconSrc("lightbulb", "alias.0.x", b)).toBe("lightbulb");
  // Absolutes and data URIs pass through.
  expect(iconSrc("https://x/y.png", undefined, b)).toBe("https://x/y.png");
  expect(iconSrc("//x/y.png", undefined, b)).toBe("//x/y.png");
  expect(iconSrc("data:image/svg+xml;base64,AA", "x.0.y", b)).toBe(
    "data:image/svg+xml;base64,AA",
  );
  // A broker filename belongs to the adapter that owns the object.
  expect(iconSrc("energiefluss.png", "system.adapter.energiefluss.0", b)).toBe(
    b + "/adapter/energiefluss/energiefluss.png",
  );
  expect(iconSrc("icons/echo_dot.png", "alexa2.0.Dev.1", b)).toBe(
    b + "/adapter/alexa2/icons/echo_dot.png",
  );
  // An already root-relative broker path is not doubled.
  expect(iconSrc("adapter/admin/admin.svg", "system.adapter.admin", b)).toBe(
    b + "/adapter/admin/admin.svg",
  );
  // No owner: the broker root.
  expect(iconSrc("energiefluss.png", undefined, b)).toBe(
    b + "/energiefluss.png",
  );
  // A leading slash is broker-root-relative for a broker value, app-relative
  // for a document value.
  expect(iconSrc("/icons/a.png", undefined, b)).toBe("/icons/a.png");
  expect(iconSrc("/icons/a.png", "a.0.b", b)).toBe(b + "/icons/a.png");
  // Nothing, and no base (a bare test environment) are both safe.
  expect(iconSrc("")).toBe("");
  expect(iconSrc(undefined)).toBe("");
  expect(iconSrc("x.png", "a.0.b", "")).toBe("/adapter/a/x.png");
});

it("iconBase reads the footer host, else this origin (A66)", () => {
  const g = globalThis as any;
  const hadLs = "localStorage" in g;
  const hadLoc = "location" in g;
  const savedLs = g.localStorage;
  const savedLoc = g.location;
  try {
    delete g.localStorage;
    delete g.location;
    // No DOM at all: still a string, never undefined.
    expect(iconBase()).toBe("");
    g.location = { origin: "http://localhost:5173", protocol: "http:" };
    expect(iconBase()).toBe("http://localhost:5173");
    g.localStorage = {
      getItem: (key: string) =>
        key === "__VISUAL__:hostPort"
          ? JSON.stringify("192.168.178.9:8081")
          : null,
    };
    expect(iconBase()).toBe("http://192.168.178.9:8081");
    g.location = { origin: "https://broker", protocol: "https:" };
    expect(iconBase()).toBe("https://192.168.178.9:8081");
    // A corrupt setting falls back to the origin instead of throwing.
    g.localStorage = { getItem: () => "{not json" };
    expect(iconBase()).toBe("https://broker");
  } finally {
    if (hadLs) g.localStorage = savedLs;
    else delete g.localStorage;
    if (hadLoc) g.location = savedLoc;
    else delete g.location;
  }
});

it("iconSrc with no base argument uses the configured host, and absolutes bypass it (A66)", () => {
  const g = globalThis as any;
  const hadLs = "localStorage" in g;
  const hadLoc = "location" in g;
  const savedLs = g.localStorage;
  const savedLoc = g.location;
  try {
    g.location = { origin: "http://localhost:5173", protocol: "http:" };
    g.localStorage = {
      getItem: (key: string) =>
        key === "__VISUAL__:hostPort"
          ? JSON.stringify("192.168.178.9:8081")
          : null,
    };
    // The production path: no explicit base, so the footer's host is used.
    expect(iconSrc("energiefluss.png", "system.adapter.energiefluss.0")).toBe(
      "http://192.168.178.9:8081/adapter/energiefluss/energiefluss.png",
    );
    expect(iconSrc("icons/echo_dot.png", "alexa2.0.Dev.1")).toBe(
      "http://192.168.178.9:8081/adapter/alexa2/icons/echo_dot.png",
    );
    // Absolutes and symbols never consult the base at all.
    expect(iconSrc("https://x/y.png")).toBe("https://x/y.png");
    expect(iconSrc("data:image/svg+xml;base64,AA")).toBe(
      "data:image/svg+xml;base64,AA",
    );
    expect(iconSrc("lightbulb")).toBe("lightbulb");
  } finally {
    if (hadLs) g.localStorage = savedLs;
    else delete g.localStorage;
    if (hadLoc) g.location = savedLoc;
    else delete g.location;
  }
});

it("iconBase uses the configured broker fallback when nothing is stored", async () => {
  const g = globalThis as any;
  const hadLs = "localStorage" in g;
  const hadLoc = "location" in g;
  const savedLs = g.localStorage;
  const savedLoc = g.location;
  try {
    g.location = { origin: "http://localhost:5173", protocol: "http:" };
    g.localStorage = { getItem: () => null };
    vi.resetModules();
    vi.doMock("$lib/broker-config", () => ({
      FALLBACK_BROKER: "192.168.178.9:8082",
    }));
    const mod = await import("./icon-url");
    expect(mod.iconBase()).toBe("http://192.168.178.9:8082");
    vi.doUnmock("$lib/broker-config");
  } finally {
    vi.resetModules();
    if (hadLs) g.localStorage = savedLs;
    else delete g.localStorage;
    if (hadLoc) g.location = savedLoc;
    else delete g.location;
  }
});

it("collectDocumentIcons gathers every icon field, deduped", () => {
  const reg = {
    version: 1,
    updatedAt: 0,
    pages: [
      {
        id: "p",
        title: "P",
        icon: "home",
        groups: [
          {
            id: "g",
            title: "G",
            icon: "home",
            tiles: [
              {
                id: "t",
                device: "d",
                tile: {
                  slots: [
                    { kind: "value", rules: [{ icon: "flash_on" }] },
                    { kind: "value", icon: { glyph: "probe" } },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  } as unknown as PageRegistry;
  const tpl = {
    version: 1,
    updatedAt: 0,
    templates: [
      {
        id: "t1",
        name: "T",
        type: "Switch" as const,
        slots: [{ kind: "value", icon: { glyph: "bolt" } }],
      },
    ],
  } as unknown as TemplateRegistry;
  expect(collectDocumentIcons(reg, tpl)).toEqual([
    "bolt",
    "flash_on",
    "home",
    "probe",
  ]);
});
