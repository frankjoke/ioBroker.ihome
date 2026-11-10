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
  {
    id: "log-info",
    name: "Log",
    description: "Write a line to the iHome log.",
    mode: "statements",
    code: 'log("text")',
  },
  {
    id: "log-warn",
    name: "Log warning",
    description: "Write a warning line to the iHome log.",
    mode: "statements",
    code: 'log("text", "warn")',
  },
  {
    id: "ui-info",
    name: "UI info",
    description: "Self-disposing info toast in the iHome UI (seconds).",
    mode: "statements",
    code: 'message("text", "info", 5)',
  },
  {
    id: "message-push",
    name: "Message + push",
    description:
      "Log a notification and push it to every phone subscribed to iHome.",
    mode: "statements",
    code: 'notify("Title", "Body")',
  },
  {
    id: "phone-push",
    name: "Phone push",
    description:
      "Raw push state: title on the first line, body on the rest. Use the Message + push snippet unless you need the exact payload.",
    mode: "statements",
    code: 'set("ihome.0.phone.pushMessage", "Title\\nBody")',
  },
];
