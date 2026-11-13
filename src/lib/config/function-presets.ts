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
      "Log and push to every phone; the lock screen stays private (app name only).",
    mode: "statements",
    code: 'notify("Title", "Body")',
  },
  {
    id: "phone-push",
    name: "Visible push",
    description:
      "Raw adapter command state: shows the title and body on the lock screen. Use Message + push for the private standard.",
    mode: "statements",
    code: 'set("ihome.0.phone.pushMessage", "Title\\nBody")',
  },
  {
    id: "log-expr",
    name: "Log line",
    description: "Write a line to the iHome log.",
    mode: "expression",
    code: 'log("text")',
  },
  {
    id: "message-expr",
    name: "UI toast",
    description: "Self-disposing toast in the iHome UI (seconds).",
    mode: "expression",
    code: 'message("text", "info", 5)',
  },
  {
    id: "push-private-expr",
    name: "Push (private)",
    description:
      "Log and push to every phone; the lock screen stays private (app name only).",
    mode: "expression",
    code: 'notify("Title", "Body")',
  },
  {
    id: "push-visible-expr",
    name: "Push (visible)",
    description:
      "Shows the title and body on the lock screen; writes the raw adapter command state.",
    mode: "expression",
    code: 'set("ihome.0.phone.pushMessage", "Title\\nBody")',
  },
];
