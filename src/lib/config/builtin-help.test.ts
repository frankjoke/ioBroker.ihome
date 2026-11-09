import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "$logic/templates";
import { BUILTIN_BUNDLES } from "./builtin-bundles";
import { BUILTIN_DEVICE_TEMPLATES } from "./device-templates";
import { PRESETS } from "./presets";

/** Every built-in template must explain itself to someone new to iHome. */
describe("built-in template help", () => {
  const all: Array<[string, string | undefined]> = [
    ...Object.values(PRESETS).map((template): [string, string | undefined] => [
      `device:${template.id}`,
      template.help,
    ]),
    ...BUILTIN_TEMPLATES.map((template): [string, string | undefined] => [
      `logic:${template.id}`,
      template.help,
    ]),
    ...BUILTIN_DEVICE_TEMPLATES.map(
      (template): [string, string | undefined] => [
        `api:${template.id}`,
        template.help,
      ],
    ),
    ...BUILTIN_BUNDLES.map((template): [string, string | undefined] => [
      `bundle:${template.id}`,
      template.help,
    ]),
  ];

  it("covers every built-in template", () => {
    const missing = all
      .filter(([, help]) => !String(help ?? "").trim())
      .map(([id]) => id);
    expect(missing).toEqual([]);
  });
});
