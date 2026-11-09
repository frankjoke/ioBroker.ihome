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
  search: string;
}

function entry(
  kind: TemplateEntry["kind"],
  id: string,
  name: string,
  parts: TemplatePart[],
  builtin: boolean,
  detail: string,
): TemplateEntry {
  return {
    id,
    name,
    kind,
    parts,
    builtin,
    search: `${name} ${detail}`.toLowerCase(),
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
        ["device"],
        true,
        `${template.type} ${template.help ?? ""}`,
      ),
    ),
    ...input.visual.map((template) =>
      entry(
        "device",
        template.id,
        template.name,
        ["device"],
        false,
        `${template.type} ${template.help ?? ""}`,
      ),
    ),
    ...input.logicBuiltins.map((template) =>
      entry(
        "logic",
        template.id,
        template.name,
        ["logic"],
        true,
        `${template.description ?? ""} ${template.help ?? ""}`,
      ),
    ),
    ...input.logicUser.map((template) =>
      entry(
        "logic",
        template.id,
        template.name,
        ["logic"],
        false,
        `${template.description ?? ""} ${template.help ?? ""}`,
      ),
    ),
    ...input.apiBuiltins.map((template) =>
      entry(
        "api",
        template.id,
        template.name,
        ["logic", "api"],
        true,
        `${template.description ?? ""} ${template.help ?? ""}`,
      ),
    ),
    ...input.apiUser.map((template) =>
      entry(
        "api",
        template.id,
        template.name,
        ["logic", "api"],
        false,
        `${template.description ?? ""} ${template.help ?? ""}`,
      ),
    ),
    ...input.bundleBuiltins.map((bundle) =>
      entry(
        "bundle",
        bundle.id,
        bundle.name,
        bundleParts(bundle),
        true,
        `${bundle.description ?? ""} ${bundle.help ?? ""}`,
      ),
    ),
    ...input.bundleUser.map((bundle) =>
      entry(
        "bundle",
        bundle.id,
        bundle.name,
        bundleParts(bundle),
        false,
        `${bundle.description ?? ""} ${bundle.help ?? ""}`,
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
