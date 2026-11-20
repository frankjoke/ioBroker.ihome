// User templates live as one file per template in the shared space
// (`ihome.meta/templates/device/<id>.json`). The folder is the truth; the old
// `templateList` state is read once for migration and then left untouched.
// Built-in presets stay in code and are never stored.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  migrateTemplateRegistry,
  parseTemplateRegistry,
} from "$lib/config/template-ops";
import { listTemplates, syncKind } from "$lib/config/template-files";
import { stateIdsInExpression } from "$lib/config/rule-ops";
import { registerProgramStateId } from "$lib/stores/program-states.svelte";
import { stateIdFor } from "$lib/config/variables";
import { getVariableLibrary } from "$lib/stores/variables.svelte";
import { getSettings } from "$lib/stores/settings.svelte";
import { SIZE_UNIT } from "$lib/config/size-ops";
import type { TemplateRegistry } from "$lib/types/display";
import type { Template } from "$lib/types/display";

export const TEMPLATE_LIST_ID = "ihome.0.config.templateList";

const emptyRegistry: TemplateRegistry = {
  version: 0,
  updatedAt: 0,
  templates: [],
};

let templateRegistry = $state<TemplateRegistry>(emptyRegistry);
/** Ids present in the folder at the last load/save; deleting removes the rest. */
let knownIds: Record<string, true> = {};

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
let saveFailed = $state(false);
let templatesLoadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);

/** True while the last file write failed, so the pane can say "not saved". */
export function getTemplateSaveFailed(): boolean {
  return saveFailed;
}

/** May templates be written? False until loaded; a corrupt legacy document
 *  without files still blocks writes so it is never replaced by "none". */
export function isTemplatesWritable(): boolean {
  return templatesLoadKind === "loaded" || templatesLoadKind === "absent";
}

function registryOf(templates: Template[]): TemplateRegistry {
  return { version: 1, updatedAt: Date.now(), templates };
}

/** Every write goes to the folder: one file per template, stale files removed. */
export function saveTemplates(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const templates = getTemplateRegistry().templates ?? [];
  saveTimer = setTimeout(() => {
    if (!ioBroker.connected) {
      saveFailed = true;
      return;
    }
    void (async () => {
      try {
        await syncKind("device", templates, Object.keys(knownIds));
        knownIds = Object.fromEntries(
          templates.map((template) => [template.id, true]),
        );
        saveFailed = false;
      } catch (e) {
        saveFailed = true;
        console.error("save templates:", e);
      }
    })();
  }, 250);
}

/** The pane's only write path: replace the registry and persist it. */
export function commitTemplates(next: TemplateRegistry): boolean {
  if (!isTemplatesWritable()) {
    console.error(
      "templates are not readable (no successful load) — the change was not saved",
    );
    return false;
  }
  setTemplateRegistry(next);
  saveTemplates();
  return true;
}

/**
 * The awaited file write for a one-time migration: every template goes to its
 * file now, stale files are removed, and only a success replaces the in-memory
 * registry. A failure leaves the registry as it was (a retry rewrites all files).
 */
export async function commitTemplatesNow(
  next: TemplateRegistry,
): Promise<boolean> {
  if (!isTemplatesWritable()) {
    console.error(
      "templates are not readable (no successful load) — the change was not saved",
    );
    return false;
  }
  if (!ioBroker.connected) {
    saveFailed = true;
    return false;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const templates = next.templates ?? [];
  try {
    await syncKind("device", templates, Object.keys(knownIds));
  } catch (e) {
    saveFailed = true;
    console.error("save templates:", e);
    return false;
  }
  knownIds = Object.fromEntries(
    templates.map((template) => [template.id, true]),
  );
  setTemplateRegistry(next);
  saveFailed = false;
  return true;
}

/**
 * The template document, plus every raw state and rule id its templates name:
 * a device that has no slots of its own renders the chain's, so the chain's
 * sources and rules must be in the used set too.
 */
function registerTemplateStateIds(): void {
  registerProgramStateId(TEMPLATE_LIST_ID);
  const variables = getVariableLibrary().variables ?? [];
  for (const template of getTemplateRegistry().templates ?? []) {
    for (const slot of template?.slots ?? []) {
      const source = slot?.source;
      if (typeof source === "string" && source) {
        const id = stateIdFor(source, variables);
        if (id.includes(".")) registerProgramStateId(id);
      }
      for (const rule of slot?.rules ?? []) {
        for (const id of stateIdsInExpression(rule?.when ?? "")) {
          registerProgramStateId(id);
        }
      }
    }
  }
}

/** Load the templates from the folder; migrate the old state once. */
export function initTemplates(): Promise<void> {
  registerTemplateStateIds();
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      if (!ioBroker.connected) {
        initPromise = null;
        return;
      }

      const files = await listTemplates("device");
      const readable = files.filter(
        (row): row is { id: string; file: NonNullable<typeof row.file> } =>
          !!row.file,
      );
      if (files.length) {
        templatesLoadKind = "loaded";
        knownIds = Object.fromEntries(readable.map((row) => [row.id, true]));
        setTemplateRegistry(
          registryOf(readable.map((row) => row.file.definition as Template)),
        );
        return;
      }

      // No files yet: migrate the legacy document once (never written again).
      let state: { value?: unknown } | null = null;
      try {
        state = await ioBroker.getState(TEMPLATE_LIST_ID, true);
      } catch (e) {
        console.error("initTemplates legacy:", e);
      }
      const parsed = parseTemplateRegistry(state?.value);
      if (parsed) {
        const migrated = migrateTemplateRegistry(
          parsed,
          getSettings().sizeUnit === SIZE_UNIT,
        );
        setTemplateRegistry(migrated.registry);
        templatesLoadKind = "loaded";
        try {
          await syncKind("device", migrated.registry.templates, []);
          knownIds = Object.fromEntries(
            migrated.registry.templates.map((template) => [template.id, true]),
          );
        } catch (e) {
          saveFailed = true;
          console.error("migrate templates:", e);
        }
        return;
      }
      if (state && state.value != null && state.value !== "") {
        templatesLoadKind = "unreadable";
        console.error(
          "the legacy template document is unreadable and no template files exist — leaving both untouched",
        );
        return;
      }
      templatesLoadKind = "absent";
    })().catch((e) => {
      console.error("initTemplates:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
