/** Placeholder substitution and the small state bridge for html slots. */

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** The keys a document asks for, in order (duplicates included). */
export function placeholderKeys(html: string): string[] {
  const keys: string[] = [];
  for (const match of html.matchAll(PLACEHOLDER)) {
    const key = String(match[1] ?? "").trim();
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * Replace `{{name}}` with the value the resolver returns. A missing value
 * keeps the placeholder visible, so a typo does not silently become empty.
 * Values are inserted as text (an IP, a number, a label), not escaped.
 */
export function renderHtmlTemplate(
  html: string,
  valueFor: (key: string) => unknown,
): string {
  return html.replace(PLACEHOLDER, (match, key: string) => {
    const value = valueFor(String(key).trim());
    return value === undefined || value === null ? match : String(value);
  });
}

/** The API the html slot's scripts can call (`ihome.setState(…)`, …). It talks
 *  to the parent through the same-origin frame boundary. */
const BRIDGE = `<script>
(function () {
  var api = {
    setState: function (id, value) { return parent.__IHOME__.setState(id, value); },
    getState: function (id) { return parent.__IHOME__.getState(id); },
    toggle: function (id) { return parent.__IHOME__.toggle(id); },
    setVariable: function (name, value) { return parent.__IHOME__.setVariable(name, value); },
    getVariable: function (name) { return parent.__IHOME__.getVariable(name); }
  };
  window.ihome = api;
  window.setState = api.setState;
  window.getState = api.getState;
  window.toggle = api.toggle;
  window.setVariable = api.setVariable;
  window.getVariable = api.getVariable;
})();
</script>`;

/** Put the bridge before the document's own scripts. A doctype must stay the
 *  first thing, so this adds it inside <head> (or <body>, or at the front for
 *  a fragment). */
export function injectHtmlBridge(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (tag) => tag + BRIDGE);
  }
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (tag) => tag + BRIDGE);
  }
  return BRIDGE + html;
}

export function renderHtmlDocument(
  html: string,
  valueFor: (key: string) => unknown,
): string {
  return injectHtmlBridge(renderHtmlTemplate(html, valueFor));
}
