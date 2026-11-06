import type { FunctionLibrary, FunctionTemplate } from "$lib/types/device";

export const FUNCTION_LIST_ID = "ihome.0.config.functionList";

const defaultLibrary: FunctionLibrary = {
  version: 0,
  updatedAt: Date.now(),
  functions: [],
};

let canonicalLibrary = $state<FunctionLibrary>(defaultLibrary);
/** How the stored document last loaded. `absent` is a valid empty state (the
 *  first save creates it); only `pending` and `unreadable` block writes. */
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);
let saveFailed = $state(false);

export function functionsLoadKind(): typeof loadKind {
  return loadKind;
}

/** True while the last document write failed, so the pane can say "not saved". */
export function functionSaveFailed(): boolean {
  return saveFailed;
}

/** False until the document was read, and false for an unreadable one. */
export function isFunctionsWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

export function setFunctionsLoadKind(kind: typeof loadKind): void {
  loadKind = kind;
}

export function setFunctionSaveFailed(failed: boolean): void {
  saveFailed = failed;
}

export function getFunctionLibrary() {
  return canonicalLibrary;
}
export function setFunctionLibrary(lib: FunctionLibrary) {
  canonicalLibrary = lib;
}

export function getFunctions(): FunctionTemplate[] {
  return canonicalLibrary.functions ?? [];
}
export function getFunction(id: string): FunctionTemplate | undefined {
  return getFunctions().find((template) => template.id === id);
}

function commit(functions: FunctionTemplate[]) {
  canonicalLibrary = {
    version: (canonicalLibrary.version ?? 0) + 1,
    updatedAt: Date.now(),
    functions,
  };
}

export function upsertFunction(template: FunctionTemplate) {
  commit(
    getFunctions().some((entry) => entry.id === template.id)
      ? getFunctions().map((entry) =>
          entry.id === template.id ? template : entry,
        )
      : [...getFunctions(), template],
  );
}

export function deleteFunction(id: string) {
  commit(getFunctions().filter((entry) => entry.id !== id));
}
