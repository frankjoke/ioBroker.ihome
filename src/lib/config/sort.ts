import type { Device } from "$lib/types/device";

export type SortKey = "name" | "room" | "type";
export type SortDir = "asc" | "desc";

/** Return a sorted copy of the devices (name / room / type), asc or desc. */
export function sortDevices(
  devices: Device[],
  key: SortKey,
  dir: SortDir,
  roomLabel?: (d: Device) => string,
): Device[] {
  const value = (d: Device): string => {
    if (key === "name") return d.name ?? "";
    if (key === "room") return roomLabel?.(d) ?? d.room ?? "";
    return d.type ?? "";
  };
  const sign = dir === "desc" ? -1 : 1;
  return [...devices].sort(
    (a, b) =>
      sign *
      value(a).localeCompare(value(b), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );
}
