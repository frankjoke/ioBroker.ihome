// The one-time device → source-override migration. The pure conversion lives
// in `$lib/config/migrate-overrides`; this module owns the documents: it backs
// up the three registries, then writes overrides, pages, templates and finally
// the marker. Nothing calls the write path automatically — the user confirms
// it; `dryRunDeviceMigration()` only reads and logs.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  migrateDevices,
  type DeviceMigrationInput,
} from "$lib/config/migrate-overrides";
import { isRegistryWritable } from "$lib/registry.svelte.js";
import {
  getCanonicalRegistry,
  DEVICE_LIST_ID,
} from "$lib/stores/devices.svelte";
import {
  commitLayoutNow,
  getPageRegistry,
  isLayoutWritable,
  PAGE_LIST_ID,
} from "$lib/stores/pages.svelte";
import {
  commitTemplatesNow,
  getTemplateRegistry,
  isTemplatesWritable,
} from "$lib/stores/templates.svelte";
import {
  commitOverrides,
  getOverrideRegistry,
  isOverridesWritable,
} from "$lib/stores/overrides.svelte";
import { getVariableLibrary } from "$lib/stores/variables.svelte";
import { toast } from "$lib/stores/toasts.svelte";

/** The three pre-migration documents, kept once (never overwritten). */
export const DEVICE_BACKUP_ID = "ihome.0.config.deviceListPreOverrides";
export const PAGE_BACKUP_ID = "ihome.0.config.pageListPreOverrides";
export const TEMPLATE_BACKUP_ID = "ihome.0.config.templateListPreOverrides";

export interface DeviceMigrationRun {
  /** `ready` is the dry run's "this is what would happen". */
  status: "skipped" | "ready" | "applied" | "failed";
  reason?: string;
  log: string[];
  changed: boolean;
}

interface Backup {
  id: string;
  name: string;
  value: string;
}

interface Plan {
  status: "ready";
  input: DeviceMigrationInput;
  backups: Backup[];
}

interface Refusal {
  status: "skipped";
  reason: string;
  log: string[];
  changed: false;
}

function refused(reason: string): Refusal {
  return { status: "skipped", reason, log: [], changed: false };
}

