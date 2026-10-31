/**
 * A duration as the logic document writes it: whole seconds, minutes or hours
 * ("90s", "2m", "1h"). The engine, the validator and the editor all use this
 * one parser, so a value the editor accepts is always one the engine can run.
 */
const UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

export function parseDuration(text: string): number | null {
  if (typeof text !== "string") return null;
  const match = /^(\d+)([smh])$/.exec(text.trim());
  if (!match) return null;
  return Number(match[1]) * UNITS[match[2]];
}

export function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}
