<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    customJsonProblem,
    parseCustomJson,
  } from "$lib/config/state-settings";

  let {
    stateId,
    object,
    onchanged,
  }: {
    stateId: string;
    object: any;
    onchanged: (custom: Record<string, unknown>) => void;
  } = $props();

  let custom = $state<Record<string, unknown>>(
    untrack(() => ({
      ...((object?.common?.custom ?? {}) as Record<string, unknown>),
    })),
  );
  let key = $state(untrack(() => Object.keys(custom)[0] ?? ""));
  let text = $state(
    untrack(() => JSON.stringify(key ? (custom[key] ?? {}) : {}, null, 2)),
  );
  let newKey = $state("");
  let error = $state("");
  let message = $state("");
  let busy = $state(false);

  const keys = $derived(Object.keys(custom).sort());

  function loadKey(value: string): void {
    key = value;
    text = JSON.stringify(value ? (custom[value] ?? {}) : {}, null, 2);
    error = "";
    message = "";
  }

  async function write(next: Record<string, unknown>): Promise<boolean> {
    busy = true;
    error = "";
    message = "";
    try {
      const reply = (await ioBroker.sendTo(ioBroker.namespace, "states", {
        action: "custom.write",
        id: stateId,
        custom: next,
      })) as { ok?: boolean; error?: string } | undefined;
      if (!reply?.ok)
        throw new Error(reply?.error ?? "The adapter rejected the change.");
      custom = next;
      onchanged(next);
      message = "Saved.";
      return true;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      return false;
    } finally {
      busy = false;
    }
  }

  async function save(): Promise<void> {
    if (!key) return;
    const problem = customJsonProblem(text);
    if (problem) {
      error = problem;
      return;
    }
    const parsed = parseCustomJson(text);
    if (!parsed) {
      error = "Custom settings must be a JSON object.";
      return;
    }
    await write({ ...custom, [key]: parsed });
  }

  async function remove(): Promise<void> {
    if (!key) return;
    const next = { ...custom };
    delete next[key];
    if (await write(next)) loadKey(Object.keys(next).sort()[0] ?? "");
  }

  async function add(): Promise<void> {
    const value = newKey.trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
      error = "Use a key such as history.0 or influxdb.0.";
      return;
    }
    if (value in custom) {
      error = "That key already exists.";
      return;
    }
    const next = { ...custom, [value]: {} };
    if (await write(next)) {
      newKey = "";
      loadKey(value);
    }
  }
</script>

<div class="custom-settings">
  <p class="hint text-muted">
    One JSON object per adapter, keyed like <span class="mono">history.0</span>
    or <span class="mono">influxdb.0</span>. The adapter applies the changed
    object itself; other keys are kept.
  </p>

  <div class="row add">
    <input
      class="mono"
      bind:value={newKey}
      placeholder="adapter.instance"
      aria-label="New custom key"
    />
    <button type="button" class="btn btn-sm" disabled={busy} onclick={add}
      >Add key</button
    >
  </div>

  {#if keys.length === 0}
    <p class="hint text-muted">No custom settings on this state.</p>
  {:else}
    <div class="keys">
      {#each keys as name (name)}
        <button
          type="button"
          class="key"
          class:active={name === key}
          onclick={() => loadKey(name)}
        >
          <span class="mono">{name}</span>
        </button>
      {/each}
    </div>

    <label class="field">
      <span class="label-mono">{key}</span>
      <textarea
        class="json"
        rows="12"
        spellcheck="false"
        bind:value={text}
        aria-label={`Custom settings for ${key}`}
      ></textarea>
    </label>

    <div class="actions">
      <button type="button" class="btn btn-sm" disabled={busy} onclick={remove}
        >Remove key</button
      >
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={busy}
        onclick={save}>Save</button
      >
    </div>
  {/if}

  {#if error}<p class="hint text-danger">{error}</p>{/if}
  {#if message}<p class="hint text-muted">{message}</p>{/if}
</div>

<style>
  .custom-settings {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .add input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .key {
    padding: 0.2rem 0.45rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--surface-color);
    color: var(--text-color);
    font: inherit;
    cursor: pointer;
  }

  .key.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .json {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-code);
    font-size: var(--body-sm);
    resize: vertical;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }
</style>
