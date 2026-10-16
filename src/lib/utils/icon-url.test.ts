import { it, expect } from "vitest";
import type { PageRegistry, TemplateRegistry } from "$lib/types/display";
import { collectDocumentIcons, iconUrl, isImageIcon } from "./icon-url";

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

it("iconUrl leaves absolutes alone and roots the rest", () => {
  expect(iconUrl("https://x/y.png")).toBe("https://x/y.png");
  expect(iconUrl("/icons/a.png")).toBe("/icons/a.png");
  expect(iconUrl("adapter/thing.png")).toBe("/adapter/thing.png");
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
                    {
                      kind: "icon",
                      options: { icon: "bolt" },
                      rules: [{ icon: "flash_on" }],
                    },
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
        slots: [{ kind: "icon", options: { icon: "bolt" } }],
      },
    ],
  } as unknown as TemplateRegistry;
  expect(collectDocumentIcons(reg, tpl)).toEqual(["bolt", "flash_on", "home"]);
});
