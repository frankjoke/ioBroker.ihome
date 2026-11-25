/** The installed iHome instance namespaces, e.g. `["ihome.0", "ihome.2"]`. */
export function iHomeInstanceIds(objects: Map<string, any>): string[] {
  const out: string[] = [];
  for (const [id, entry] of objects) {
    if (entry?.type !== "instance") continue;
    const match = /^system\.adapter\.ihome\.(\d+)$/.exec(id);
    if (match) out.push(`ihome.${match[1]}`);
  }
  return out.sort();
}
