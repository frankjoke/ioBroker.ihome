/** Whether this session is on the local network. External access is https
 *  (Caddy terminates TLS); the LAN is plain http. A configured public host
 *  always counts as external, so a hairpin connection is classified right. */
export function isLocalSession(args: {
  protocol: string;
  host: string;
  publicHost?: string;
}): boolean {
  const host = String(args.host ?? "")
    .trim()
    .toLowerCase();
  const publicHost = String(args.publicHost ?? "")
    .trim()
    .toLowerCase();
  if (publicHost && host === publicHost) return false;
  return (
    String(args.protocol ?? "")
      .trim()
      .toLowerCase() === "http:"
  );
}

/** This page's session: the rule every local-only control uses (external
 *  access is https, the LAN is plain http). False during SSR/tests. */
export function isLocalUi(
  where?: { protocol: string; host: string } | null,
): boolean {
  const page =
    where !== undefined
      ? where
      : (globalThis.location as { protocol: string; host: string } | undefined);
  return !!page && isLocalSession(page);
}
