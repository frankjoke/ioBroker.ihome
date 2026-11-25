export function downloadText(
  fileName: string,
  text: string,
  type = "text/plain;charset=utf-8",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(fileName: string, text: string): void {
  downloadText(fileName, text, "application/json");
}
