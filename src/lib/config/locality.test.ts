import { expect, it } from "vitest";
import {
  classifySession,
  externalSessionSettings,
  parseHostList,
  showsExternalPolicyCard,
} from "./locality";

const cfg = (over: Record<string, unknown> = {}) => ({
  localHosts: [],
  externalHosts: [],
  forceExternal: false,
  ...over,
});

it.each([
  [
    "http://192.168.178.9:8082",
    "http:",
    "192.168.178.9",
    {},
    true,
    "private-host",
  ],
  ["http://localhost:8082", "http:", "localhost", {}, true, "private-host"],
  ["http://[::1]:8082", "http:", "::1", {}, true, "private-host"],
  [
    "https://192.168.178.9",
    "https:",
    "192.168.178.9",
    {},
    true,
    "private-host",
  ],
  ["http://my-pi.local", "http:", "my-pi.local", {}, true, "private-host"],
  ["http://172.20.1.5", "http:", "172.20.1.5", {}, true, "private-host"],
  ["http://169.254.1.1", "http:", "169.254.1.1", {}, true, "private-host"],
  ["http://[fd12::1]", "http:", "fd12::1", {}, true, "private-host"],
  ["http://[fe80::1]", "http:", "fe80::1", {}, true, "private-host"],
  [
    "https://home.example.com",
    "https:",
    "home.example.com",
    {},
    false,
    "https",
  ],
  [
    "http://home.example.com",
    "http:",
    "home.example.com",
    {},
    false,
    "public-http",
  ],
  [
    "http://100.101.102.103",
    "http:",
    "100.101.102.103",
    {},
    false,
    "public-http",
  ],
  ["http://172.32.1.5", "http:", "172.32.1.5", {}, false, "public-http"],
  [
    "https://vpn.example.com + localHosts",
    "https:",
    "vpn.example.com",
    { localHosts: ["vpn.example.com"] },
    true,
    "explicit-local",
  ],
  [
    "http://home.example.com + externalHosts",
    "http:",
    "home.example.com",
    { externalHosts: ["home.example.com"] },
    false,
    "explicit-external",
  ],
  [
    "forceExternal beats localhost",
    "http:",
    "localhost",
    { forceExternal: true },
    false,
    "force-external",
  ],
  [
    "duplicate lists prefer local",
    "http:",
    "both.example.com",
    { localHosts: ["both.example.com"], externalHosts: ["both.example.com"] },
    true,
    "explicit-local",
  ],
])("%s", (_label, protocol, hostname, settings, local, reason) => {
  expect(classifySession({ protocol, hostname, settings })).toEqual({
    external: !local,
    reason,
  });
});

it("normalises case, trailing dots, ports and IPv6 brackets", () => {
  expect(
    classifySession({
      protocol: "http:",
      hostname: "HOME.Example.com.",
      settings: cfg({ externalHosts: ["home.example.com:8443"] }),
    }),
  ).toEqual({ external: true, reason: "explicit-external" });
  expect(
    classifySession({
      protocol: "http:",
      hostname: "::1",
      settings: cfg({ localHosts: ["[::1]"] }),
    }),
  ).toEqual({ external: false, reason: "explicit-local" });
});

it("parses the settings leniently", () => {
  expect(externalSessionSettings(undefined)).toEqual({
    localHosts: [],
    externalHosts: [],
    forceExternal: false,
  });
  expect(externalSessionSettings("junk")).toEqual({
    localHosts: [],
    externalHosts: [],
    forceExternal: false,
  });
  expect(
    externalSessionSettings({
      localHosts: [" A.Example.com ", "a.example.com", "", 7],
      externalHosts: "not-a-list",
      forceExternal: "yes",
    }),
  ).toEqual({
    localHosts: ["a.example.com"],
    externalHosts: [],
    forceExternal: false,
  });
});

it("parses host text one per line", () => {
  expect(parseHostList("A.example.com\n\n b.example.com \n")).toEqual([
    "a.example.com",
    "b.example.com",
  ]);
  expect(parseHostList("x.com\nx.com")).toEqual(["x.com"]);
  expect(parseHostList("a".repeat(254))).toEqual([]);
  expect(
    parseHostList(
      Array.from({ length: 101 }, (_, i) => `h${i}.test`).join("\n"),
    ),
  ).toHaveLength(100);
});

it("treats only IP literals and *.local as private hosts", () => {
  expect(classifySession({ protocol: "https:", hostname: "fdic.gov" })).toEqual(
    { external: true, reason: "https" },
  );
  expect(classifySession({ protocol: "https:", hostname: "fc2.com" })).toEqual({
    external: true,
    reason: "https",
  });
  expect(
    classifySession({ protocol: "http:", hostname: "10.example.com" }),
  ).toEqual({ external: true, reason: "public-http" });
  expect(
    classifySession({ protocol: "http:", hostname: "172.15.1.1" }),
  ).toEqual({ external: true, reason: "public-http" });
  expect(
    classifySession({ protocol: "http:", hostname: "172.16.1.1" }),
  ).toEqual({ external: false, reason: "private-host" });
  expect(
    classifySession({ protocol: "http:", hostname: "172.31.1.1" }),
  ).toEqual({ external: false, reason: "private-host" });
});

it("keeps the core card reachable while force-external is on", () => {
  expect(
    showsExternalPolicyCard({ external: false, reason: "private-host" }),
  ).toBe(true);
  expect(
    showsExternalPolicyCard({ external: true, reason: "force-external" }),
  ).toBe(true);
  expect(
    showsExternalPolicyCard({ external: true, reason: "public-http" }),
  ).toBe(false);
  expect(
    showsExternalPolicyCard({ external: true, reason: "explicit-external" }),
  ).toBe(false);
});
