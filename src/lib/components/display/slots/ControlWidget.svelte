<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import { formatValue } from "$lib/config/format";
  import type { EnrichedControl } from "$lib/types/device";

  let { control }: { control: EnrichedControl } = $props();

  function truthy(v: unknown): boolean {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  /** `lock` is for toggles: one press must mean one change of state, never two. */
  function write(value: unknown, lock = false) {
    writeControl(ioBroker, control, value, Date.now(), {
      lockMs: lock ? 750 : 0,
    });
  }

  function enumOptions(): { value: string; label: string }[] {
    const states = control.object?.common?.states;
    if (!states) return [];
    if (Array.isArray(states)) {
      return states.map((label: unknown, i: number) => ({
        value: String(i),
        label: String(label),
      }));
    }
    return Object.entries(states as Record<string, unknown>).map(
      ([value, label]) => ({ value, label: String(label) }),
    );
  }

  const common = $derived(
    (control.object?.common ?? {}) as Record<string, any>,
  );

  // Keep a drag on a slider from reaching the tile underneath it.
  function stop(e: Event) {
    e.stopPropagation();
  }
</script>

{#if !control.available && control.kind !== "virtual"}
  <span class="text-muted">unavailable</span>
{:else if control.widget === "switch"}
  <button
    type="button"
    class="btn"
    disabled={!control.writable}
    onclick={(e) => {
      e.stopPropagation();
      write(!truthy(control.liveValue), true);
    }}
  >
    {truthy(control.liveValue) ? "On" : "Off"}
  </button>
{:else if control.widget === "level"}
  <div class="level">
    <input
      type="range"
      aria-label={control.label || control.feature}
      min={common.min ?? 0}
      max={common.max ?? 100}
      step={common.step ?? 1}
      value={control.liveValue ?? 0}
      disabled={!control.writable}
      onpointerdown={stop}
      onclick={stop}
      onchange={(e) => write(Number(e.currentTarget.value))}
    />
    <span class="mono">{formatValue(control.liveValue, control.unit)}</span>
  </div>
{:else if control.widget === "color"}
  <input
    class="color"
    type="color"
    aria-label={control.label || control.feature}
    value={control.liveValue ?? "#000000"}
    disabled={!control.writable}
    onpointerdown={stop}
    onclick={stop}
    onchange={(e) => write(e.currentTarget.value)}
  />
{:else if control.widget === "enum"}
  <select
    aria-label={control.label || control.feature}
    value={String(control.liveValue ?? "")}
    disabled={!control.writable}
    onpointerdown={stop}
    onclick={stop}
    onchange={(e) => write(e.currentTarget.value)}
  >
    {#each enumOptions() as opt (opt.value)}
      <option value={opt.value}>{opt.label}</option>
    {/each}
  </select>
{:else if control.widget === "button"}
  <button
    type="button"
    class="btn"
    disabled={!control.writable}
    onclick={(e) => {
      e.stopPropagation();
      write(true, true);
    }}
  >
    Press
  </button>
{:else}
  <span class="mono">{formatValue(control.liveValue, control.unit)}</span>
{/if}

<style>
  .btn {
    padding: 2px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    background-color: var(--surface-container);
    color: var(--text-color);
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    width: 100%;
  }

  .level input {
    flex: 1;
    min-width: 2rem;
    width: 100%;
  }

  .color {
    width: 100%;
    min-width: 2rem;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
  }

  select {
    max-width: 100%;
    font-size: var(--body-sm);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    white-space: nowrap;
  }
</style>
