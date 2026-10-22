<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { newId } from "$lib/utils/ids";
  import { getStorage } from "$lib/tools.svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import PinModal from "$lib/components/common/PinModal.svelte";
  import { effectivePin, isUnlocked, unlock } from "$lib/config/pin.svelte";
  import {
    getFormulas,
    upsertFormula,
    deleteFormula,
  } from "$lib/stores/formulas.svelte";
  import { saveFormulas } from "$lib/formulas.svelte.js";
  import type { FormulaTemplate } from "$lib/types/device";
  import ioPackage from "../../../io-package.json";

  const storage = getStorage();
  const isConnected = $derived(!!ioBroker.connected);

  /**
   * The broker the live socket is actually on. The fields above may hold an
   * edit that has not been applied yet, so they must not be shown as "in use".
   */
  function activeBrokerUrl(): string {
    return ioBroker.connectOptions?.url ?? "";
  }

  function applyAndReload() {
    location.reload();
  }

  let editing = $state<FormulaTemplate | null>(null);
  let showForm = $state(false);
  let pendingDelete = $state<FormulaTemplate | null>(null);

  const formulas = $derived(getFormulas());

  function startAdd() {
    editing = { id: newId(), name: "", expr: "" };
    showForm = true;
  }
  function startEdit(t: FormulaTemplate) {
    editing = { ...t };
    showForm = true;
  }
  function save() {
    if (!editing) return;
    upsertFormula({ ...editing, name: editing.name.trim() || "Untitled" });
    saveFormulas();
    showForm = false;
    editing = null;
  }
  function confirmDelete() {
    if (pendingDelete) {
      deleteFormula(pendingDelete.id);
      saveFormulas();
    }
    pendingDelete = null;
  }
</script>

<svelte:head>
  <title>Settings - iHome</title>
</svelte:head>

