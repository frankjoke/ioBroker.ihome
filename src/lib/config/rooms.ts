import { localizeName } from "$lib/config/format";

/** Drop the `enum.<type>.` prefix from an enum id (e.g. enum.rooms.X → X). */
export function enumShortId(id: string): string {
  return String(id ?? "").replace(/^enum\.[^.]+\./, "");
}

/** Format an enum object as `Name (shortId)`, or just the short id. */
export function enumLabelFromObject(e: any): string {
  const short = enumShortId(e?._id ?? "");
  const name = localizeName(e?.common?.name);
  return name && name !== short ? `${name} (${short})` : short;
}

/** Format a known enum id (looked up in the enum list) as `Name (shortId)`. */
export function enumLabel(enums: any, id: string, type = "rooms"): string {
  if (!id) return "";
  const list = (enums?.getList(type) as any[]) ?? [];
  const e = list.find((x) => x._id === id);
  return e ? enumLabelFromObject(e) : enumShortId(id);
}

/** Room list from the enum cache, as {id, label, icon} triples. */
export function roomList(
  enums: any,
): { id: string; label: string; icon?: string }[] {
  return ((enums?.getList("rooms") as any[]) ?? []).map((e: any) => ({
    id: e._id,
    label: enumLabelFromObject(e),
    icon: e.common?.icon || undefined,
  }));
}

/** Find an enum object by id across every enum list (rooms, functions, ...). */
export function findEnum(enums: any, id: string): any | undefined {
  const lists = enums?.list ?? {};
  for (const arr of Object.values(lists)) {
    const found = (arr as any[])?.find((x) => x._id === id);
    if (found) return found;
  }
  return undefined;
}

/** Room display name (localized name, else the short id). */
export function roomName(enums: any, id: string): string {
  if (!id) return "";
  const list = (enums?.getList("rooms") as any[]) ?? [];
  const e = list.find((x) => x._id === id);
  return localizeName(e?.common?.name) || enumShortId(id);
}

/** Room enum ids a state belongs to. */
export function roomsOf(enums: any, id: string): string[] {
  const e: any = enums?.get(id);
  return (e?.rooms ?? []).map((r: any) => r._id);
}

/**
 * First room found for a state, walking from the state id up through its parent
 * folders (e.g. `alias.0.1Stock.FSZLampe.SET` → `alias.0.1Stock.FSZLampe`).
 */
export function roomForState(enums: any, id: string): string | undefined {
  const parts = id.split(".");
  for (let n = parts.length; n >= 2; n--) {
    const rooms = roomsOf(enums, parts.slice(0, n).join("."));
    if (rooms.length) return rooms[0];
  }
  return undefined;
}
