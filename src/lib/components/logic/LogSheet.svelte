<script lang="ts">
  import { onMount } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";

  let { onClose }: { onClose: () => void } = $props();

  interface Line {
    seq: number;
    ts: number;
    from: string;
    severity: string;
    message: string;
  }

  const LOG_STATE = `${ioBroker.namespace}.info.log`;
  const CLEAR_STATE = `${ioBroker.namespace}.info.logClear`;

  /** The adapter publishes the last 200 lines as `info.log`. */
  let lines = $state<Line[]>([]);
  /** Header selector: the minimum severity, `all` shows everything. */
  const LEVELS = ["all", "debug", "info", "warn", "error"] as const;
  type Level = (typeof LEVELS)[number];
  const RANK: Record<string, number> = {
    silly: 0,
    debug: 1,
    info: 2,
    warn: 3,
    error: 4,
  };
  /** The instance's configured level (`common.loglevel`), as a selector value. */
  function configuredLevel(): Level {
    const obj = ioBroker.objects.get(`system.adapter.${ioBroker.namespace}`) as
      { common?: { loglevel?: string } } | undefined;
    const level = String(obj?.common?.loglevel ?? "info").toLowerCase();
    if (level === "silly") return "all";
    return (LEVELS as readonly string[]).includes(level)
      ? (level as Level)
      : "info";
  }
  let minLevel = $state<Level>(configuredLevel());
  const shown = $derived(
    minLevel === "all"
      ? lines
      : lines.filter(
          (line) => (RANK[line.severity] ?? RANK.info) >= (RANK[minLevel] ?? 0),
        ),
  );
  let error = $state("");
  let busy = false;
  let list: HTMLDivElement | undefined = $state();
  let atTop = true;

  async function fetchLines(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      // `true`: always read the broker, not the cache (this state is not in
      // the app's subscription plan).
      const state = await ioBroker.getState(LOG_STATE, true);
      const raw = state?.val;
      const page = typeof raw === "string" && raw ? JSON.parse(raw) : null;
      if (!page || !Array.isArray(page.entries)) {
        error = "No log feed — install the current adapter build.";
        return;
      }
      error = "";
      // Newest first, so the interesting line is always at the top.
      lines = page.entries.slice(-1000).reverse();
      if (atTop) scrollToTop();
    } catch {
      error = "No log feed — install the current adapter build.";
    } finally {
      busy = false;
    }
  }

  async function clear(): Promise<void> {
    lines = [];
    try {
      await ioBroker.setState(CLEAR_STATE, true);
    } catch {
      // the next poll shows the state anyway
    }
  }

  function scrollToTop(): void {
    requestAnimationFrame(() => {
      if (list) list.scrollTop = 0;
    });
  }

  function onScroll(): void {
    if (!list) return;
    atTop = list.scrollTop <= 8;
  }

  function clock(ts: number): string {
    return ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : "—";
  }

  onMount(() => {
    void fetchLines();
    const timer = setInterval(fetchLines, 2000);
    return () => clearInterval(timer);
  });
</script>

<aside class="sheet" aria-label="iHome log">
  <header class="sheet-head">
    <span class="title">iHome log</span>
    <span class="actions">
      <select
        class="level"
        aria-label="Minimum log level"
        bind:value={minLevel}
      >
        <option value="all">All</option>
        <option value="debug">Debug+</option>
        <option value="info">Info+</option>
        <option value="warn">Warn+</option>
        <option value="error">Error</option>
      </select>
      <button
        type="button"
        class="btn btn-sm"
        title="Clear the log"
        onclick={clear}
      >
        <span class="material-symbols-outlined">delete_sweep</span>
        Clear
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close the log"
        title="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </span>
  </header>

  {#if error}
    <p class="hint text-danger">{error}</p>
  {/if}

  <div class="lines" bind:this={list} onscroll={onScroll}>
    {#each shown as line (line.seq)}
      <div class="line">
        <span class="time mono">{clock(line.ts)}</span>
        <span class="severity {line.severity}">{line.severity}</span>
        <span class="message mono">{line.message}</span>
      </div>
    {/each}
    {#if shown.length === 0 && !error}
      <p class="hint text-muted">
        {lines.length ? "No lines at this level." : "No lines yet."}
      </p>
    {/if}
  </div>
</aside>

<style>
  /* Same place as the layout editor's sheet: over the page, under the app bar. */
  .sheet {
    position: fixed;
    top: 44px;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    width: min(560px, 100vw);
    background-color: var(--surface-container-lowest);
    border-left: 1px solid var(--border-color);
    color: var(--text-color);
  }

  @media (max-width: 820px) {
    .sheet {
      top: auto;
      width: 100%;
      height: 70vh;
      border-top: 1px solid var(--border-color);
      border-left: 0;
    }
  }

  .sheet-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .title {
    font-weight: 600;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }

  .level {
    font-size: var(--body-sm);
    padding: 0.15rem 0.25rem;
    max-width: 7rem;
  }

  .lines {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0.5rem 1rem;
  }

  .line {
    display: grid;
    grid-template-columns: 5.5rem 4.5rem 1fr;
    gap: 0.4rem;
    padding: 0.15rem 0;
    font-size: var(--body-sm);
    border-bottom: 1px solid
      color-mix(in srgb, var(--border-color) 40%, transparent);
  }

  .time {
    color: var(--text-muted);
  }

  .severity {
    text-transform: uppercase;
    font-size: 0.7rem;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .severity.warn {
    color: var(--warning-color, #b26a00);
  }

  .severity.error {
    color: var(--danger-color, #c62828);
  }

  .message {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .hint {
    font-size: var(--body-sm);
    padding: 0.5rem;
  }

  @media (max-width: 520px) {
    .line {
      grid-template-columns: 1fr auto;
    }

    .time {
      grid-column: 1 / -1;
    }
  }
</style>
