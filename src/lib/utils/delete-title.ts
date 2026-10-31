/** The one confirmation title for deletions: what, and where it lives.
 *  Matches the layout editor's wording (“Delete slot “x” from tile “y””). */
export function deleteTitle(
  what: string,
  name: string,
  from?: { kind: string; name: string },
): string {
  const quoted = (value: string) => `“${value}”`;
  const head = `Delete ${what} ${quoted(name)}`;
  return from ? `${head} from ${from.kind} ${quoted(from.name)}` : head;
}
