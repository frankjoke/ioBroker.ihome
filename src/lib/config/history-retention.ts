export interface RetentionFields {
  retention: number;
  customRetentionDuration: number;
}

function numberValue(raw: unknown): number | undefined {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The retention window in days from a history adapter's state config. The
 * adapter stores seconds in `retention`; `-1` means “use the custom days”.
 * An absent `retention` means the adapter instance default is in charge.
 */
export function retentionDays(
  config: Record<string, unknown> | undefined,
): number | undefined {
  if (!config) return undefined;
  const raw = numberValue(config.retention);
  if (raw === undefined) return undefined;
  if (raw === -1) {
    const custom = numberValue(config.customRetentionDuration);
    return custom !== undefined && custom >= 0 ? custom : undefined;
  }
  return raw >= 0 ? raw / 86_400 : undefined;
}

/** Only these adapters read the per-state retention fields. */
export function supportsStateRetention(adapter: string): boolean {
  return /^(history|sql)\.\d+$/.test(adapter);
}

/** Both fields the history and sql adapters read. */
export function retentionValues(days: number): RetentionFields {
  const safe = Math.max(0, Math.round(days));
  return {
    retention: safe * 86_400,
    customRetentionDuration: safe,
  };
}

/** A compact line badge: forever, 30d, 1y, … */
export function retentionLabel(days: number | undefined): string {
  if (days === undefined) return "";
  if (days === 0) return "forever";
  if (days % 365 === 0) return `${days / 365}y`;
  return `${Math.round(days)}d`;
}
