export type StatesTab = "states" | "variables" | "constants" | "help";

export const STATES_TABS: { id: StatesTab; label: string; hint: string }[] = [
  {
    id: "states",
    label: "States",
    hint: "Broker objects, settings and stored history.",
  },
  {
    id: "variables",
    label: "Variables",
    hint: "Friendly names for broker states.",
  },
  {
    id: "constants",
    label: "Constants",
    hint: "Fixed values that live only in iHome.",
  },
  {
    id: "help",
    label: "Help",
    hint: "About states, variables and constants.",
  },
];

export function isStatesTab(value: unknown): value is StatesTab {
  return (
    value === "states" ||
    value === "variables" ||
    value === "constants" ||
    value === "help"
  );
}

/** An explicit valid tab wins, then the remembered tab, then States. */
export function resolveStatesTab(
  value: unknown,
  remembered?: string,
): StatesTab {
  if (isStatesTab(value)) return value;
  if (isStatesTab(remembered)) return remembered;
  return "states";
}
