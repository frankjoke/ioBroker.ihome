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
 * The ioBroker admin's own theme choice, read from the same origin's
 * localStorage. The admin calls the setting `App.themeName`; its dark themes
 * are `dark`, `blue` and `modernDark`.
 * @returns {"auto" | "light" | "dark"}
 */
export function adminTheme() {
  try {
    const name = globalThis.localStorage?.getItem("App.themeName");
    if (name && name !== "auto") {
      return ["dark", "blue", "modernDark"].includes(name) ? "dark" : "light";
    }
  } catch {
    /* private mode or no storage: fall through to the system */
  }
  return "auto";
}

/**
 * Resolve the theme actually in effect: an explicit light/dark wins, else the
 * ioBroker admin's theme, else the system preference.
 * @param {ThemeMode} [mode]
 * @returns {"light" | "dark"}
 */
export function effectiveTheme(mode = getTheme()) {
  if (mode === "light" || mode === "dark") return mode;
  const fallback = adminTheme();
  if (fallback !== "auto") return fallback;
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
