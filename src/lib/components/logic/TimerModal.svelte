<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import { parseDuration } from "$logic/duration";
  import { ASTRO_EVENTS, DAY_NAMES, parseCronAt } from "$logic/timer-ops";
  import type { AstroEvent, TimerSpec } from "$logic/types";

  let {
    timer = null,
    onSave,
    onCancel,
  }: {
    timer?: TimerSpec | null;
    onSave: (timer: TimerSpec) => void;
    onCancel: () => void;
  } = $props();

  type Kind = "every" | "cron" | "astro";
  const TIMER_TABS = [
    { id: "every", label: "Every", hint: "A repeating interval, e.g. 5m." },
    { id: "cron", label: "Cron", hint: "A time of day on selected weekdays." },
    {
      id: "astro",
      label: "Astro",
      hint: "A sun time from the system location.",
    },
  ] as const;
  const initial = untrack(() => {
    const cron =
      timer && typeof timer !== "string" && timer.kind === "cron"
        ? timer
        : undefined;
    return {
      kind: (timer && typeof timer !== "string" ? timer.kind : "every") as Kind,
      every: typeof timer === "string" ? timer : "5m",
      astroEvent: (timer && typeof timer !== "string" && timer.kind === "astro"
        ? timer.event
        : "sunrise") as AstroEvent,
      offset:
        timer && typeof timer !== "string" && timer.kind === "astro"
          ? (timer.offset ?? 0)
          : 0,
      at: cron?.at ?? "07:30",
      days:
        cron && Array.isArray(cron.days) ? cron.days : [0, 1, 2, 3, 4, 5, 6],
    };
  });
  let kind = $state<Kind | null>(initial.kind);
  let every = $state(initial.every);
  let astroEvent = $state<AstroEvent>(initial.astroEvent);
  let offset = $state(initial.offset);
  let at = $state(initial.at);
  const days = new SvelteSet<number>(initial.days);

  const everyOk = $derived((parseDuration(every) ?? 0) > 0);
  const atOk = $derived(parseCronAt(at) !== undefined);
  const daysOk = $derived(days.size > 0);
  const canSave = $derived(
    kind === "every" ? everyOk : kind === "astro" ? true : atOk && daysOk,
  );

  function toggleDay(day: number) {
    if (days.has(day)) days.delete(day);
    else days.add(day);
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSave) return;
    if (kind === "every") {
      onSave(every.trim());
      return;
    }
    if (kind === "astro") {
      onSave({ kind: "astro", event: astroEvent, offset: Number(offset) || 0 });
      return;
    }
    if (kind !== "cron") return;
    onSave({
      kind: "cron",
      at: at.trim(),
      days: days.size === 7 ? "*" : [...days].sort((a, b) => a - b),
    });
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") onCancel();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label="Timer">
  <form class="modal-card card" onsubmit={submit}>
    <h3>{timer ? "Edit timer" : "New timer"}</h3>
    <OptionTabs
      bind:value={kind}
      label="Timer type"
      tabs={TIMER_TABS}
      collapsible={false}
    >
      {#snippet children(id)}
        {#if id === "every"}
          <label class="field">
            <span class="label-mono">Every</span>
            <input
              class="mono"
              bind:value={every}
              placeholder="30s / 5m / 1h"
            />
          </label>
        {:else if id === "astro"}
          <div class="row">
            <label class="field grow">
              <span class="label-mono">Astro time</span>
              <select bind:value={astroEvent}>
                {#each ASTRO_EVENTS as event (event)}
                  <option value={event}>{event}</option>
                {/each}
              </select>
            </label>
            <label class="field small">
              <span class="label-mono">Offset (min)</span>
              <input class="num-input" type="number" bind:value={offset} />
            </label>
          </div>
          <p class="hint text-muted">
            Local astro time from the system latitude/longitude; the offset may
            be negative.
          </p>
        {:else}
          <div class="row">
            <label class="field grow">
              <span class="label-mono">Time (HH:MM[:SS])</span>
              <input
                class="mono"
                bind:value={at}
                placeholder="07:30 / *:30 / 07:*:15"
              />
            </label>
            <span class="hint text-muted">* = every</span>
          </div>
          <div class="field">
            <span class="label-mono">Days</span>
            <div class="days">
              {#each DAY_NAMES as label, day (label)}
                <label class="check">
                  <input
                    type="checkbox"
                    checked={days.has(day)}
                    onchange={() => toggleDay(day)}
                  />
                  <span>{label}</span>
                </label>
              {/each}
            </div>
          </div>
        {/if}
      {/snippet}
    </OptionTabs>

    {#if !canSave}
      <p class="text-danger error">
        {kind === "every"
          ? "Use a duration like 30s, 5m or 1h."
          : kind === "cron"
            ? "Use HH:MM or HH:MM:SS; * is allowed per part, but not all."
            : ""}
      </p>
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={onCancel}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
        Cancel
      </button>
      <button type="submit" class="btn btn-primary" disabled={!canSave}>
        <span class="material-symbols-outlined" aria-hidden="true">check</span>
        {timer ? "Apply" : "Add"}
      </button>
    </div>
  </form>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }

  .modal-card {
    width: min(480px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field.grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .field.small {
    flex: 0 0 6rem;
  }

  .num-input {
    width: 5rem;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .days {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .error {
    margin: 0;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }
</style>
