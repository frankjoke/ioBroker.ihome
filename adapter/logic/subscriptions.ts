/** The subscription set a logic document asks for, split for the adapter's two
 *  broker calls. Everything a logic no longer names (deleted logic, removed
 *  variable, disabled logic) lands in `remove`, so the broker stops sending it
 *  and no timer or handler keeps running for it. */
export interface SubscriptionDiff {
  own: { add: string[]; remove: string[] };
  foreign: { add: string[]; remove: string[] };
}

export function subscriptionDiff(
  previous: string[],
  next: string[],
  namespace: string,
): SubscriptionDiff {
  const before = new Set(previous);
  const after = new Set(next);
  const isOwn = (id: string) => id.startsWith(`${namespace}.`);
  const diff: SubscriptionDiff = {
    own: { add: [], remove: [] },
    foreign: { add: [], remove: [] },
  };
  for (const id of after) {
    if (!before.has(id)) {
      (isOwn(id) ? diff.own.add : diff.foreign.add).push(id);
    }
  }
  for (const id of before) {
    if (!after.has(id)) {
      (isOwn(id) ? diff.own.remove : diff.foreign.remove).push(id);
    }
  }
  return diff;
}
