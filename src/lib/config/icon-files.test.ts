import { it, expect, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(async () => undefined) },
}));
import {
  extensionOf,
  iconFileName,
  isMetaIconValue,
  metaPathFor,
  slug,
} from "$lib/config/icon-files";

it("recognises values that point into the shared space", () => {
  expect(isMetaIconValue("/ihome.meta/icons/a.svg")).toBe(true);
  expect(isMetaIconValue("adapter/icons-freepic/x.svg")).toBe(false);
  expect(isMetaIconValue("data:image/png;base64,AA")).toBe(false);
  expect(metaPathFor("/ihome.meta/icons/a.svg")).toBe("icons/a.svg");
  expect(metaPathFor("lightbulb")).toBeUndefined();
});

it("names files by content, with a readable suffix", async () => {
  const name = await iconFileName("Ceiling Light.svg", "<svg>same</svg>");
  expect(name).toMatch(/^[0-9a-f]{8}-ceiling-light\.svg$/);
  const again = await iconFileName("other.svg", "<svg>same</svg>");
  expect(again.split("-")[0]).toBe(name.split("-")[0]);
  const different = await iconFileName("other.svg", "<svg>other</svg>");
  expect(different.split("-")[0]).not.toBe(name.split("-")[0]);
});

it("keeps the extension and slug short", () => {
  expect(extensionOf("A.PNG")).toBe("png");
  expect(extensionOf("noext")).toBe("noext");
  expect(slug("My CuStOm Icon!.svg")).toBe("my-custom-icon");
  expect(slug("")).toBe("");
});
