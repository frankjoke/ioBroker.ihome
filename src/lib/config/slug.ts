// A page's readable id. The id is chosen once, from the name it was created
// with, and never follows a later rename — so a copied link keeps working.

const UMLAUTS: [RegExp, string][] = [
  [/ä/g, "ae"],
  [/ö/g, "oe"],
  [/ü/g, "ue"],
  [/ß/g, "ss"],
  [/Ä/g, "Ae"],
  [/Ö/g, "Oe"],
  [/Ü/g, "Ue"],
];

/** "Gäste-Spiele" → "gaeste-spiele"; anything without latin letters → "". */
export function slugify(title: string): string {
  let text = String(title ?? "");
  for (const [pattern, replacement] of UMLAUTS) {
    text = text.replace(pattern, replacement);
  }
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}

/** The base, or `base-2`, `base-3`, … when the id is already taken. */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  if (!base) return base;
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
