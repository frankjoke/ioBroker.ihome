import type { FunctionTemplate } from "$lib/types/device";

/** Built-in snippets; read-only, duplicate to edit. */
export const BUILTIN_FUNCTIONS: FunctionTemplate[] = [
  {
    id: "celsius-to-fahrenheit",
    name: "Celsius → Fahrenheit",
    description: "Convert a °C reading to °F.",
    mode: "expression",
    code: "(result, raw) => (Number(raw) * 9) / 5 + 32",
  },
  {
    id: "fahrenheit-to-celsius",
    name: "Fahrenheit → Celsius",
    description: "Convert a °F reading to °C.",
    mode: "expression",
    code: "(result, raw) => ((Number(raw) - 32) * 5) / 9",
  },
];
