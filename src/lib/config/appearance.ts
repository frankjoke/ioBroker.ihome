import type { Background } from "$lib/types/display";

/**
 * A background as the CSS a page or a section needs — one mapping, so a
 * section's background can never behave differently from a page's.
 */
export function backgroundCss(bg: Background | undefined): string {
  if (!bg?.value) return "";
  if (bg.kind === "image") {
    return `background-image: url("${bg.value}"); background-size: cover; background-attachment: fixed;`;
  }
  if (bg.kind === "gradient") {
    return `background-image: ${bg.value}; background-attachment: fixed;`;
  }
  return `background-color: ${bg.value};`;
}
