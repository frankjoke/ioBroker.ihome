<script lang="ts">
  import { devicesEnrichedStore as devicesEnriched } from "$lib/stores/devices";
  import { applyWrite } from "$lib/utils/transform";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import EnumBadge from "$lib/components/common/EnumBadge.svelte";
  import { formatValue } from "$lib/config/format";
  import type { EnrichedControl } from "$lib/types/device";

  function truthy(v: unknown): boolean {
    return v === true || v === "true" || v === 1 || v === "1";
  }

  function write(control: EnrichedControl, value: unknown) {
    if (!control.available || !control.writable) return;
    const v = applyWrite(value, control.transform);
    ioBroker.setState(control.stateId, v).catch((e: unknown) => {
      console.warn("Failed to set state:", e);
    });
  }

  function enumOptions(
    control: EnrichedControl,
  ): { value: string; label: string }[] {
    const states = control.object?.common?.states;
    if (!states) return [];
    if (Array.isArray(states)) {
      return states.map((label, i) => ({
        value: String(i),
        label: String(label),
      }));
    }
    return Object.entries(states).map(([value, label]) => ({
      value,
      label: String(label),
    }));
  }

  function controlCommon(control: EnrichedControl) {
    return control.object?.common ?? {};
  }
</script>

<svelte:head>
  <title>Home - ioBroker Visual Interface</title>
</svelte:head>

<div class="home-page">
  <div class="page-header">
    <div class="page-heading">
      <span class="label-mono">Live</span>
      <h1>Home</h1>
    </div>
  </div>

  {#if $devicesEnriched.length === 0}
    <div class="card empty-state">
      <p class="text-muted">
        No devices yet. Add them on the
        <a href="/#/devices">Devices</a> page.
      </p>
    </div>
  {:else}
    {#each $devicesEnriched as device (device.id)}
      <div class="card device">
        <div class="device-head">
          <h3>
            {device.name}
            <span class="badge badge-secondary">{device.type}</span>
            {#if device.displayRoom}<EnumBadge
                id={device.displayRoom}
                enums={ioBroker.enums}
              />{/if}
          </h3>
        </div>

        <div class="controls">
          {#each device.controls as control (control.id)}
            <div class="control" class:unavailable={!control.available}>
              <span class="control-label"
                >{control.label || control.feature}</span
              >

              {#if control.virtualError}
                <span class="err" title={control.virtualError}>⚠</span>
              {/if}

              {#if !control.available}
                <span class="text-muted">unavailable</span>
              {:else if control.widget === "switch"}
                <button
                  type="button"
                  class="btn"
                  disabled={!control.writable}
                  onclick={() => write(control, !truthy(control.liveValue))}
                >
                  {truthy(control.liveValue) ? "On" : "Off"}
                </button>
              {:else if control.widget === "level"}
                <div class="level">
                  <input
                    type="range"
                    min={controlCommon(control).min ?? 0}
                    max={controlCommon(control).max ?? 100}
                    step={controlCommon(control).step ?? 1}
                    value={control.liveValue ?? 0}
                    disabled={!control.writable}
                    onchange={(e) =>
                      write(control, Number(e.currentTarget.value))}
                  />
                  <span class="mono"
                    >{formatValue(control.liveValue, control.unit)}</span
                  >
                </div>
              {:else if control.widget === "color"}
                <input
                  type="color"
                  value={control.liveValue ?? "#000000"}
                  disabled={!control.writable}
                  onchange={(e) => write(control, e.currentTarget.value)}
                />
              {:else if control.widget === "enum"}
                <select
                  value={String(control.liveValue ?? "")}
                  disabled={!control.writable}
                  onchange={(e) => write(control, e.currentTarget.value)}
                >
                  {#each enumOptions(control) as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              {:else if control.widget === "button"}
                <button
                  type="button"
                  class="btn"
                  disabled={!control.writable}
                  onclick={() => write(control, true)}
                >
                  Press
                </button>
              {:else}
                <span class="mono"
                  >{formatValue(control.liveValue, control.unit)}</span
                >
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .home-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-header h1 {
    margin: 0;
  }

  .device {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .device-head h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .controls {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.75rem;
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }

  .control.unavailable {
    opacity: 0.5;
  }

  .control-label {
    font-size: var(--body-sm);
    font-weight: 600;
  }

  .level {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: 1;
    justify-content: flex-end;
  }

  .level input {
    flex: 1;
    min-width: 4rem;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .err {
    color: var(--danger-color, #c0392b);
    font-size: var(--body-sm);
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }
</style>
