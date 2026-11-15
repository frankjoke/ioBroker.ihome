// Template files in the shared space: one `TemplateFile` per template at
// `ihome.meta/templates/<kind>/<id>.json`. The folder is the truth; the file
// format is exactly the export/import format.

import {
  deleteMetaFile,
  listMetaDir,
  readMetaText,
  verifiedWrite,
} from "$lib/config/meta-files";
import {
  TEMPLATE_KINDS,
  parseTemplateFile,
  serializeTemplateFile,
  type TemplateFile,
  type TemplateKind,
} from "$lib/config/template-file";

const ADAPTER = "ihome.meta";
const DIR = "templates";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = new Set<string>(TEMPLATE_KINDS);

export function validTemplateId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return ID.test(id) ? id : undefined;
}

export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && KINDS.has(value);
}

export function templateMetaPath(kind: TemplateKind, id: string): string {
  return `${DIR}/${kind}/${id}.json`;
}

/** `templates/device/a.json` → `{kind: "device", id: "a"}`. */
export function parseTemplateMetaPath(
  path: string,
): { kind: TemplateKind; id: string } | null {
  const match = /^templates\/([^/]+)\/([^/]+)\.json$/.exec(String(path));
  if (!match) return null;
  const [, kind, id] = match;
  if (!isTemplateKind(kind) || !validTemplateId(id)) return null;
  return { kind, id };
}

/** `a.json` → `a`; anything that is not a valid id file → null. */
export function templateIdFromFile(name: string): string | null {
  const match = /^(.+)\.json$/.exec(String(name));
  return match ? (validTemplateId(match[1]) ?? null) : null;
}

export async function readTemplate(
  kind: TemplateKind,
  id: string,
): Promise<TemplateFile | null> {
  const text = await readMetaText(ADAPTER, templateMetaPath(kind, id));
  if (text === null) return null;
  let raw: unknown = text;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = parseTemplateFile(raw);
  if ("problem" in parsed) return null;
  return parsed.file;
}

export async function writeTemplate(
  kind: TemplateKind,
  id: string,
  file: TemplateFile,
): Promise<void> {
  await verifiedWrite(
    ADAPTER,
    templateMetaPath(kind, id),
    serializeTemplateFile(file),
  );
}

export async function deleteTemplate(
  kind: TemplateKind,
  id: string,
): Promise<void> {
  await deleteMetaFile(ADAPTER, templateMetaPath(kind, id));
}

/** Every template file of one kind; corrupt files stay listed with an error. */
export async function listTemplates(
  kind: TemplateKind,
): Promise<{ id: string; file: TemplateFile | null; error?: string }[]> {
  const entries = await listMetaDir(ADAPTER, `${DIR}/${kind}`);
  const out: { id: string; file: TemplateFile | null; error?: string }[] = [];
  for (const entry of entries) {
    if (entry.isDir) continue;
    const id = templateIdFromFile(entry.name);
    if (!id) continue;
    const file = await readTemplate(kind, id);
    out.push(
      file
        ? { id, file }
        : { id, file: null, error: "The file is not a readable template." },
    );
  }
  return out.sort((a, b) => {
    // Unreadable files sink to the bottom; the rest sort by their name.
    if (!!a.error !== !!b.error) return a.error ? 1 : -1;
    const left = a.file?.definition as { name?: string } | undefined;
    const right = b.file?.definition as { name?: string } | undefined;
    return (
      (left?.name ?? a.id).localeCompare(right?.name ?? b.id) ||
      a.id.localeCompare(b.id)
    );
  });
}
