import { describe, expect, it } from "vitest";
import { renderHelp } from "./markdown";

describe("renderHelp", () => {
  it("renders paragraphs, emphasis and inline code", async () => {
    const html = await renderHelp("Hello **world** and `code`.");
    expect(html).toBe(
      "<p>Hello <strong>world</strong> and <code>code</code>.</p>\n",
    );
  });

  it("escapes raw HTML", async () => {
    const html = await renderHelp('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("opens external links in a new tab", async () => {
    const html = await renderHelp("[Docs](https://example.com/page)");
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps relative links in the same tab", async () => {
    const html = await renderHelp("[Setup](/docs/setup#tv)");
    expect(html).toContain('href="/docs/setup#tv"');
    expect(html).not.toContain("target=");
  });

  it("does not render unsafe link schemes", async () => {
    const html = await renderHelp("[x](javascript:alert(1))");
    expect(html).not.toContain("<a ");
  });

  it("renders headings and lists", async () => {
    const html = await renderHelp(
      "## Setup\n\n- one\n- **two**\n\n1. first\n2. second",
    );
    expect(html).toContain("<h2>Setup</h2>");
    expect(html).toContain(
      "<ul>\n<li>one</li>\n<li><strong>two</strong></li>\n</ul>",
    );
    expect(html).toContain("<ol>\n<li>first</li>\n<li>second</li>\n</ol>");
  });

  it("renders italic and keeps a single line break", async () => {
    expect(await renderHelp("*hello*")).toBe("<p><em>hello</em></p>\n");
    expect(await renderHelp("one\ntwo")).toBe("<p>one<br>two</p>\n");
  });

  it("renders fenced code blocks as escaped preformatted text", async () => {
    const html = await renderHelp("```js\nconst x = **1**;\n```");
    expect(html).toContain("<pre><code>const x = **1**;</code></pre>");
    expect(html).not.toContain("<strong>");
  });

  it("leaves Markdown inside inline code alone", async () => {
    const html = await renderHelp("`**not bold**`");
    expect(html).toContain("<code>**not bold**</code>");
  });

  it("returns empty output for empty input", async () => {
    expect(await renderHelp("")).toBe("");
    expect(await renderHelp(undefined)).toBe("");
  });
});
