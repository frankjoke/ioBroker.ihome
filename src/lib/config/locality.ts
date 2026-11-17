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
