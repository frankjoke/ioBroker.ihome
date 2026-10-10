import type { Transform } from "$lib/types/device";
import { runStep } from "$lib/config/transform-ops";

/** Apply the read (input) step of a control transform. Never throws. */
export function applyRead(v: unknown, transform?: Transform): unknown {
  return runStep(transform?.read, v).value;
}

/** Apply the write (output) step of a control transform. Never throws. */
export function applyWrite(v: unknown, transform?: Transform): unknown {
  return runStep(transform?.write, v).value;
}
