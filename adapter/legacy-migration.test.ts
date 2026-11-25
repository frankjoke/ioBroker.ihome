import { expect, it } from "vitest";
import { legacyMigrationAllowed } from "./legacy-migration";

it("migrates the old test data only into ihome.0", () => {
  expect(legacyMigrationAllowed("ihome.0")).toBe(true);
  expect(legacyMigrationAllowed("ihome.1")).toBe(false);
});
