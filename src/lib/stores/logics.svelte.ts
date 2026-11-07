// The logic document (ihome.0.config.logicList), edited by the SPA and run by
// the adapter. Same registry pattern as pages/templates: a debounced
// whole-document write, a load kind that refuses to overwrite an unreadable
// document, and an echo guard for our own write.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  parseLogicDocument,
  validateLogicDocument,
  type Issue,
} from "$logic/validate";
import type { LogicDocument } from "$logic/types";

export const LOGIC_LIST_ID = "ihome.0.config.logicList";

const emptyDocument = (): LogicDocument => ({ version: 3, logics: [] });

let logicDocument = $state<LogicDocument>(emptyDocument());
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);
let saveFailed = $state(false);
let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
/** Validation issues of the document in hand; errors block the write. */
let issues = $state<Issue[]>([]);

export function getLogicDocument(): LogicDocument {
  return logicDocument;
}

export function logicsLoadKind(): typeof loadKind {
  return loadKind;
}

export function logicSaveFailed(): boolean {
  return saveFailed;
}

export function logicIssues(): Issue[] {
  return issues;
}

/** True while the document in hand has errors, so nothing is persisted. */
export function logicBlocked(): boolean {
  return issues.some((issue) => issue.severity === "error");
}

/** False until the document was read, and false for an unreadable one. */
export function isLogicsWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

async function ensureLogicsObject() {
  const obj = await ioBroker.getObject(LOGIC_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", LOGIC_LIST_ID, {
      type: "state",
      common: {
        name: "iHome logic documents",
        type: "string",
        role: "text.json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveLogics(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = JSON.stringify(logicDocument);
  saveTimer = setTimeout(() => {
    // The document may have changed under us (a newer version from another
    // client, an unreadable one); never overwrite what we cannot read.
    if (!isLogicsWritable()) {
      saveFailed = true;
      return;
    }
    const doc = parseLogicDocument(snapshot);
    if (!doc) {
      saveFailed = true;
      return;
    }
    issues = validateLogicDocument(doc);
    if (issues.some((issue) => issue.severity === "error")) return;
    // A disconnected socket resolves without sending; never report success.
    if (!ioBroker.connected) {
      saveFailed = true;
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(LOGIC_LIST_ID, snapshot)
      .then(() => {
        saveFailed = false;
      })
      .catch((e) => {
        saveFailed = true;
        console.error("save logics:", e);
      });
  }, 250);
}

/** The editor's only write path; refuses while the document is unreadable. */
export function commitLogics(next: LogicDocument): boolean {
  if (!isLogicsWritable()) {
    console.error(
      "logicList is not readable (no successful load) — the change was not saved",
    );
    return false;
  }
  logicDocument = next;
  issues = validateLogicDocument(next);
  saveLogics();
  return isLogicsWritable();
}

/** Load the document; an absent one is a valid empty document. */
export function initLogics(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureLogicsObject();
      } catch (e) {
        console.error("initLogics ensureLogicsObject:", e);
      }
      const st = await ioBroker.getState(LOGIC_LIST_ID, true);
      if (!st) {
        loadKind = "absent";
        initPromise = null;
        return;
      }
      st.onUpdate = (_cl: unknown, state: { val?: unknown }) => {
        const parsed = parseLogicDocument(state?.val);
        if (!parsed) {
          // A newer or broken document arrived after load: stop writing.
          if (state?.val != null && state.val !== "") {
            loadKind = "unreadable";
            if (saveTimer) {
              clearTimeout(saveTimer);
              saveTimer = null;
            }
          }
          return true;
        }
        const asString = JSON.stringify(parsed);
        if (lastSent !== null && lastSent === asString) return true;
        logicDocument = parsed;
        issues = validateLogicDocument(parsed);
        loadKind = "loaded";
        return true;
      };
      const parsed = parseLogicDocument(st.value);
      if (parsed) {
        loadKind = "loaded";
        logicDocument = parsed;
        issues = validateLogicDocument(parsed);
      } else if (st.value != null && st.value !== "") {
        loadKind = "unreadable";
        console.error(
          "logicList is unreadable — leaving it untouched rather than overwriting it",
        );
      } else {
        loadKind = "absent";
      }
    })().catch((e) => {
      console.error("initLogics:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
