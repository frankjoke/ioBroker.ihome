// Persists the *user* templates to their own ioBroker state. Built-in presets
// live in code (`$lib/config/presets`) and are never stored; a user template is
// a copy (`basedOn`) that this document owns. Same registry pattern and the same
// no-module-global-client rule as `pages.svelte.ts`.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { parseTemplateRegistry } from "$lib/config/template-ops";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import type { TemplateRegistry } from "$lib/types/display";

export const TEMPLATE_LIST_ID = "0_userdata.0.Test.AiHome.templateList";

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
}

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;

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
    lastSent = snapshot;
    ioBroker
      .setState(TEMPLATE_LIST_ID, snapshot)
      .catch((e) => console.error("save templates:", e));
  }, 250);
}

/** Load the user templates; an absent document simply means "none yet". */
export function initTemplates(): Promise<void> {
  registerProgramStateId(TEMPLATE_LIST_ID);
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
      const st = await ioBroker.getState(TEMPLATE_LIST_ID);
      if (!st) {
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
      if (parsed) setTemplateRegistry(parsed);
    })().catch((e) => {
      console.error("initTemplates:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
