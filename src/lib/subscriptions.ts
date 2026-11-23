// What the app subscribes to. The ioBroker socket relays every subscribed
// state and object change to this client — locally that was free, but through
// iobroker.pro the *cloud adapter* forwards each one into the tunnel, and a
// chatty installation trips the cloud's event budget within seconds (the
// account is then blocked for five minutes and the portal answers with its
// retry page). So the state firehose is gone:
//
//  - states: the ids the app actually uses (`getUsedStateIds` — the same set
//    it filters incoming changes by anyway), plus the adapter's own namespace
//    (`ihome.0.*`), so everything the adapter carries stays live, now and later.
//  - objects: everything (`*`). Object changes are configuration writes, not
//    normal operation, so the rate stays low and the cache stays exact — a
//    page that writes an object sees its own change without refetching.

/** `ihome.0.*` — the adapter's own states and objects. Empty namespace, none. */
export function namespaceWildcard(namespace: string): string {
  return namespace ? `${namespace}.*` : "";
}

/**
 * The ids to subscribe to: narrow states, every object. Junk and repeats are
 * dropped; a wildcard already in the state list is not repeated.
 */
export function subscriptionPlan(
  usedIds: Iterable<unknown>,
  namespace: string,
): { states: string[]; objects: string[] } {
  const wildcard = namespaceWildcard(namespace);
  const seen = new Set<string>();
  const states: string[] = [];
  for (const raw of usedIds) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || id === wildcard || seen.has(id)) continue;
    seen.add(id);
    states.push(id);
  }
  if (wildcard && !seen.has(wildcard)) states.push(wildcard);
  return { states, objects: ["*"] };
}
