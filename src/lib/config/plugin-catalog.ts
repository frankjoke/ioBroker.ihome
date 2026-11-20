import { validPluginId } from "$adapter/plugin-ops";

/** One curated, same-origin plugin offered on the Plugins page. */
export interface PluginCatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  api: number;
  /** Plugin file relative to the catalog, flat and .json only. */
  file: string;
}

export interface PluginCatalog {
  version: 1;
  plugins: PluginCatalogEntry[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

const FILE = /^[a-z0-9][a-z0-9._-]*\.json$/i;

/**
 * Parse the shipped catalog. A broken root rejects the whole catalog; a single
 * junk entry is dropped. Built-in ids are never offered as installable.
 */
export function parsePluginCatalog(
  raw: unknown,
  builtinIds: readonly string[] = [],
): PluginCatalog | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record(value) || value.version !== 1 || !Array.isArray(value.plugins)) {
    return null;
  }
  const seen = new Set<string>();
  const plugins: PluginCatalogEntry[] = [];
  for (const item of value.plugins) {
    if (!record(item)) continue;
    const id = text(item.id, 64);
    if (!id || !validPluginId(id) || builtinIds.includes(id) || seen.has(id)) {
      continue;
    }
    const name = text(item.name, 64);
    const description = text(item.description, 200);
    const version = text(item.version, 32);
    const file = text(item.file, 120);
    if (!name || !description || !version || !file) continue;
    if (
      typeof item.api !== "number" ||
      !Number.isInteger(item.api) ||
      item.api < 1
    ) {
      continue;
    }
    if (!FILE.test(file)) continue;
    seen.add(id);
    plugins.push({ id, name, description, version, api: item.api, file });
  }
  return { version: 1, plugins };
}
