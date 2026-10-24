import {
  constantValues,
  type GlobalVariable,
  type InternalValue,
  type VariableLibrary,
} from "$lib/config/variables";

export const VARIABLE_LIST_ID = "ihome.0.config.variableList";

const defaultLibrary: VariableLibrary = {
  version: 0,
  updatedAt: Date.now(),
  variables: [],
};

let canonicalLibrary = $state<VariableLibrary>(defaultLibrary);
/** The constants of the loaded config, materialised in memory. Created here —
 *  and in the adapter — from the list, never as broker states. */
let internalValues = $state<InternalValue[]>([]);

function refreshInternal(lib: VariableLibrary) {
  internalValues = constantValues(lib.variables ?? []);
}

export function getVariableLibrary() {
  return canonicalLibrary;
}
export function setVariableLibrary(lib: VariableLibrary) {
  canonicalLibrary = lib;
  refreshInternal(lib);
}

/** The constants as values: usable by the UI without an ioBroker round trip. */
export function getConstantValues(): InternalValue[] {
  return internalValues;
}

export function getVariables(): GlobalVariable[] {
  return canonicalLibrary.variables ?? [];
}

function commit(variables: GlobalVariable[]) {
  const next = {
    version: (canonicalLibrary.version ?? 0) + 1,
    updatedAt: Date.now(),
    variables,
  };
  canonicalLibrary = next;
  refreshInternal(next);
}

export function upsertVariable(v: GlobalVariable) {
  commit(
    getVariables().some((x) => x.id === v.id)
      ? getVariables().map((x) => (x.id === v.id ? v : x))
      : [...getVariables(), v],
  );
}

export function deleteVariable(id: string) {
  commit(getVariables().filter((x) => x.id !== id));
}
