/**
 * What each configuration page was showing when the user left it: scroll
 * position, the unfolded item and the active tab. Kept in memory while the app
 * runs and mirrored to sessionStorage so a reload in the same tab comes back to
 * the same place; a new tab starts clean. Unsaved editor drafts are not part of
 * this store.
 */
export interface PageView {
  scrollY?: number;
  /** The previously opened row, or null when it was closed. */
  openId?: string | null;
  /** What kind the open row belongs to (templates list). */
  kind?: string;
  /** The active page tab. */
  tab?: string;
  /** A list's search text. */
  query?: string;
  /** A list's selected instance filter. */
  instance?: string;
  /** Boolean list filters (override, history, …). */
  filters?: Record<string, boolean>;
}

const KEY = "iHome.pageView";
const views = new Map<string, PageView>();
let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const [route, value] of Object.entries(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        views.set(route, value as PageView);
      }
    }
  } catch {
    // Private mode or a value written by another version: start empty.
  }
}

function schedule(): void {
  if (timer !== undefined) return;
  timer = setTimeout(flushViews, 250);
}

/** The remembered view of a route, if the user has been there. */
export function readView(route: string): PageView | undefined {
  load();
  return views.get(route);
}

/** Remember one or more fields; other fields of the route survive. */
export function patchView(route: string, patch: Partial<PageView>): void {
  load();
  views.set(route, { ...(views.get(route) ?? {}), ...patch });
  schedule();
}

/** Write the pending state now; called on navigation and pagehide. */
export function flushViews(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (!loaded) return;
  try {
    globalThis.sessionStorage?.setItem(
      KEY,
      JSON.stringify(Object.fromEntries(views)),
    );
  } catch {
    // Private mode: the in-memory views still work for this run.
  }
}
