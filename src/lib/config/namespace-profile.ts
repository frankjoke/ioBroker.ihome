export const NAMESPACE_PATTERN = /^ihome\.\d+$/;

/**
 * The profile the SPA runs in: a valid `?namespace=` wins, then the stored
 * namespace, then the caller's fallback. Only `ihome.<digits>` is accepted;
 * legacy values (`admin.0`, `iHome`, …) fall through.
 */
export function resolveNamespace(
  queryNamespace: string,
  storedNamespace: string,
  fallback: string,
): string {
  const query = String(queryNamespace ?? "").trim();
  if (NAMESPACE_PATTERN.test(query)) return query;
  const stored = String(storedNamespace ?? "").trim();
  if (NAMESPACE_PATTERN.test(stored)) return stored;
  return fallback;
}
