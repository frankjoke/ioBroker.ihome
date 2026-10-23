// What the app subscribes to. The ioBroker socket relays every subscribed
// state and object change to this client — locally that was free, but through
// iobroker.pro the *cloud adapter* forwards each one into the tunnel, and a
// chatty installation trips the cloud's event budget within seconds (the
// account is then blocked for five minutes and the portal answers with its
// retry page). So the firehose is gone:
//
//  - the ids the app actually uses (`getUsedStateIds` — the same set it filters
//    incoming changes by anyway), and
//  - the adapter's own namespace (`ihome.0.*`), so everything the adapter
//    carries stays live, now and later.

/** `ihome.0.*` — the adapter's own states and objects. Empty namespace, none. */
export function namespaceWildcard(namespace: string): string {
  return namespace ? `${namespace}.*` : "";
}

/**
 * The ids to subscribe to, for states and objects alike: the used ids, then
 * the namespace wildcard last (so the shape is stable and testable). Junk and
 * repeats are dropped; a wildcard already in the list is not repeated.
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
  return { states, objects: [...states] };
}
