<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { writeControl } from "$lib/utils/control-write";
  import { splitReading } from "$lib/config/format";
  import { normalizeStates, unitFor } from "$lib/config/state-meta";
  import { levelRange } from "$lib/config/features";
  import type { EnrichedControl } from "$lib/types/device";

  let {
    control,
    options = {},
    home = "tile",
  }: {
    control: EnrichedControl;
    /** The slot's own knobs (min/max/step): what the user set in the tile editor. */
    options?: Record<string, unknown>;
    /** Which surface renders this control: the tile or the detail page. */
    home?: "tile" | "modal";
  } = $props();

  function truthy(v: unknown): boolean {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  /** `lock` is for toggles: one press must mean one change of state, never two. */
  function write(value: unknown, lock = false) {
    writeControl(ioBroker, control, value, Date.now(), {
      // The lock is the *value*: released as soon as the broker confirms it.
      lockMs: lock ? 3000 : 0,
    });
  }

  function enumOptions(): { value: string; label: string }[] {
    // The corrected map wins over the broker object (spec §6); raw states carry
    // their own states through the resolver.
    const states = normalizeStates(
      control.meta?.states ?? control.states ?? control.object?.common?.states,
    );
    return states
      ? Object.entries(states).map(([value, label]) => ({ value, label }))
      : [];
  }

  const common = $derived(
    (control.object?.common ?? {}) as Record<string, any>,
  );
  const range = $derived(
    levelRange((control.meta ?? common) as Record<string, unknown>, options),
  );

  /** The mono readout with the effective unit and states labels. */
  function readout(): string {
    const parts = splitReading(
      control.liveValue,
      unitFor(undefined, control.meta?.unit, control.unit),
      undefined,
      normalizeStates(control.meta?.states ?? control.states),
    );
    return parts.unit ? `${parts.value} ${parts.unit}` : parts.value;
  }
  /** The readout's own homes; absent = both. `hideValue` turns it off entirely. */
  const valueWhere = $derived(
    options.valueWhere === "tile" || options.valueWhere === "modal"
      ? options.valueWhere
      : "both",
  );
  const showValue = $derived(
    options.hideValue !== true &&
      (valueWhere === "both" || valueWhere === home),
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
      min={range.min}
      max={range.max}
      step={range.step}
      value={control.liveValue ?? 0}
      disabled={!control.writable}
      onpointerdown={stop}
      onclick={stop}
      onchange={(e) => write(Number(e.currentTarget.value))}
    />
    {#if showValue}
      <span class="mono">{readout()}</span>
    {/if}
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
      // A button state is momentary: release it again, so adapters that expect
      // a pulse do not see a stuck "on".
      setTimeout(() => write(false), 300);
    }}
  >
    Press
  </button>
{:else}
  <span class="mono">{readout()}</span>
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
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    min-width: 0;
    width: 100%;
  }

  /* The slider's 6rem basis keeps the reading beside it while there is room;
     on a narrow tile both no longer fit on one line and the reading wraps
     underneath, centred, instead of squeezing the slider to nothing. */
  .level input {
    flex: 1 1 6rem;
    min-width: 0;
  }

  .level .mono {
    flex: 0 0 auto;
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
