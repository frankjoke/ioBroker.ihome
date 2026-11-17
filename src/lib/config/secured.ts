/** Items flagged `secured` are only listed on the local network. The flag is a
 *  visibility layer, not an authorisation boundary (App-structure 3.8). */
export function withoutSecured<T extends { secured?: boolean }>(
  items: readonly T[],
  local: boolean,
): T[] {
  return local ? [...items] : items.filter((item) => item.secured !== true);
}
