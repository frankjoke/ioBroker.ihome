/**
 * A fresh unique id.
 *
 * `crypto.randomUUID` only exists in a **secure context**: the dev server on
 * localhost has it, a plain-HTTP ioBroker deployment (http://192.168.x.x:8081)
 * does not. An id generator that throws there would break creating and
 * duplicating layout nodes — and the one-time migration — on the very
 * installation this app is meant for.
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort (no web crypto at all): still unique within a session.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
