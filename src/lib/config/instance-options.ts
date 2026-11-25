/** The installed iHome instance namespaces, e.g. `["ihome.0", "ihome.2"]`.
 *  The SPA's object cache carries the `system.adapter.ihome.N.alive` states;
 *  when the instance definition is present too, accept that as well. */
export function iHomeInstanceIds(objects: Map<string, any>): string[] {
  const out = new Set<string>();
  for (const [id, entry] of objects) {
    const match = /^system\.adapter\.ihome\.(\d+)(\.alive)?$/.exec(id);
    if (!match) continue;
    if (match[2] === ".alive" || entry?.type === "instance") {
      out.add(`ihome.${match[1]}`);
    }
  }
  return [...out].sort();
}
