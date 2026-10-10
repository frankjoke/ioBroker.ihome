import { createReactiveStorage } from "./localStorage.js";

/**
 * @typedef {"auto" | "light" | "dark"} ThemeMode
 */

const storage = createReactiveStorage([["theme", { init: "auto" }]], {
  prefix: "__VISUAL__:",
});

/**
 * Reactive theme storage — read `themeStorage.theme` in components
 * (`"auto" | "light" | "dark"`, defaults to `"auto"`).
 */
export const themeStorage = storage;

/**
 * @returns {ThemeMode}
 */
export function getTheme() {
  const mode = storage.theme;
  return mode === "light" || mode === "dark" ? mode : "auto";
}

/**
 * @param {ThemeMode} mode
 */
export function setTheme(mode) {
  storage.theme = mode;
}

/**
 * Resolve the theme actually in effect (auto follows the system).
 * @param {ThemeMode} [mode]
 * @returns {"light" | "dark"}
 */
export function effectiveTheme(mode = getTheme()) {
  if (mode === "light" || mode === "dark") return mode;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Apply the current theme to <html> and the browser chrome color.
 */
export function applyTheme() {
  if (typeof document === "undefined") return;
  const dark = effectiveTheme() === "dark";
  document.documentElement.classList.toggle("dark", dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0f131c" : "#f7f8fc");
}
