/** A draft edit never drops the owning plugin's marker. */
export function keepManaged<T extends { managed?: unknown }>(
  next: T,
  previous: T | undefined,
): T {
  return previous?.managed && !next.managed
    ? ({ ...next, managed: previous.managed } as T)
    : next;
}
