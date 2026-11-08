import { expect, it } from "vitest";
import {
  distanceMeters,
  homeFromSystemConfig,
  isAtHome,
  locationText,
  mapUrl,
  normalizeConnection,
  phoneDecision,
  validDeviceId,
  validHome,
  validLocation,
  validPhoneName,
} from "./phone-ops";

it("accepts only safe device ids", () => {
  expect(validDeviceId("abc-123_X")).toBe("abc-123_X");
  expect(validDeviceId("a.b")).toBeNull();
  expect(validDeviceId("")).toBeNull();
  expect(validDeviceId("home")).toBeNull();
  expect(validDeviceId("x".repeat(65))).toBeNull();
});

it("validates and trims phone names", () => {
  expect(validPhoneName("  Frank's phone  ")).toBe("Frank's phone");
  expect(validPhoneName("")).toBeNull();
  expect(validPhoneName("x".repeat(65))).toBeNull();
});

it("validates locations and homes", () => {
  expect(validLocation({ lat: 48, lon: 16, ts: 1 })).toEqual({
    lat: 48,
    lon: 16,
    accuracy: undefined,
    ts: 1,
  });
  expect(validLocation({ lat: 91, lon: 16, ts: 1 })).toBeNull();
  expect(validLocation({ lat: 48, lon: 181, ts: 1 })).toBeNull();
  expect(validLocation({ lat: 48, lon: 16 })).toBeNull();
  expect(validHome({ lat: 48, lon: 16, radius: 150 })).toEqual({
    lat: 48,
    lon: 16,
    radius: 150,
  });
  expect(validHome({ lat: 48, lon: 16, radius: 0 })).toBeNull();
  expect(validHome({ lat: 48, lon: 16, radius: 20_000 })).toEqual({
    lat: 48,
    lon: 16,
    radius: 10_000,
  });
});

it("measures distance and applies the radius", () => {
  const home = { lat: 48.0, lon: 16.0, radius: 150 };
  expect(distanceMeters(home, home)).toBe(0);
  expect(isAtHome({ lat: 48.0005, lon: 16.0, ts: 1 }, home)).toBe(true);
  expect(isAtHome({ lat: 48.01, lon: 16.0, ts: 1 }, home)).toBe(false);
});

it("decides home from a fix or the absence of one", () => {
  const home = { lat: 48.0, lon: 16.0, radius: 150 };
  expect(phoneDecision(null, home)).toEqual({
    atHome: null,
    homeSource: "none",
    location: null,
  });
  expect(phoneDecision({ lat: 48.0005, lon: 16, ts: 1 }, home)).toEqual({
    atHome: true,
    homeSource: "geofence",
    location: null,
  });
  const away = { lat: 48.01, lon: 16, ts: 1 };
  expect(phoneDecision(away, home)).toEqual({
    atHome: false,
    homeSource: "geofence",
    location: away,
  });
});

it("renders a readable location and map link", () => {
  expect(locationText(null, true)).toBe("At home");
  expect(locationText({ lat: 48.123456, lon: 16.654321, ts: 1 }, false)).toBe(
    "48.12346, 16.65432",
  );
  expect(mapUrl(null)).toBe("");
  const embed = mapUrl({ lat: 48, lon: 16, ts: 1 });
  expect(embed).toContain("openstreetmap.org/export/embed.html");
  expect(embed).toContain("marker=48,16");
  expect(embed).toContain("bbox=");
});

it("normalizes connection types", () => {
  expect(normalizeConnection({ type: "wifi" })).toBe("wifi");
  expect(normalizeConnection({ type: "cellular" })).toBe("cellular");
  expect(normalizeConnection({ type: "5g" })).toBe("cellular");
  expect(normalizeConnection({ type: "ethernet" })).toBe("ethernet");
  expect(normalizeConnection(null)).toBe("unknown");
});

it("reads the home point from system config", () => {
  expect(
    homeFromSystemConfig({ common: { latitude: 48, longitude: 16 } }),
  ).toEqual({
    lat: 48,
    lon: 16,
    radius: 150,
  });
  expect(homeFromSystemConfig({})).toBeNull();
  expect(
    homeFromSystemConfig({ common: { latitude: 0, longitude: 0 } }),
  ).toBeNull();
});
