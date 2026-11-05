import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import { phone } from "$lib/stores/phone.svelte";
import { base64ToUint8Array } from "$lib/push-ops";

const PUBLIC_KEY_STATE = "info.pushPublicKey";

export interface PushStatus {
  supported: boolean;
  permission: "default" | "denied" | "granted" | "unsupported";
  subscribed: boolean;
  busy: boolean;
  error: string;
}

export const push = $state<PushStatus>({
  supported: false,
  permission: "default",
  subscribed: false,
  busy: false,
  error: "",
});

let initialized = false;
let registration: ServiceWorkerRegistration | null = null;

function hasSupport(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof PushManager !== "undefined" &&
    typeof Notification !== "undefined"
  );
}

function publicKey(): string {
  const value = ioBroker.states.get(
    `${ioBroker.namespace}.${PUBLIC_KEY_STATE}`,
  )?.val;
  return typeof value === "string" ? value.trim() : "";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  if (registration) return registration;
  registration = await navigator.serviceWorker.ready;
  return registration;
}

async function registerSubscription(
  subscription: PushSubscription,
): Promise<void> {
  const result = (await ioBroker.sendTo(ioBroker.namespace, "push", {
    action: "subscribe",
    deviceId: phone.deviceId,
    name: phone.name,
    subscription: subscription.toJSON(),
  })) as { ok?: boolean; error?: string } | undefined;
  if (!result?.ok) {
    throw new Error(result?.error ?? "The adapter rejected the subscription.");
  }
}

export function initPush(): void {
  if (initialized) return;
  initialized = true;
  push.supported = hasSupport();
  push.permission =
    typeof Notification === "undefined"
      ? "unsupported"
      : (Notification.permission as PushStatus["permission"]);
  registerProgramStateId(`${ioBroker.namespace}.${PUBLIC_KEY_STATE}`);
  if (!push.supported) return;
  void serviceWorker()
    .then(async (reg) => {
      const subscription = await reg.pushManager.getSubscription();
      push.subscribed = Boolean(subscription);
      if (subscription && Notification.permission === "granted") {
        // Reconcile: the adapter may have lost the record or the browser may
        // have rotated the endpoint while the app was closed.
        await registerSubscription(subscription);
      }
    })
    .catch(() => {
      // The worker is not ready yet; the toggle still works later.
    });
}

export async function enablePush(): Promise<void> {
  if (!push.supported) {
    push.error = "Push is not supported in this browser.";
    return;
  }
  push.busy = true;
  push.error = "";
  try {
    const permission = await Notification.requestPermission();
    push.permission = permission as PushStatus["permission"];
    if (permission !== "granted") {
      push.error =
        permission === "denied"
          ? "Notifications are blocked in the browser settings."
          : "Notification permission was not granted.";
      return;
    }
    const key = publicKey();
    if (!key) {
      push.error = "Push is not configured on the adapter.";
      return;
    }
    const reg = await serviceWorker();
    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(key),
      }));
    await registerSubscription(subscription);
    push.subscribed = true;
  } catch (error) {
    push.error = errorText(error);
  } finally {
    push.busy = false;
  }
}

export async function disablePush(): Promise<void> {
  push.busy = true;
  push.error = "";
  try {
    const reg = await serviceWorker();
    const subscription = await reg.pushManager.getSubscription();
    await subscription?.unsubscribe();
    await ioBroker.sendTo(ioBroker.namespace, "push", {
      action: "unsubscribe",
      deviceId: phone.deviceId,
    });
    push.subscribed = false;
  } catch (error) {
    push.error = errorText(error);
  } finally {
    push.busy = false;
  }
}
