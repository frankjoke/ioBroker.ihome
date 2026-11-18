import type { DeviceTemplate, LogicTemplate } from "$logic/types";
import type { Template } from "$lib/types/display";
import type { TemplateBundle } from "$lib/types/templates";

export type TemplatePart = "device" | "logic" | "api";

export interface TemplateEntry {
  id: string;
  name: string;
  kind: "device" | "logic" | "api" | "bundle";
  parts: TemplatePart[];
  builtin: boolean;
  /** The short description; empty when the template has none. */
  description: string;
  /** The long-form help text; used as the row fallback when description is empty. */
  help: string;
  search: string;
  /** The device type a device or bundle template creates. */
  type?: string;
  /** Hidden outside the local network; absent = not secured. */
  secured?: boolean;
}

function entry(
  kind: TemplateEntry["kind"],
  id: string,
  name: string,
  description: string,
  help: string,
  parts: TemplatePart[],
  builtin: boolean,
  type?: string,
  secured?: boolean,
): TemplateEntry {
  return {
    id,
    name,
    kind,
    parts,
    builtin,
    description,
    help,
    search: `${name} ${type ?? ""} ${description} ${help}`.toLowerCase(),
    ...(type ? { type } : {}),
    ...(secured ? { secured: true } : {}),
  };
}

export function bundleParts(bundle: TemplateBundle): TemplatePart[] {
  const parts: TemplatePart[] = [];
  if (bundle.device) parts.push("device");
  if (bundle.logic) parts.push("logic");
  if (bundle.api) parts.push("api");
  return parts;
}

export function templateEntries(input: {
  presets: Template[];
  visual: Template[];
  logicBuiltins: LogicTemplate[];
  logicUser: LogicTemplate[];
  apiBuiltins: DeviceTemplate[];
  apiUser: DeviceTemplate[];
  bundleBuiltins: TemplateBundle[];
  bundleUser: TemplateBundle[];
}): TemplateEntry[] {
  return [
    ...input.presets.map((template) =>
      entry(
        "device",
        template.id,
        template.name,
        template.description ?? "",
        template.help ?? "",
        ["device"],
        true,
        template.type,
      ),
    ),
    ...input.visual.map((template) =>
      entry(
        "device",
        template.id,
        template.name,
        template.description ?? "",
        template.help ?? "",
        ["device"],
        false,
        template.type,
        template.secured === true,
      ),
    ),
    ...input.logicBuiltins.map((template) =>
      entry(
        "logic",
        template.id,
        template.name,
        template.description ?? "",
        template.help ?? "",
        ["logic"],
        true,
      ),
    ),
    ...input.logicUser.map((template) =>
      entry(
        "logic",
        template.id,
        template.name,
        template.description ?? "",
        template.help ?? "",
        ["logic"],
        false,
        undefined,
        template.secured === true,
      ),
    ),
    ...input.apiBuiltins.map((template) =>
      entry(
        "api",
        template.id,
        template.name,
        template.description ?? "",
        template.help ?? "",
        ["logic", "api"],
        true,
      ),
    ),
    ...input.apiUser.map((template) =>
      entry(
        "api",
        template.id,
        template.name,
        template.description ?? "",
        template.help ?? "",
        ["logic", "api"],
        false,
        undefined,
        template.secured === true,
      ),
    ),
    ...input.bundleBuiltins.map((bundle) =>
      entry(
        "bundle",
        bundle.id,
        bundle.name,
        bundle.description ?? "",
        bundle.help ?? "",
        bundleParts(bundle),
        true,
        bundle.device?.type,
      ),
    ),
    ...input.bundleUser.map((bundle) =>
      entry(
        "bundle",
        bundle.id,
        bundle.name,
        bundle.description ?? "",
        bundle.help ?? "",
        bundleParts(bundle),
        false,
        bundle.device?.type,
        bundle.secured === true,
      ),
    ),
  ];
}

export function filterTemplateEntries(
  entries: TemplateEntry[],
  query: string,
  dir: "asc" | "desc",
): TemplateEntry[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? entries.filter((entry) => entry.search.includes(q))
    : [...entries];
  const direction = dir === "asc" ? 1 : -1;
  return list.sort((a, b) => direction * a.name.localeCompare(b.name));
}

/** The first readable line of the long help, for the one-line template row. */
export function helpLine(help: string): string {
  let fenced = false;
  for (const part of help.split("\n")) {
    const line = part.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line) continue;
    return line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*]\s+/, "")
      .replace(/\*\*|__|`/g, "");
  }
  return "";
}
