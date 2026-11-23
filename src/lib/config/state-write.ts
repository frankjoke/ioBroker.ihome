import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function readObject(id: string): Promise<Record<string, any>> {
  if (!ioBroker.connected) throw new Error("Not connected to ioBroker");
  const object = (await ioBroker.emitAsync("getObject", id)) as Record<
    string,
    any
  > | null;
  if (!object || object.type !== "state") {
    throw new Error(`Not a state: ${id}`);
  }
  return object;
}

async function writeObject(
  id: string,
  object: Record<string, unknown>,
): Promise<void> {
  await ioBroker.emitAsync("setObject", id, object);
  ioBroker.objects?.update(id, object);
}

/** Write the editable common fields as the logged-in admin. This is the same
 *  path Admin uses for a foreign adapter's state objects. */
export async function writeStateCommon(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const object = await readObject(id);
  const common: Record<string, any> = record(object.common)
    ? { ...object.common }
    : {};
  if (typeof patch.name === "string") common.name = patch.name.trim();
  for (const key of ["role", "unit", "desc", "type"] as const) {
    if (typeof patch[key] === "string") common[key] = patch[key];
  }
  for (const key of ["min", "max", "step"] as const) {
    if (!(key in patch)) continue;
    if (patch[key] === null) delete common[key];
    else common[key] = patch[key];
  }
  for (const key of ["read", "write"] as const) {
    if (typeof patch[key] === "boolean") common[key] = patch[key];
  }
  if ("states" in patch) {
    if (patch.states === null) delete common.states;
    else common.states = patch.states;
  }
  await writeObject(id, {
    ...(object.type !== undefined ? { type: object.type } : {}),
    ...(record(object.native) ? { native: object.native } : {}),
    common,
  });
}

/** Write a full custom record as the logged-in admin; keys dropped from the
 *  record are marked null so the object db removes them. */
export async function writeStateCustom(
  id: string,
  custom: Record<string, unknown>,
): Promise<void> {
  const object = await readObject(id);
  const common: Record<string, any> = record(object.common)
    ? { ...object.common }
    : {};
  const previous = record(common.custom) ? common.custom : {};
  const next: Record<string, unknown> = { ...custom };
  for (const key of Object.keys(previous)) {
    if (!(key in next)) next[key] = null;
  }
  await writeObject(id, {
    ...(object.type !== undefined ? { type: object.type } : {}),
    ...(record(object.native) ? { native: object.native } : {}),
    common: { ...common, custom: next },
  });
}
