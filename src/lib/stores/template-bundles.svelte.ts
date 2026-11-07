import type {
  TemplateBundle,
  TemplateBundleLibrary,
} from "$lib/types/templates";

export const TEMPLATE_BUNDLE_LIST_ID = "ihome.0.config.templateBundleList";

const defaultLibrary: TemplateBundleLibrary = {
  version: 0,
  updatedAt: Date.now(),
  bundles: [],
};

let canonicalLibrary = $state<TemplateBundleLibrary>(defaultLibrary);
/** How the stored document last loaded. `absent` is a valid empty state (the
 *  first save creates it); only `pending` and `unreadable` block writes. */
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);
let saveFailed = $state(false);

export function templateBundlesLoadKind(): typeof loadKind {
  return loadKind;
}

/** True while the last document write failed, so the pane can say "not saved". */
export function templateBundleSaveFailed(): boolean {
  return saveFailed;
}

/** False until the document was read, and false for an unreadable one. */
export function isTemplateBundlesWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

export function setTemplateBundlesLoadKind(kind: typeof loadKind): void {
  loadKind = kind;
}

export function setTemplateBundleSaveFailed(failed: boolean): void {
  saveFailed = failed;
}

export function getTemplateBundleLibrary(): TemplateBundleLibrary {
  return canonicalLibrary;
}

export function setTemplateBundleLibrary(lib: TemplateBundleLibrary): void {
  canonicalLibrary = lib;
}

export function getTemplateBundles(): TemplateBundle[] {
  return canonicalLibrary.bundles ?? [];
}

export function getTemplateBundle(id: string): TemplateBundle | undefined {
  return getTemplateBundles().find((bundle) => bundle.id === id);
}

function commit(bundles: TemplateBundle[]) {
  canonicalLibrary = {
    version: (canonicalLibrary.version ?? 0) + 1,
    updatedAt: Date.now(),
    bundles,
  };
}

export function upsertTemplateBundle(bundle: TemplateBundle) {
  commit(
    getTemplateBundles().some((entry) => entry.id === bundle.id)
      ? getTemplateBundles().map((entry) =>
          entry.id === bundle.id ? bundle : entry,
        )
      : [...getTemplateBundles(), bundle],
  );
}

export function deleteTemplateBundle(id: string) {
  commit(getTemplateBundles().filter((entry) => entry.id !== id));
}
