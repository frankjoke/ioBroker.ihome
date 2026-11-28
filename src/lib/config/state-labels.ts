export type StateLabels = Record<string, string>;

/** Add or update one value → label entry. An empty key is ignored. */
export function setStateLabel(
  states: StateLabels | undefined,
  key: string,
  label: string,
): StateLabels | undefined {
  const value = key.trim();
  if (!value) return states;
  return { ...(states ?? {}), [value]: label };
}

/** Rename a value key and keep its label. An unchanged key is ignored; an
 *  empty new key removes the entry, like clearing the row. */
export function renameStateLabel(
  states: StateLabels | undefined,
  oldKey: string,
  newKey: string,
): StateLabels | undefined {
  const value = newKey.trim();
  if (value === oldKey) return states;
  const next = { ...(states ?? {}) };
  const label = next[oldKey] ?? "";
  delete next[oldKey];
  if (value) next[value] = label;
  return Object.keys(next).length ? next : undefined;
}

/** Remove one entry; the last removal returns undefined. */
export function removeStateLabel(
  states: StateLabels | undefined,
  key: string,
): StateLabels | undefined {
  const next = { ...(states ?? {}) };
  delete next[key];
  return Object.keys(next).length ? next : undefined;
}
