/**
 * Temporary tracing for the intermittent double-toggle.
 *
 * Everything it prints is prefixed `[ihome-dbg]`, so the whole instrument can be
 * found (grep "ihome-dbg") and deleted once the cause is known: this file, its
 * two callers, and the logs in `Tile.svelte`, `slots/ControlWidget.svelte` and
 * `ioBrokerConnect.svelte.js`.
 */
export function logPointer(
  phase: string,
  e: {
    isTrusted: boolean;
    timeStamp: number;
    target: unknown;
    button?: number;
    detail?: number;
    /** Present on pointer events; a plain mouse click has none. */
    pointerType?: string;
  },
): void {
  const t = e.target as { tagName?: string; className?: string } | null;
  // Both clocks: `t` is the event's own timestamp (ms since navigation), `@` is
  // Date.now(), the same clock as the broker's ts — so a press can be lined up
  // with the writes and the change reports.
  console.log(
    `[ihome-dbg] ${phase} target=${t?.tagName ?? "?"}.${t?.className ?? ""} trusted=${e.isTrusted} btn=${e.button ?? "-"} detail=${e.detail ?? "-"} ptr=${e.pointerType ?? "-"} t=${Math.round(e.timeStamp)} @${Date.now()}`,
  );
}
