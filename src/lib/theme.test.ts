import { afterEach, expect, it, vi } from "vitest";
import { adminTheme, effectiveTheme } from "$lib/theme.svelte.js";

afterEach(() => vi.unstubAllGlobals());

function adminStored(name: string | null) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "App.themeName" ? name : null),
  });
}

it("maps the admin's dark theme names to dark", () => {
  for (const name of ["dark", "blue", "modernDark"]) {
    adminStored(name);
    expect(adminTheme()).toBe("dark");
  }
});

it("maps any other set admin theme to light", () => {
  adminStored("light");
  expect(adminTheme()).toBe("light");
  adminStored("someLightTheme");
  expect(adminTheme()).toBe("light");
});

it("treats auto or a missing admin theme as no opinion", () => {
  adminStored("auto");
  expect(adminTheme()).toBe("auto");
  adminStored(null);
  expect(adminTheme()).toBe("auto");
});

it("lets an explicit choice win and uses the admin for auto", () => {
  adminStored("dark");
  expect(effectiveTheme("light")).toBe("light");
  expect(effectiveTheme("auto")).toBe("dark");
});

it("falls back to the system when the admin has no theme", () => {
  adminStored(null);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(effectiveTheme("auto")).toBe("dark");
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  expect(effectiveTheme("auto")).toBe("light");
});
