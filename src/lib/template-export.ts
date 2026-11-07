import { templateExport, type TemplateKind } from "$lib/config/template-file";
import { downloadJson } from "$lib/utils/download";

export function exportTemplate(kind: TemplateKind, definition: unknown): void {
  const { fileName, text } = templateExport(kind, definition);
  downloadJson(fileName, text);
}
