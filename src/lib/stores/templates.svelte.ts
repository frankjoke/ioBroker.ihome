// Persists the *user* templates to their own ioBroker state. Built-in presets
// live in code (`$lib/config/presets`) and are never stored; a user template is
// a copy (`basedOn`) that this document owns. Same registry pattern and the same
// no-module-global-client rule as `pages.svelte.ts`.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { parseTemplateRegistry } from "$lib/config/template-ops";
import { stateIdsInExpression } from "$lib/config/rule-ops";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import type { TemplateRegistry } from "$lib/types/display";

export const TEMPLATE_LIST_ID = "ihome.0.config.templateList";

const emptyRegistry: TemplateRegistry = {
  version: 0,
  updatedAt: 0,
  templates: [],
};

let templateRegistry = $state<TemplateRegistry>(emptyRegistry);

export function getTemplateRegistry(): TemplateRegistry {
  return templateRegistry;
}

export function setTemplateRegistry(reg: TemplateRegistry): void {
  templateRegistry = reg;
  // Both the load and every save pass through here, so the ids a template
  // names are (re)registered in one place; `registerProgramStateId` bumps for
  // new ids only, which is what re-subscribes the connection.
  registerTemplateStateIds();
}

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
let saveFailed = $state(false);
/** How the stored document last loaded. `absent` is a valid empty state (the
 *  first save creates it); only `pending` and `unreadable` block writes. */
let templatesLoadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);

/**
 * True while the last document write failed, so the pane can say "not saved"
 * instead of pretending the change landed.
 */
export function getTemplateSaveFailed(): boolean {
  return saveFailed;
}

/** May templates be written? False until the document has been read, and false
 *  for an unreadable one — a failed read must not be replaced by "no templates". */
export function isTemplatesWritable(): boolean {
  return templatesLoadKind === "loaded" || templatesLoadKind === "absent";
}

async function ensureTemplatesObject() {
  const obj = await ioBroker.getObject(TEMPLATE_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", TEMPLATE_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome user templates",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveTemplates(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getTemplateRegistry());
  saveTimer = setTimeout(() => {
    // A disconnected socket resolves `emitAsync` without sending anything, so a
    // write would look successful while the broker never saw it (review I1).
    if (!ioBroker.connected) {
      saveFailed = true;
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(TEMPLATE_LIST_ID, snapshot)
      .then(() => {
        saveFailed = false;
      })
      .catch((e) => {
        saveFailed = true;
        console.error("save templates:", e);
      });
  }, 250);
}

/**
 * The pane's only write path: replace the registry and persist it. Refuses while
 * the document is pending or unreadable, so a failed read is never overwritten.
 */
export function commitTemplates(next: TemplateRegistry): boolean {
  if (!isTemplatesWritable()) {
    console.error(
      "templateList is not readable (no successful load) — the change was not saved",
    );
    return false;
  }
  setTemplateRegistry(next);
  saveTemplates();
  return true;
}

/**
 * The template document, plus every raw state and rule id its templates name:
 * a device that has no slots of its own renders the chain's, so the chain's
 * sources and rules must be in the used set too (the device store scans the
 * device's own slots only).
 */
function registerTemplateStateIds(): void {
  registerProgramStateId(TEMPLATE_LIST_ID);
  for (const template of getTemplateRegistry().templates ?? []) {
    for (const slot of template?.slots ?? []) {
      const source = slot?.source;
      if (
        typeof source === "string" &&
        source &&
        ioBroker.objects.get(source)
      ) {
        registerProgramStateId(source);
      }
      for (const rule of slot?.rules ?? []) {
        for (const id of stateIdsInExpression(rule?.when ?? "")) {
          registerProgramStateId(id);
        }
      }
    }
  }
}

/** Load the user templates; an absent document simply means "none yet". */
export function initTemplates(): Promise<void> {
  registerTemplateStateIds();
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureTemplatesObject();
      } catch (e) {
        console.error("initTemplates ensureTemplatesObject:", e);
      }
      const st = await ioBroker.getState(TEMPLATE_LIST_ID, true);
      if (!st) {
        templatesLoadKind = "absent";
        initPromise = null;
        return;
      }
      st.onUpdate = (_cl, state) => {
        const parsed = parseTemplateRegistry(state?.val);
        if (!parsed) return true;
        const asString = JSON.stringify(parsed);
        if (lastSent !== null && lastSent === asString) return true;
        setTemplateRegistry(parsed);
        return true;
      };
      const parsed = parseTemplateRegistry(st.value);
      // Templates are only ever absent (never seeded), so nothing is written
      // here: an unreadable document must not be replaced by an empty one.
      if (parsed) {
        templatesLoadKind = "loaded";
        setTemplateRegistry(parsed);
      } else if (st.value != null && st.value !== "") {
        templatesLoadKind = "unreadable";
        console.error(
          "templateList is unreadable — leaving it untouched rather than overwriting it",
        );
      } else {
        templatesLoadKind = "absent";
      }
    })().catch((e) => {
      console.error("initTemplates:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
