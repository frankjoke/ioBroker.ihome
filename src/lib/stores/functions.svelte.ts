import type {
  FunctionLibrary,
  FunctionTemplate,
} from "$lib/types/device";

export const FUNCTION_LIST_ID = "ihome.0.config.functionList";

const defaultLibrary: FunctionLibrary = {
  version: 0,
  updatedAt: Date.now(),
  functions: [],
};

let canonicalLibrary = $state<FunctionLibrary>(defaultLibrary);

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
