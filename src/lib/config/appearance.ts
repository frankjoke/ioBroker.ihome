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

/** `linear-gradient(<angle>deg, <from>, <to>)`. */
export function gradientValue(angle: number, from: string, to: string): string {
  return `linear-gradient(${angle}deg, ${from}, ${to})`;
}

/** The structured form of a plain two-stop linear gradient, or null (a gradient
 *  the builder did not write stays raw text in the editor). */
export function inspectGradient(
  value: string | undefined,
): { angle: number; from: string; to: string } | null {
  const m =
    /^\s*linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*\)\s*$/i.exec(
      String(value ?? ""),
    );
  if (!m) return null;
  return { angle: Number(m[1]), from: m[2], to: m[3] };
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` — what `<input type="color">` can show. */
export function isHexColor(value: string | undefined): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(
    String(value ?? ""),
  );
}
