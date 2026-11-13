import { expect, it } from "vitest";
import { referenceFromSource, resolveTemplateReference } from "./template-reference";
import type { Device } from "$lib/types/device";
import type { GlobalVariable } from "./variables";

function state(role: string, type: string) {
  return { type: "state", common: { role, type } };
}

function variable(
  name: string,
  kind: GlobalVariable["kind"],
  stateId?: string,
): GlobalVariable {
  return {
    id: name,
    name,
    kind,
    type: "string",
    ...(stateId ? { stateId } : {}),
  };
}

it("keeps a raw state id as the reference", () => {
  const objects = new Map([["hue.0.lamp.on", state("switch.light", "boolean")]]);
  const ref = objects.get("hue.0.lamp.on");
  expect(resolveTemplateReference("hue.0.lamp.on", objects, [])).toEqual({
    reference: { ref: "hue.0.lamp.on", stateId: "hue.0.lamp.on", object: ref },
  });
});

it("resolves a state variable but stores its name", () => {
  const objects = new Map([
    ["0_userdata.0.Phone.ssid", state("text", "string")],
  ]);
  const variables = [variable("wifiSsid", "state", "0_userdata.0.Phone.ssid")];
  const resolved = resolveTemplateReference("wifiSsid", objects, variables);
  expect("reference" in resolved && resolved.reference).toMatchObject({
    ref: "wifiSsid",
    stateId: "0_userdata.0.Phone.ssid",
  });
});

it("rejects a constant, an unknown name and a missing state", () => {
  const variables = [variable("answer", "constant")];
  expect(
    "problem" in resolveTemplateReference("answer", new Map(), variables),
  ).toBe(true);
  expect(
    "problem" in resolveTemplateReference("missing", new Map(), variables),
  ).toBe(true);
  expect(
    "problem" in resolveTemplateReference("hue.0.gone", new Map(), []),
  ).toBe(true);
});

it("turns a picked device control into its state reference", () => {
  const device = {
    id: "d",
    name: "Lamp",
    type: "Light",
    controls: [
      {
        id: "c",
        feature: "power",
        stateId: "hue.0.lamp.on",
        writable: true,
      },
    ],
  } as Device;
  expect(
    referenceFromSource(
      { kind: "control", device: "d", control: "c" },
      [device],
    ),
  ).toBe("hue.0.lamp.on");
  expect(
    referenceFromSource({ kind: "state", stateId: "wifiSsid" }, [device]),
  ).toBe("wifiSsid");
});
