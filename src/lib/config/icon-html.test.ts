import { it, expect } from "vitest";
import { iconHtmlDocument, isHtmlIcon } from "./icon-html";

it("detects markup, not symbols or paths", () => {
  expect(isHtmlIcon("<svg/>")).toBe(true);
  expect(isHtmlIcon("  <div>x</div>")).toBe(true);
  expect(isHtmlIcon("lightbulb")).toBe(false);
  expect(isHtmlIcon("/icons/x.png")).toBe(false);
  expect(isHtmlIcon(undefined)).toBe(false);
});

it("fills $value and escapes it", () => {
  const doc = iconHtmlDocument('<svg><rect width="{{$value}}%"/></svg>', {
    $value: 42.5,
  });
  expect(doc).toContain('width="42.5%"');
  const bad = iconHtmlDocument('<svg data-x="{{$value}}"></svg>', {
    $value: '"><script>alert(1)</script>',
  });
  expect(bad).not.toContain("<script>");
  expect(bad).toContain("&quot;&gt;&lt;script&gt;");
});

it("wraps the markup so it fills the icon box", () => {
  const doc = iconHtmlDocument("<svg/>");
  expect(doc).toContain("width:100%;height:100%");
  expect(doc).toContain("<body><svg/></body>");
});

it("uses 0 for a missing $value so a width percentage stays valid", () => {
  expect(iconHtmlDocument('<rect width="{{$value}}%"/>')).toContain(
    'width="0%"',
  );
});

it("reads other placeholders through the resolver, missing as empty", () => {
  const doc = iconHtmlDocument("<p>{{name}} {{missing}}</p>", {}, (key) =>
    key === "name" ? "WZ" : undefined,
  );
  expect(doc).toContain("<p>WZ </p>");
});
