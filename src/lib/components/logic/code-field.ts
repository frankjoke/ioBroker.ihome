export function insertAtCaret(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  return {
    text: before + insert + after,
    caret: before.length + insert.length,
  };
}

/** The range to insert at: the remembered caret, or the end when the field had no focus. */
export function insertRange(
  focused: boolean,
  start: number,
  end: number,
  length: number,
): [number, number] {
  return focused ? [start, end] : [length, length];
}

/** The text for the Goto select's `selectedIndex`: 0 is the placeholder, 1 `— stay —`, then the states. */
export function gotoInsertAt(
  index: number,
  stateNames: string[],
): string | null {
  if (index <= 0) return null;
  if (index === 1) return "goto()";
  const state = stateNames[index - 2];
  return state === undefined ? null : `goto(${JSON.stringify(state)})`;
}
