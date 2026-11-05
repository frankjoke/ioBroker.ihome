export type ToastLevel = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  /** Reuse this key instead of stacking a second toast. */
  key?: string;
  /** Stay until dismissed; no auto-dismiss timer. */
  sticky?: boolean;
  /** Auto-dismiss after this many milliseconds. */
  timeout?: number;
}

export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  key?: string;
  sticky: boolean;
  timeout: number;
}

const DEFAULT_TIMEOUT = 6000;
const MAX_VISIBLE = 3;
const timers: Record<number, ReturnType<typeof setTimeout>> = {};

export const toasts = $state<{ items: Toast[]; nextId: number }>({
  items: [],
  nextId: 1,
});

function clearTimer(id: number): void {
  const timer = timers[id];
  if (timer) {
    clearTimeout(timer);
    delete timers[id];
  }
}

function remove(id: number): void {
  clearTimer(id);
  toasts.items = toasts.items.filter((toast) => toast.id !== id);
}

function schedule(toast: Toast): void {
  clearTimer(toast.id);
  if (toast.sticky) return;
  timers[toast.id] = setTimeout(() => remove(toast.id), toast.timeout);
}

export function show(
  message: string,
  level: ToastLevel = "info",
  options: ToastOptions = {},
): Toast {
  const existing = options.key
    ? toasts.items.find((toast) => toast.key === options.key)
    : undefined;

  if (existing) {
    const next: Toast = {
      ...existing,
      message,
      level,
      sticky: options.sticky ?? existing.sticky,
      timeout: options.timeout ?? existing.timeout,
    };
    toasts.items = toasts.items.map((toast) =>
      toast.id === existing.id ? next : toast,
    );
    schedule(next);
    return next;
  }

  if (toasts.items.length >= MAX_VISIBLE) {
    // Newest first: drop the oldest non-sticky toast, not the newest.
    const removable = [...toasts.items]
      .reverse()
      .find((toast) => !toast.sticky);
    if (removable) remove(removable.id);
  }

  const item: Toast = {
    id: toasts.nextId++,
    level,
    message,
    key: options.key,
    sticky: options.sticky ?? false,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
  };
  toasts.items = [item, ...toasts.items];
  schedule(item);
  return item;
}

export function dismiss(id: number): void {
  remove(id);
}

export function dismissKey(key: string): void {
  const toast = toasts.items.find((item) => item.key === key);
  if (toast) remove(toast.id);
}

export function clear(): void {
  for (const id of Object.keys(timers)) clearTimer(Number(id));
  toasts.items = [];
}

export const toast = {
  show,
  info: (message: string, options?: ToastOptions) =>
    show(message, "info", options),
  success: (message: string, options?: ToastOptions) =>
    show(message, "success", options),
  warning: (message: string, options?: ToastOptions) =>
    show(message, "warning", options),
  error: (message: string, options?: ToastOptions) =>
    show(message, "error", options),
  dismiss,
  dismissKey,
  clear,
};
