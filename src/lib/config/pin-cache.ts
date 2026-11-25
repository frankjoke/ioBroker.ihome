export interface PinCache {
  pin?: string;
  lockPencil?: boolean;
  pinDisabled?: boolean;
}

export function pinCacheFor(
  cache: Record<string, PinCache> | undefined,
  instance: string,
): PinCache {
  return cache?.[instance] ?? {};
}

export function withPinCache(
  cache: Record<string, PinCache> | undefined,
  instance: string,
  patch: Partial<PinCache>,
): Record<string, PinCache> {
  return {
    ...(cache ?? {}),
    [instance]: { ...pinCacheFor(cache, instance), ...patch },
  };
}