async function readDocument(id: string): Promise<string | undefined> {
  const state = await ioBroker.getState(id, true).catch(() => null);
  if (!state) return undefined;
  const value = state.val ?? state.value;
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function writeBackupOnce(backup: Backup): Promise<boolean> {
  try {
    const existing = await ioBroker.getState(backup.id, true);
    if (
      existing &&
      existing.val !== undefined &&
      existing.val !== null &&
      existing.val !== ""
    ) {
      return true;
    }
    const object = await ioBroker.getObject(backup.id);
    if (!object) {
      await ioBroker.emitAsync("setObject", backup.id, {
        type: "state",
        common: {
          name: backup.name,
          type: "string",
          role: "text.json",
          read: true,
          write: false,
        },
        native: {},
      });
    }
    await ioBroker.setState(backup.id, backup.value);
    return true;
  } catch (e) {
    console.error("device migration backup:", e);
    return false;
  }
}

/** What the migration would do, or why it must not run. Reads only. */
async function planMigration(): Promise<Plan | Refusal> {
  if (getOverrideRegistry().migratedDevices === true) {
    return refused("already migrated");
  }
  if (!ioBroker.connected) return refused("not connected");
  if (
    !isOverridesWritable() ||
    !isLayoutWritable() ||
    !isTemplatesWritable() ||
    !isRegistryWritable()
  ) {
    return refused("the documents are not writable");
  }
  const canonical = getCanonicalRegistry();
  const devices = canonical.devices ?? [];
  if (!devices.length) return refused("no devices");

  const pages = getPageRegistry();
  const templates = getTemplateRegistry();
  const input: DeviceMigrationInput = {
    devices,
    pages,
    templates,
    overrides: getOverrideRegistry(),
    objects: ioBroker.objects as Map<string, any>,
    variables: getVariableLibrary().variables ?? [],
  };

  const [deviceRaw, pageRaw] = await Promise.all([
    readDocument(DEVICE_LIST_ID),
    readDocument(PAGE_LIST_ID),
  ]);
  return {
    status: "ready",
    input,
    backups: [
      {
        id: DEVICE_BACKUP_ID,
        name: "iHome device list (pre-source-overrides backup)",
        value: deviceRaw ?? JSON.stringify(canonical),
      },
      {
        id: PAGE_BACKUP_ID,
        name: "iHome display pages (pre-source-overrides backup)",
        value: pageRaw ?? JSON.stringify(pages),
      },
      {
        id: TEMPLATE_BACKUP_ID,
        // Templates are file-backed: the legacy state is stale on upgraded
        // installs, so back up what was actually loaded. Restoring this means
        // rewriting the files (`syncKind`), not copying a directory back.
        name: "iHome templates (pre-source-overrides backup)",
        value: JSON.stringify(templates),
      },
    ],
  };
}

/** The last successful dry run: the layout effect may re-run, the log should not. */
let dryRunCache: DeviceMigrationRun | null = null;

/**
 * Read the documents, run the migration in memory and log the result. Never
 * writes: this is the browser dry run before the user-confirmed apply.
 */
export async function dryRunDeviceMigration(): Promise<DeviceMigrationRun> {
  if (getOverrideRegistry().migratedDevices === true) {
    return refused("already migrated");
  }
  if (dryRunCache) return dryRunCache;
  const plan = await planMigration();
  if (plan.status !== "ready") return plan;
  const result = migrateDevices(plan.input);
  console.info(
    `[migration] device migration dry run: ${result.overrides.overrides.length} override(s), changed=${result.changed}, ${result.log.length} note(s)`,
  );
  for (const line of result.log) console.info(`[migration] ${line}`);
  dryRunCache = {
    status: "ready",
    log: result.log,
    changed: result.changed,
  };
  return dryRunCache;
}

/**
 * Apply the migration. Refuses unless `confirm` is true — the live write is a
 * separate, user-confirmed step (nothing in the app calls this automatically).
 * Backups come first; a failed write leaves the marker unset, so a retry is
 * safe and the stored documents stay as they were until their own commit.
 */
export async function applyDeviceMigration(
  confirm: false | true,
): Promise<DeviceMigrationRun> {
  if (confirm !== true) {
    return refused("not confirmed");
  }
  const plan = await planMigration();
  if (plan.status !== "ready") {
    console.error("device migration:", plan.status, plan.reason);
    if (plan.status === "skipped" && plan.reason !== "already migrated") {
      toast.error(`Device migration: ${plan.reason}`);
    }
    return plan;
  }

  for (const backup of plan.backups) {
    if (await writeBackupOnce(backup)) continue;
    toast.error("Device migration: the backup could not be written");
    return {
      status: "failed",
      reason: `backup ${backup.id} failed`,
      log: [],
      changed: false,
    };
  }

  const result = migrateDevices(plan.input);
  if (result.changed) {
    const overrides = await commitOverrides(
      result.overrides,
      getOverrideRegistry().updatedAt,
    );
    if (overrides !== "saved") {
      console.error(`device migration: overrides not saved (${overrides})`);
      toast.error(`Device migration: overrides not saved (${overrides})`);
      return {
        status: "failed",
        reason: `overrides ${overrides}`,
        log: result.log,
        changed: true,
      };
    }
    if (!(await commitLayoutNow(result.pages))) {
      console.error("device migration: pages not saved");
      toast.error("Device migration: pages not saved");
      return {
        status: "failed",
        reason: "pages not saved",
        log: result.log,
        changed: true,
      };
    }
    if (!(await commitTemplatesNow(result.templates))) {
      console.error("device migration: templates not saved");
      toast.error("Device migration: templates not saved");
      return {
        status: "failed",
        reason: "templates not saved",
        log: result.log,
        changed: true,
      };
    }
  }

  const current = getOverrideRegistry();
  const marker = await commitOverrides(
    { ...current, migratedDevices: true },
    current.updatedAt,
  );
  if (marker !== "saved") {
    console.error(`device migration: marker not saved (${marker})`);
    toast.error(`Device migration: marker not saved (${marker})`);
    return {
      status: "failed",
      reason: `marker ${marker}`,
      log: result.log,
      changed: result.changed,
    };
  }
  toast.success("Devices and tiles were migrated to source overrides");
  return {
    status: "applied",
    log: result.log,
    changed: result.changed,
  };
}
