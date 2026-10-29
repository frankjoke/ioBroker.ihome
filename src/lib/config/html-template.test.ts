import { expect, it } from "vitest";
import {
  injectHtmlBridge,
  placeholderKeys,
  renderHtmlDocument,
  renderHtmlTemplate,
} from "$lib/config/html-template";

it("replaces placeholders and leaves unknown ones visible", () => {
  const values: Record<string, unknown> = { TV_IP: "192.168.1.5", empty: "" };
  const html =
    "<p>{{TV_IP}} / {{ TV_IP }} / {{missing}} / {{empty}} / {{0_userdata.0.x}}</p>";
  const out = renderHtmlTemplate(
    html,
    (key) => values[key] ?? (key === "0_userdata.0.x" ? 42 : undefined),
  );
  expect(out).toBe("<p>192.168.1.5 / 192.168.1.5 / {{missing}} /  / 42</p>");
});

it("lists placeholder keys in order", () => {
  expect(placeholderKeys("a {{ one }} b {{two}} {{ one }}")).toEqual([
    "one",
    "two",
    "one",
  ]);
});

it("puts the bridge before a document's own scripts", () => {
  const withHead = injectHtmlBridge(
    "<!doctype html><html><head><script>run()</script></head></html>",
  );
  expect(withHead.indexOf("window.ihome")).toBeGreaterThan(-1);
  expect(withHead.indexOf("window.ihome")).toBeLessThan(
    withHead.indexOf("<script>run()"),
  );

  const fragment = injectHtmlBridge("<h1>Hi</h1>");
  expect(fragment.startsWith("<script>")).toBe(true);
  expect(fragment).toContain("<h1>Hi</h1>");
});

it("renders placeholders and then injects the bridge", () => {
  const out = renderHtmlDocument("<h1>{{TV_IP}}</h1>", () => "10.0.0.2");
  expect(out).toContain("<h1>10.0.0.2</h1>");
  expect(out).toContain("window.ihome");
});
