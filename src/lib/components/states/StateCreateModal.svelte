<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { stateRoles } from "$lib/config/state-settings";
  import RoleSelect from "$lib/components/common/RoleSelect.svelte";

  const TYPES = [
    "boolean",
    "number",
    "string",
    "mixed",
    "object",
    "array",
    "json",
  ];

  let {
    oncreated,
    onclose,
  }: {
    oncreated: (id: string) => void;
    onclose: () => void;
  } = $props();

  let id = $state("0_userdata.0.");
  let name = $state("");
  let type = $state("number");
  let role = $state("value");
  let unit = $state("");
  let read = $state(true);
  let write = $state(true);
  let busy = $state(false);
  let error = $state("");

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const roles = $derived(stateRoles(objects, role));

  function idChanged(value: string): void {
    id = value;
    if (!name.trim()) {
      const last = value.split(".").filter(Boolean).at(-1) ?? "";
      if (last && last !== "0") name = last;
    }
  }

  async function create(): Promise<void> {
    const stateId = id.trim();
    if (!stateId) {
      error = "Enter a state id.";
      return;
    }
    if (!name.trim()) {
      error = "Enter a state name.";
      return;
    }
    busy = true;
    error = "";
    try {
      const reply = (await ioBroker.sendTo(ioBroker.namespace, "states", {
        action: "create",
        id: stateId,
        common: {
          name: name.trim(),
          type,
          role,
          unit,
          read,
          write,
        },
      })) as { ok?: boolean; error?: string } | undefined;
      if (!reply?.ok) {
        throw new Error(reply?.error ?? "The adapter rejected the state.");
      }
      oncreated(stateId);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && !busy) onclose();
  }}
/>

<div class="modal" role="dialog" aria-modal="true" aria-label="New state">
  <div class="modal-card card">
    <h3>New state</h3>
    <p class="hint text-muted">
      Create a normal state object. Namespaces such as
      <span class="mono">0_userdata.0</span> are the usual home for user states.
    </p>

    <label class="field">
      <span class="label-mono">State id</span>
      <input
        class="mono"
        bind:value={id}
        oninput={(event) => idChanged(event.currentTarget.value)}
        placeholder="0_userdata.0.myState"
        autocomplete="off"
      />
    </label>

    <div class="grid">
      <label class="field">
        <span class="label-mono">Name</span>
        <input bind:value={name} placeholder="My state" />
      </label>
      <label class="field">
        <span class="label-mono">Type</span>
        <select bind:value={type}>
          {#each TYPES as entry (entry)}
            <option value={entry}>{entry}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label-mono">Role</span>
        <RoleSelect
          value={role}
          options={roles}
          {type}
          label="Role"
          onchange={(next) => (role = next)}
        />
      </label>
      <label class="field">
        <span class="label-mono">Unit</span>
        <input bind:value={unit} />
      </label>
    </div>

    <div class="checks">
      <label class="check">
        <input type="checkbox" bind:checked={read} />
        <span>Read</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={write} />
        <span>Write</span>
      </label>
    </div>

    {#if error}<p class="hint text-danger">{error}</p>{/if}

    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button
        type="button"
        class="btn btn-primary"
        disabled={busy}
        onclick={() => void create()}>{busy ? "Creating…" : "Create"}</button
      >
    </div>
  </div>
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
    width: min(560px, 100%);
    max-height: 90vh;
    overflow: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .checks {
    display: flex;
    gap: 1rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  @media (max-width: 520px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