{#if isUnlocked()}
  <div class="settings-page">
    <div class="page-header">
      <span class="label-mono">Configuration</span>
      <h1>Settings</h1>
    </div>

    <section class="card settings-card">
      <div class="card-header">
        <span class="material-symbols-outlined">lan</span>
        <h2 class="card-title">Connection</h2>
      </div>
      <div class="card-body settings-card-body">
        <div class="field">
          <label class="label-mono" for="settings-host">Host:Port</label>
          <input
            id="settings-host"
            type="text"
            bind:value={storage.hostPort}
            placeholder="e.g. 192.168.1.10:8081"
          />
          <span class="hint text-muted"
            >Leave empty to use the configured broker fallback, or the host
            serving this page when no fallback is set (socket.io on port 8081).
            Editing this while connected is fine — saving reconnects.</span
          >
        </div>
        <div class="field">
          <label class="label-mono" for="settings-ns">Namespace</label>
          <input id="settings-ns" type="text" bind:value={storage.namespace} />
          <span class="hint text-muted"
            >Identity stamped as "from" on every write, e.g. ihome.0 — the
            adapter's io-package name plus instance.</span
          >
        </div>

        {#if isConnected}
          <p class="conn-note">
            <span class="badge badge-success">connected</span>
            <span class="text-muted"
              >{ioBroker.namespace} via {activeBrokerUrl()}</span
            >
          </p>
        {/if}
        <button class="btn btn-primary" onclick={applyAndReload}>
          {isConnected ? "Save & reconnect" : "Apply & reload"}
        </button>
      </div>
    </section>

    <section class="card settings-card">
      <div class="card-header">
        <span class="material-symbols-outlined">palette</span>
        <h2 class="card-title">Appearance</h2>
      </div>
      <div class="card-body settings-card-body">
        <p class="text-muted hint">
          Theme follows the system setting by default. Choose Light or Dark to
          override it — your choice is remembered on this device.
        </p>
        <ThemeToggle />
      </div>
    </section>

    <section class="card settings-card">
      <div class="card-header">
        <span class="material-symbols-outlined">functions</span>
        <h2 class="card-title">Formula templates</h2>
      </div>
      <div class="card-body settings-card-body">
        {#if formulas.length === 0}
          <p class="text-muted hint">No templates yet.</p>
        {/if}
        <ul class="formula-list">
          {#each formulas as t (t.id)}
            <li class="formula-row">
              <div class="formula-main">
                <span class="formula-name">{t.name}</span>
                <code class="formula-expr">{t.expr}</code>
                {#if t.unit}<span class="text-muted">{t.unit}</span>{/if}
              </div>
              <div class="formula-actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="Edit"
                  aria-label="Edit"
                  onclick={() => startEdit(t)}
                >
                  <span class="material-symbols-outlined">edit</span>
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  title="Delete"
                  aria-label="Delete"
                  onclick={() => (pendingDelete = t)}
                >
                  <span class="material-symbols-outlined">delete</span>
                </button>
              </div>
            </li>
          {/each}
        </ul>
        <button type="button" class="btn btn-primary" onclick={startAdd}
          >Add template</button
        >
      </div>
    </section>

    {#if showForm && editing}
      <div
        class="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Formula template"
      >
        <div class="modal-card card">
          <h3>{editing.name ? "Edit template" : "New template"}</h3>
          <label class="field"
            ><span class="label-mono">Name</span>
            <input type="text" bind:value={editing.name} /></label
          >
          <label class="field"
            ><span class="label-mono">Expression</span>
            <textarea rows="3" class="mono" bind:value={editing.expr}
            ></textarea></label
          >
          <div class="form-grid">
            <label class="field"
              ><span class="label-mono">Unit</span>
              <input type="text" bind:value={editing.unit} /></label
            >
            <label class="field"
              ><span class="label-mono">Precision</span>
              <input
                type="number"
                min="0"
                max="10"
                value={editing.precision ?? ""}
                oninput={(e) =>
                  (editing.precision =
                    e.currentTarget.value === ""
                      ? undefined
                      : Number(e.currentTarget.value))}
              /></label
            >
          </div>
          <label class="field"
            ><span class="label-mono">Notes</span>
            <input type="text" bind:value={editing.notes} /></label
          >
          <div class="actions">
            <button
              type="button"
              class="btn"
              onclick={() => {
                showForm = false;
                editing = null;
              }}>Cancel</button
            >
            <button type="button" class="btn btn-primary" onclick={save}
              >Save</button
            >
          </div>
        </div>
      </div>
    {/if}

    {#if pendingDelete}
      <ConfirmModal
        title="Delete template"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => (pendingDelete = null)}
      >
        <p>
          Delete <strong>{pendingDelete.name}</strong>? Devices keep their copy.
        </p>
      </ConfirmModal>
    {/if}

    <section class="card settings-card">
      <div class="card-header">
        <span class="material-symbols-outlined">info</span>
        <h2 class="card-title">About</h2>
      </div>
      <div class="card-body about-body">
        <span class="text-muted"
          >Visual interface for ioBroker smart home control</span
        >
        <span class="about-version mono"
          >{ioPackage.common.titleLang.en} v{ioPackage.common.version}</span
        >
      </div>
    </section>
  </div>
{:else}
  <PinModal
    title="Settings locked"
    hint="Enter your PIN to open the settings."
    expected={effectivePin(storage.pin)}
    onSubmit={unlock}
    onCancel={() => (location.hash = "#/")}
  />
{/if}

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 640px;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-header h1 {
    margin: 0;
  }

  .settings-card .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .settings-card .card-header .material-symbols-outlined {
    font-size: 18px;
    color: var(--text-muted);
  }

  .settings-card-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .field input {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .hint {
    font-size: var(--body-sm);
  }

  .conn-note {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
    font-size: var(--body-sm);
  }

  .about-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: var(--body-md);
  }

  .about-version {
    color: var(--text-muted);
  }

  .formula-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }

  .formula-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }

  .formula-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .formula-name {
    font-weight: 600;
  }

  .formula-expr {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40ch;
  }

  .formula-actions {
    display: flex;
    gap: 0.35rem;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-card {
    width: min(520px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
