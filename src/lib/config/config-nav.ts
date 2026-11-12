/** Map a `/templates?type=` value to the two groups. */
export function templateKind(value: string | null): "code" | "templates" {
  if (value === "code" || value === "templates") return value;
  if (value === "formula" || value === "function") return "code";
  return "templates";
}
