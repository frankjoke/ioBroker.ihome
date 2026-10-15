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
 * is still landing.
 *
 * Without this, two clicks in the same instant — a double click, or a handler
 * that fires twice — both read the *old* value and write the *same* new value,
 * which the device then applies twice: one press, two toggles. A slider must not
 * be locked (every step of a drag has to land), so only toggle-shaped writes pass
 * `lockMs`.
 */
const locks = new Map<string, number>();

export function resetWriteLocks(): void {
  locks.clear();
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
  },
  value: unknown,
  now = Date.now(),
  options: WriteOptions = {},
): boolean {
  const id = control?.stateId;
  if (!id || !control.writable || control.available === false) return false;
  const lockMs = options.lockMs ?? 0;
  if (lockMs > 0) {
    const until = locks.get(id);
    if (until !== undefined && now < until) return false;
    locks.set(id, now + lockMs);
  }
  const v = applyWrite(value, control.transform);
  client.setState(id, v).catch((e: unknown) => {
    console.warn("Failed to set state:", e);
  });
  return true;
}
