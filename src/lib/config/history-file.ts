import type { HistoryLikeRow } from "$lib/config/history-resample";

/** JSON is the lossless form; CSV is the one spreadsheet apps open. */
export function jsonText(rows: HistoryLikeRow[]): string {
  return `${JSON.stringify(
    rows.map(({ ts, val }) => ({ ts, val })),
    null,
    2,
  )}\n`;
}

function fail(message: string): never {
  throw new Error(message);
}

function timestamp(value: unknown, where: string): number {
  const ts =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(ts)) fail(`${where}: the timestamp is not valid.`);
  return ts;
}

/** One CSV field; `""` inside quotes is a literal quote. */
function field(text: string): { text: string; quoted: boolean } {
  if (!text.startsWith('"')) return { text, quoted: false };
  let out = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '"') {
      out += char;
      continue;
    }
    if (text[index + 1] === '"') {
      out += '"';
      index += 1;
      continue;
    }
    if (index !== text.length - 1)
      fail("Unexpected text after a quoted value.");
    return { text: out, quoted: true };
  }
  fail("A quoted value is not closed.");
}

/** The first comma that is not inside quotes. */
function commaAt(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === "," && !quoted) return index;
  }
  return -1;
}

function csvValue(text: string, quoted: boolean): unknown {
  if (quoted) {
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text);
      } catch {
        // The exported CSV also quotes plain strings, so keep it a string.
      }
    }
    return text;
  }
  if (text === "") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

function fromCsv(text: string): HistoryLikeRow[] {
  // shortcut: CSV is line-based, so strings containing newlines need JSON.
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first < 0) fail("The file is empty.");
  const header = lines[first].trim().toLowerCase();
  if (header !== "timestamp,value") {
    fail("The CSV needs a timestamp,value header.");
  }
  const rows: HistoryLikeRow[] = [];
  for (let index = first + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const where = `Line ${index + 1}`;
    const at = commaAt(line);
    if (at < 0) fail(`${where}: expected a timestamp and a value.`);
    const time = field(line.slice(0, at));
    const value = field(line.slice(at + 1));
    rows.push({
      ts: timestamp(time.text, where),
      val: csvValue(value.text, value.quoted),
    });
  }
  return rows;
}

function fromJson(text: string): HistoryLikeRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("The file is neither CSV nor JSON.");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as any).rows)
      ? (parsed as any).rows
      : fail("JSON needs an array of rows or a rows array.");
  return list.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object")
      fail(`Row ${index + 1}: not an object.`);
    const row = entry as Record<string, unknown>;
    return {
      ts: timestamp(row.ts ?? row.timestamp, `Row ${index + 1}`),
      val: "val" in row ? row.val : row.value,
    };
  });
}

/** Parse an exported CSV or JSON file. Invalid rows fail loudly; never skip. */
export function parseHistoryText(text: string): HistoryLikeRow[] {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const rows =
    trimmed.startsWith("[") || trimmed.startsWith("{")
      ? fromJson(trimmed)
      : fromCsv(trimmed);
  if (rows.length === 0) fail("The file has no rows.");
  return rows.sort((left, right) => left.ts - right.ts);
}
