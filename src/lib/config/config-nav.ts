/** Map a `/templates?type=` value to the page groups. */
export function templateKind(
  value: string | null,
): "code" | "templates" | "icons" {
  if (value === "code" || value === "templates" || value === "icons") {
    return value;
  }
  if (value === "formula" || value === "function") return "code";
  return "templates";
}
