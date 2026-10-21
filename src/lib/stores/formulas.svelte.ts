import type { FormulaLibrary, FormulaTemplate } from "$lib/types/device";

export const FORMULA_LIST_ID = "ihome.0.config.formulaList";

const defaultLibrary: FormulaLibrary = {
  version: 0,
  updatedAt: Date.now(),
  formulas: [],
};

let canonicalLibrary = $state<FormulaLibrary>(defaultLibrary);
export function getFormulaLibrary() {
  return canonicalLibrary;
}
export function setFormulaLibrary(lib: FormulaLibrary) {
  canonicalLibrary = lib;
}

export function getFormulas(): FormulaTemplate[] {
  return canonicalLibrary.formulas ?? [];
}
export function getFormula(id: string): FormulaTemplate | undefined {
  return getFormulas().find((t) => t.id === id);
}

function commit(formulas: FormulaTemplate[]) {
  canonicalLibrary = {
    version: (canonicalLibrary.version ?? 0) + 1,
    updatedAt: Date.now(),
    formulas,
  };
}

export function addFormula(t: FormulaTemplate) {
  commit([...getFormulas(), t]);
}
export function upsertFormula(t: FormulaTemplate) {
  commit(
    getFormulas().some((x) => x.id === t.id)
      ? getFormulas().map((x) => (x.id === t.id ? t : x))
      : [...getFormulas(), t],
  );
}
export function deleteFormula(id: string) {
  commit(getFormulas().filter((x) => x.id !== id));
}
