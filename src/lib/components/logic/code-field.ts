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
