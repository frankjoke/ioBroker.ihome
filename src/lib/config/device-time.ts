/** The parts of a control this lookup reads (a device-time subset). */
export interface TimeControl {
  id?: string;
  label?: string;
  stateId?: string;
  liveValue?: unknown;
  meta?: { role?: string };
}

function timestampOf(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 0 ? n : undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * When the device was last around: the `lastSeen` control's timestamp value,
 * else `lastConnected`, else any `value.time` control, else the newest state
 * update among the controls. A presence scan rewrites `online` every few
 * seconds, so the state timestamp alone says "just now" for an offline device.
 */
export function deviceTimestamp(
  controls: TimeControl[],
  stateTs: (stateId: string) => number | undefined,
): number | undefined {
  const named = (pattern: RegExp) =>
    controls.find((c) =>
      pattern.test(`${c.id ?? ""} ${c.label ?? ""} ${c.stateId ?? ""}`),
    );
  const namedValue =
    timestampOf(named(/last\s*seen/i)?.liveValue) ??
    timestampOf(named(/last\s*connected/i)?.liveValue) ??
    timestampOf(controls.find((c) => c.meta?.role === "value.time")?.liveValue);
  if (namedValue !== undefined) return namedValue;

  let latest: number | undefined;
  for (const c of controls) {
    if (!c.stateId) continue;
    const ts = stateTs(c.stateId);
    if (typeof ts === "number" && (latest === undefined || ts > latest)) {
      latest = ts;
    }
  }
  return latest;
}
