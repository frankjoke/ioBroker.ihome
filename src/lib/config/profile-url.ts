/** An absolute profile URL that pins the iHome instance. */
export function profileUrl(href: string, instance: string, hash = "#/"): string {
  const url = new URL(href);
  url.searchParams.set("namespace", instance);
  url.hash = hash;
  return url.toString();
}
