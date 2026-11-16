// Plugin content in the shared space (`ihome.meta/plugins/<id>/`):
//   plugin.json  portable manifest (name, help, usage, schema, bundle)
//   index.js     the code the adapter runs
// Runtime flags (enabled/debug/timeout/settings) never go into these files;
// they travel through the adapter's plugin commands.

import { pluginManifestOf } from "$adapter/plugin-files";
import type { PluginBundle, PluginSettingDef } from "$adapter/plugin-ops";
import type { ImportedPlugin } from "$adapter/plugin-file";
import {
  META_ADAPTER,
  deleteMetaFile,
  readMetaText,
  verifiedWrite,
} from "./meta-files";

const PLUGINS = "plugins";

function folder(id: string): string {
  return `${PLUGINS}/${id}`;
}

/** Write a plugin's folder; both files are verified by a read-back. */
export async function writePluginFiles(plugin: ImportedPlugin): Promise<void> {
  const manifest = pluginManifestOf({
    id: plugin.id,
    name: plugin.name,
    ...(plugin.help ? { help: plugin.help } : {}),
    ...(plugin.usage ? { usage: plugin.usage } : {}),
    ...(plugin.settingsSchema ? { settingsSchema: plugin.settingsSchema } : {}),
    ...(plugin.bundle ? { bundle: plugin.bundle } : {}),
  });
  await verifiedWrite(
    META_ADAPTER,
    `${folder(plugin.id)}/plugin.json`,
    JSON.stringify(manifest, null, 2),
  );
  await verifiedWrite(
    META_ADAPTER,
    `${folder(plugin.id)}/index.js`,
    plugin.code,
  );
}

interface StoredManifest {
  name: string;
  help?: string;
  usage?: string;
  settingsSchema?: PluginSettingDef[];
  bundle?: PluginBundle;
}

/** Rewrite the manifest fields the editor owns; code and bundle stay. */
export async function savePluginManifest(
  id: string,
  patch: { name: string; help: string; usage: string },
): Promise<void> {
  const path = `${folder(id)}/plugin.json`;
  const text = await readMetaText(META_ADAPTER, path);
  if (text === null) throw new Error(`${path} is missing.`);
  let current: StoredManifest;
  try {
    current = JSON.parse(text) as StoredManifest;
  } catch {
    throw new Error(`${path} is not valid JSON.`);
  }
  if (!current || typeof current !== "object") {
    throw new Error(`${path} must be an object.`);
  }
  const manifest = pluginManifestOf({
    id,
    name: patch.name,
    ...(patch.help ? { help: patch.help } : {}),
    ...(patch.usage ? { usage: patch.usage } : {}),
    ...(current.settingsSchema
      ? { settingsSchema: current.settingsSchema }
      : {}),
    ...(current.bundle ? { bundle: current.bundle } : {}),
  });
  await verifiedWrite(META_ADAPTER, path, JSON.stringify(manifest, null, 2));
}

/** Remove the folder; the adapter drops the runtime entry first. */
export async function removePluginFolder(id: string): Promise<void> {
  await deleteMetaFile(META_ADAPTER, folder(id));
}
