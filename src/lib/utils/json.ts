/**
 * JSON-safe deep copy: every config document is JSON, and the store's `$state`
 * proxies cannot be structured-cloned. `undefined` passes through — a cleared
 * field stays cleared instead of becoming `null`.
 */
export function deepCopy<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
