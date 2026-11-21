import { expect, it } from "vitest";
import type { SettingsObjectSchema } from "$adapter/settings-schema";
import { servicesSchema } from "./caddy-services-schema";

it("maps the endpoint options and kind-specific fields", () => {
  const schema = servicesSchema(["/phone-event"]);
  const item = schema[0].item as SettingsObjectSchema;
  const fields = item.fields;
  expect(fields.find((field) => field.name === "endpoint")?.options).toEqual([
    "/phone-event",
  ]);
  expect(
    fields.find((field) => field.name === "stripPrefix")?.visibleWhen,
  ).toEqual({ field: "kind", equals: "proxy" });
  expect(fields.find((field) => field.name === "path")?.visibleWhen).toEqual({
    field: "kind",
    equals: "proxy",
  });
  expect(fields.find((field) => field.name === "kind")?.readonly).toBe(true);
});
