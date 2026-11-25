/**
 * The old `0_userdata.0.Test.AiHome` documents and root-state cleanup belong to
 * the first install only. A new `ihome.N` starts empty instead of inheriting
 * the test data from `ihome.0`.
 */
export function legacyMigrationAllowed(instance: string): boolean {
  return instance === "ihome.0";
}
