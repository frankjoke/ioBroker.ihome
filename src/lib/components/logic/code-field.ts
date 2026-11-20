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

/**
 * Wrap the selection in a block comment, or remove the markers when it already
 * has both. With no selection (or no focus) an empty `/*  * /` is inserted at
 * the caret. Surrounding whitespace stays outside the markers.
 */
export function toggleComment(
  code: string,
  start: number,
  end: number,
  focused: boolean,
): { text: string; start: number; end: number } {
  const [from, to] = insertRange(focused, start, end, code.length);
  if (from === to) {
    const insert = "/*  */";
    return {
      text: code.slice(0, from) + insert + code.slice(from),
      start: from + 3,
      end: from + 3,
    };
  }
  const selected = code.slice(from, to);
  const core = selected.trim();
  const lead = core ? selected.slice(0, selected.indexOf(core)) : "";
  const trail = core
    ? selected.slice(selected.indexOf(core) + core.length)
    : "";
  let replacement: string;
  if (!core) {
    replacement = `/* ${selected} */`;
  } else if (core.startsWith("/*") && core.endsWith("*/")) {
    const inner = core.slice(2, -2).replace(/^ /, "").replace(/ $/, "");
    replacement = lead + inner + trail;
  } else {
    replacement = `${lead}/* ${core} */${trail}`;
  }
  return {
    text: code.slice(0, from) + replacement + code.slice(to),
    start: from,
    end: from + replacement.length,
  };
}
