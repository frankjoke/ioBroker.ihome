import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { appBaseUrl, appOrigin } from "$lib/config/frame-url";
import { placeholderKeys } from "$lib/config/html-template";
import { getVariables } from "$lib/stores/variables.svelte";
import { registerProgramStateId } from "$lib/stores/devices.svelte";

/**
 * One `{{name}}` value for HTML and frame slots: `{{base}}` / `{{origin}}`,
 * a Variable & Constant by name, or a raw dotted state id. A missing value
 * stays `undefined`, so the caller keeps the placeholder visible instead of
 * silently emptying it.
 */
export function placeholderValue(key: string): unknown {
  // Reserved: the web adapter base/origin for this view. Relative in
  // production (works locally and through ioBroker Pro), absolute in dev.
  if (key === "base" || key === "$base") {
    return appBaseUrl({
      dev: import.meta.env.DEV,
      origin: import.meta.env.VITE_IOBROKER_ORIGIN || "http://localhost:8082",
    });
  }
  if (key === "origin" || key === "$origin") {
    return appOrigin({
      dev: import.meta.env.DEV,
      origin: import.meta.env.VITE_IOBROKER_ORIGIN || "http://localhost:8082",
      pageOrigin: globalThis.location?.origin ?? "",
    });
  }
  const variable = getVariables().find((v) => v.name === key);
  if (variable) {
    if (variable.kind === "state" && variable.stateId) {
      return ioBroker.states.get(variable.stateId)?.val;
    }
    return variable.value;
  }
  return key.includes(".") ? ioBroker.states.get(key)?.val : undefined;
}

/** Subscribe every state a placeholder names, so a raw state id fills in. */
export function subscribePlaceholders(text: string): void {
  for (const key of placeholderKeys(text)) {
    const variable = getVariables().find((v) => v.name === key);
    const id =
      variable?.kind === "state" && variable.stateId
        ? variable.stateId
        : key.includes(".")
          ? key
          : "";
    if (id) registerProgramStateId(id);
  }
}
