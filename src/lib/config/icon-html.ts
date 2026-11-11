import { renderHtmlTemplate } from "$lib/config/html-template";

/** An icon value that is markup rather than a symbol name or an image path. */
export function isHtmlIcon(raw: string | undefined): boolean {
  return String(raw ?? "")
    .trim()
    .startsWith("<");
}

/** A tooltip label for an icon value; markup is not worth showing in a title. */
export function iconTitle(value: string | undefined): string {
  return isHtmlIcon(value) ? "HTML/SVG icon" : String(value ?? "");
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

/** A frame document that fills the icon box: no margin, transparent, and an
 *  SVG at 100%. The icon's own markup is inserted after its placeholders
 *  resolve; the iframe sandbox is what makes arbitrary markup safe. */
export function iconHtmlDocument(
  html: string,
  data: Record<string, unknown> = {},
  resolve: (key: string) => unknown = () => undefined,
): string {
  const filled = renderHtmlTemplate(html, (key) => {
    const value = key.startsWith("$") ? data[key] : resolve(key);
    // A missing reading is 0, so `width="{{$value}}%"` stays valid SVG in a
    // preview or on a page without a value.
    if (value === undefined || value === null || value === "") {
      return key === "$value" ? "0" : "";
    }
    return escapeHtml(String(value));
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>${filled}</body></html>`;
}
