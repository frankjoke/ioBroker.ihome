import { applyWrite } from "$lib/utils/transform";
import type { Control } from "$lib/types/device";

/**
 * The bits of the broker this needs. Passed in by the caller (the components
 * already import the shared socket module), so this never imports it and stays
 * unit-testable — and no module-global client, which Vite's hot reload can hand
 * to two importers as two instances.
 */
export interface WriteClient {
  setState(id: string, value: unknown): Promise<unknown>;
}

/**
 * Toggles in flight, keyed by state id: a press is refused while an earlier one
 * is still unconfirmed.
 *
 * Two presses close together both read the *old* value and write the *same* new
 * value, which the device applies twice — one press, two toggles. A fixed timer
 * cannot tell a slow double-tap from a deliberate second press, so the guard is
 * the **value**: once the live value equals what we wrote, the broker has it and
 * the next press is allowed immediately; until then (or until the ceiling) writes
 * are refused. A slider never passes `lockMs` — every step of a drag must land.
 */
const pending = new Map<string, { wrote: unknown; until: number }>();

export function resetWriteLocks(): void {
  pending.clear();
}

/** Booleans compare by their ioBroker truth (true/1/"1"/"true"). */
function same(a: unknown, b: unknown): boolean {
  const boolish = (v: unknown) =>
    v === true || v === "true" || v === 1 || v === "1"
      ? true
      : v === false || v === "false" || v === 0 || v === "0"
        ? false
        : v;
  return boolish(a) === boolish(b);
}

export interface WriteOptions {
  /** Refuse further writes to this state for this long (toggles only). */
  lockMs?: number;
}

/**
 * Write a control through its transform. Returns whether the write was sent.
 *
 * `now` is injectable so the lock can be tested without waiting.
 */
export function writeControl(
  client: WriteClient,
  control: Pick<Control, "stateId" | "writable" | "transform"> & {
    available?: boolean;
    liveValue?: unknown;
  },
  value: unknown,
  now = Date.now(),
  options: WriteOptions = {},
): boolean {
  const id = control?.stateId;
  if (!id || !control.writable || control.available === false) return false;
  const lockMs = options.lockMs ?? 0;
  if (lockMs > 0) {
    const inFlight = pending.get(id);
    if (inFlight) {
      // Confirmed by the broker (the live value is the one we wrote) or past the
      // ceiling: this press is a fresh intention, not a duplicate.
      // "confirmed" = the live value is now the one we wrote.
      const confirmed = same(control.liveValue, inFlight.wrote);
      if (!confirmed && now < inFlight.until) return false;
    }
    pending.set(id, { wrote: value, until: now + lockMs });
  }
  const v = applyWrite(value, control.transform);
  client.setState(id, v).catch((e: unknown) => {
    console.warn("Failed to set state:", e);
  });
  return true;
}
