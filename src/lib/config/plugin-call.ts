export type PluginSend = (
  instance: string,
  command: string,
  payload: unknown,
) => Promise<unknown>;

/** The plugin result, or the error text as a thrown error. */
export function unwrapPluginReply(reply: unknown): unknown {
  if (reply && typeof reply === "object" && "ok" in reply) {
    const envelope = reply as {
      ok?: unknown;
      result?: unknown;
      error?: unknown;
    };
    if (envelope.ok === true) return envelope.result;
    if (typeof envelope.error === "string" && envelope.error) {
      throw new Error(envelope.error);
    }
  }
  throw new Error("plugin call failed");
}

export async function callPlugin(
  send: PluginSend,
  namespace: string,
  id: string,
  payload?: unknown,
): Promise<unknown> {
  return unwrapPluginReply(await send(namespace, "plugin", { id, payload }));
}
