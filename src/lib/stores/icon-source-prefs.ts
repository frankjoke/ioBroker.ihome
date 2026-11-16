/** Where the icon importer was last browsing — kept per browser so reopening
 *  "Add from source" resumes the adapter folder instead of the first one. */
const KEY = "iHome.iconSource";

export type IconSourceResource = "library" | "mdi" | "objects" | "adapter";

export interface IconSourcePrefs {
  resource: IconSourceResource;
  /** The adapter base path typed in the Source field. */
  basePath: string;
  /** The folder shown in the tree. */
  folder: string;
  /** "Save a copy" for picked adapter files. */
  downloadCopy: boolean;
}

export const ICON_SOURCE_DEFAULTS: IconSourcePrefs = {
  resource: "library",
  basePath: "icons-freepic/",
  folder: "/icons-freepic/",
  downloadCopy: true,
};

const RESOURCES: IconSourceResource[] = [
  "library",
  "mdi",
  "objects",
  "adapter",
];

export function readIconSourcePrefs(): IconSourcePrefs {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { ...ICON_SOURCE_DEFAULTS };
    const value = JSON.parse(raw) as Partial<IconSourcePrefs> | null;
    if (!value || typeof value !== "object") {
      return { ...ICON_SOURCE_DEFAULTS };
    }
    return {
      resource: RESOURCES.includes(value.resource as IconSourceResource)
        ? (value.resource as IconSourceResource)
        : ICON_SOURCE_DEFAULTS.resource,
      basePath:
        typeof value.basePath === "string" && value.basePath.trim()
          ? value.basePath
          : ICON_SOURCE_DEFAULTS.basePath,
      folder:
        typeof value.folder === "string" && value.folder.trim()
          ? value.folder
          : ICON_SOURCE_DEFAULTS.folder,
      downloadCopy:
        typeof value.downloadCopy === "boolean"
          ? value.downloadCopy
          : ICON_SOURCE_DEFAULTS.downloadCopy,
    };
  } catch {
    return { ...ICON_SOURCE_DEFAULTS };
  }
}

export function writeIconSourcePrefs(prefs: IconSourcePrefs): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: the modal still remembers within the session */
  }
}
