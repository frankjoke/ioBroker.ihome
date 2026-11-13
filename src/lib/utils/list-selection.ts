/**
 * The item a list should open after deleting `removedId`: the next one, or the
 * previous one when the deleted item was last.
 */
export function nextAfterRemoval<T>(
  items: readonly T[],
  removedId: string,
  idOf: (item: T) => string,
): T | undefined {
  const index = items.findIndex((item) => idOf(item) === removedId);
  if (index < 0) return undefined;
  return items[index + 1] ?? items[index - 1];
}
