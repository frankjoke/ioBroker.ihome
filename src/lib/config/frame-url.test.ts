import { expect, it } from "vitest";
import {
  appBaseUrl,
  appOrigin,
  frameUrl,
  resolveAppUrl,
  safeFrameUrl,
} from "$lib/config/frame-url";

const dev = {
  dev: true,
  origin: "http://192.168.178.9:8082/",
  pageOrigin: "http://localhost:5203",
};

it("gives the absolute broker base in dev and the relative base otherwise", () => {
  expect(appBaseUrl(dev)).toBe("http://192.168.178.9:8082/ihome/");
  expect(appBaseUrl({ dev: false, origin: "http://ignored" })).toBe("/ihome/");
  expect(appBaseUrl({ dev: true, origin: "", base: "/app/" })).toBe("/app/");
});

it("uses the page origin in production and the broker origin in dev", () => {
  expect(appOrigin(dev)).toBe("http://192.168.178.9:8082");
  expect(
    appOrigin({ dev: false, origin: "", pageOrigin: "https://pro/" }),
  ).toBe("https://pro");
});

it("substitutes origin and base in authored URLs", () => {
  expect(resolveAppUrl("{{origin}}/ihome/samsung.html", dev)).toBe(
    "http://192.168.178.9:8082/ihome/samsung.html",
  );
  expect(resolveAppUrl("{{base}}samsung.html", dev)).toBe(
    "http://192.168.178.9:8082/ihome/samsung.html",
  );
  expect(
    resolveAppUrl("{{origin}}/energiefluss/x", {
      dev: false,
      origin: "",
      pageOrigin: "https://pro.example",
    }),
  ).toBe("https://pro.example/energiefluss/x");
});

it("accepts //path as the current origin, but keeps host-like URLs", () => {
  expect(resolveAppUrl("//ihome/samsung.html", dev)).toBe(
    "http://192.168.178.9:8082/ihome/samsung.html",
  );
  expect(resolveAppUrl("//energiefluss/x", dev)).toBe(
    "http://192.168.178.9:8082/energiefluss/x",
  );
  expect(resolveAppUrl("//example.com/x", dev)).toBe("//example.com/x");
  expect(resolveAppUrl("//192.168.178.9:8082/x", dev)).toBe(
    "//192.168.178.9:8082/x",
  );
});

it("resolves stored frame paths against the broker in dev", () => {
  expect(frameUrl("samsung.html", dev)).toBe(
    "http://192.168.178.9:8082/ihome/samsung.html",
  );
  expect(frameUrl("/echarts/index.html?preset=x", dev)).toBe(
    "http://192.168.178.9:8082/echarts/index.html?preset=x",
  );
  expect(frameUrl("../energiefluss/index.html?instance=0", dev)).toBe(
    "http://192.168.178.9:8082/energiefluss/index.html?instance=0",
  );
  expect(frameUrl("{{origin}}/ihome/samsung.html", dev)).toBe(
    "http://192.168.178.9:8082/ihome/samsung.html",
  );
});

it("keeps absolute URLs and production values untouched", () => {
  expect(frameUrl("https://example.com/x", dev)).toBe("https://example.com/x");
  expect(frameUrl("//example.com/x", dev)).toBe("//example.com/x");
  expect(
    frameUrl("samsung.html", {
      dev: false,
      origin: "",
      pageOrigin: "https://pro.example",
    }),
  ).toBe("samsung.html");
  expect(frameUrl("", dev)).toBe("");
});

it("accepts only web URLs from a state", () => {
  expect(safeFrameUrl("https://example.com/x")).toBe("https://example.com/x");
  expect(safeFrameUrl("http://host/x")).toBe("http://host/x");
  expect(safeFrameUrl("//example.com/x")).toBe("//example.com/x");
  expect(safeFrameUrl("samsung.html")).toBe("samsung.html");
  expect(safeFrameUrl("{{origin}}/x")).toBe("{{origin}}/x");
  expect(safeFrameUrl("javascript:alert(1)")).toBe("");
  expect(safeFrameUrl(" data:text/html,x")).toBe("");
  expect(safeFrameUrl("java\nscript:alert(1)")).toBe("");
  expect(safeFrameUrl("")).toBe("");
});
