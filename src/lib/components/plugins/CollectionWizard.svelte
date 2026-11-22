<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getLogicDocument, initLogics } from "$lib/stores/logics.svelte";
  import {
    getTemplateRegistry,
    initTemplates,
  } from "$lib/stores/templates.svelte";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { resolveVariable } from "$lib/config/variables";
  import { readMetaText } from "$lib/config/meta-files";
  import { unwrapPluginReply } from "$lib/config/plugin-call";
  import { installPlugin, applyCollection } from "$lib/stores/plugins.svelte";
  import CollectionConflicts from "./CollectionConflicts.svelte";
  import { validPluginId } from "$adapter/plugin-ops";
  import {
    collectionTileDefinition,
    suggestCollectionStates,
  } from "$lib/config/collection-capture";
  import type { PluginView } from "$adapter/plugin-admin";
  import type { CollectionConflict } from "$adapter/plugin-collection-types";
  import type { Template } from "$lib/types/display";
  import type { LogicDef } from "$logic/types";

  let {
    plugin = undefined,
    onClose,
    onSaved,
  }: {
    plugin?: PluginView;
    onClose: () => void;
    onSaved: () => void;
  } = $props();

  const META = "ihome.meta";
  const logics = $derived(getLogicDocument().logics ?? []);
  const templates = $derived(
    getTemplateRegistry().templates.filter((tile) => !tile.builtin),
  );
  const variables = getVariables();
  const resolveName = (name: string): string | undefined => {
    const target = resolveVariable(name, variables);
    return target?.kind === "state" ? target.stateId : undefined;
  };

  let step = $state(0);
  let id = $state(untrack(() => plugin?.id ?? ""));
  let name = $state(untrack(() => plugin?.name ?? ""));
  let version = $state(untrack(() => nextVersion(plugin?.version)));
  let logicIds = $state<string[]>([]);
  let stateIds = $state<string[]>([]);
  let tileIds = $state<string[]>([]);
  let existingTiles = $state<Template[]>([]);
  let extraState = $state("");
  let error = $state("");
  let busy = $state(false);
  let conflicts = $state<CollectionConflict[]>([]);

  const selectedLogics = $derived(
    logics.filter((logic) => logicIds.includes(logic.id)),
  );
  const suggestions = $derived(
    suggestCollectionStates(selectedLogics, resolveName),
  );
  const tileChoices = $derived([
    ...templates,
    ...existingTiles.filter(
      (tile) => !templates.some((entry) => entry.id === tile.id),
    ),
  ]);
  const uses = $derived(
    suggestions
      .filter((row) => !stateIds.includes(row.id))
      .map((row) => row.id),
  );
  const steps = ["Basics", "Logic", "States", "Tiles", "Review"];

  function nextVersion(value: string | undefined): string {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? "");
    if (!match) return "1.0.0";
    return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }

  function ownerOf(logic: LogicDef): string {
    return logic.managed?.plugin ?? "";
  }

  function toggleLogic(logic: LogicDef): void {
    if (ownerOf(logic) && ownerOf(logic) !== id) return;
    logicIds = logicIds.includes(logic.id)
      ? logicIds.filter((entry) => entry !== logic.id)
      : [...logicIds, logic.id];
    const next = suggestCollectionStates(
      logics.filter((entry) => logicIds.includes(entry.id)),
      resolveName,
    );
    const owned = next.filter((row) => row.ownedByDefault).map((row) => row.id);
    stateIds = [
      ...new Set([
        ...stateIds.filter((sid) => next.some((row) => row.id === sid)),
        ...owned,
      ]),
    ];
  }

  function toggleState(stateId: string): void {
    stateIds = stateIds.includes(stateId)
      ? stateIds.filter((entry) => entry !== stateId)
      : [...stateIds, stateId];
  }

  function toggleTile(tileId: string): void {
    tileIds = tileIds.includes(tileId)
      ? tileIds.filter((entry) => entry !== tileId)
      : [...tileIds, tileId];
  }

  function addState(): void {
    const value = extraState.trim();
    if (!value || !value.includes(".") || value.includes(" ")) {
      error = "Enter a full state id, for example 0_userdata.0.pv.total.";
      return;
    }
    if (!stateIds.includes(value)) stateIds = [...stateIds, value];
    extraState = "";
    error = "";
  }

  function objectName(stateId: string): string {
    const entry = ioBroker.objects?.get(stateId) as
      { common?: { name?: unknown } } | undefined;
    const label = entry?.common?.name;
    return typeof label === "string" && label ? ` · ${label}` : "";
  }

  function validate(): string {
    if (!validPluginId(id))
      return "Use a-z, 0-9, dot, dash or underscore for the id.";
    if (!name.trim()) return "The plugin needs a name.";
    if (!/^[0-9A-Za-z._-]{1,32}$/.test(version.trim())) {
      return "The version must be 1 to 32 characters.";
    }
    if (logicIds.length === 0) return "Select at least one logic or action.";
    return "";
  }

  function stepValid(next: number): boolean {
    if (next === 0) {
      error = "";
      const problem = validate();
      if (problem) {
        error = problem;
        return false;
      }
    }
    if (next === 1 && logicIds.length === 0) {
      error = "Select at least one logic or action.";
      return false;
    }
    return true;
  }

  function go(next: number): void {
    if (next > step && !stepValid(step)) return;
    error = "";
    step = Math.max(0, Math.min(steps.length - 1, next));
  }

  async function save(): Promise<void> {
    if (busy) return;
    const problem = validate();
    if (problem) {
      error = problem;
      step = 0;
      return;
    }
    busy = true;
    error = "";
    try {
      const chosen = tileIds
        .map(
          (tileId) =>
            templates.find((tile) => tile.id === tileId) ??
            existingTiles.find((tile) => tile.id === tileId),
        )
        .filter((tile): tile is Template => !!tile)
        .map((tile) => collectionTileDefinition(tile));
      const reply = await ioBroker.sendTo(ioBroker.namespace, "plugins", {
        action: "collection.capture",
        request: {
          id,
          name: name.trim(),
          version: version.trim(),
          logicIds,
          stateIds,
          tiles: chosen,
        },
      });
      unwrapPluginReply(reply);
      const applied = await installPlugin(id);
      if (applied.length > 0) {
        conflicts = applied;
        return;
      }
      onSaved();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    void initLogics().catch(() => {});
    void initTemplates().catch(() => {});
    if (!plugin) return;
    void (async () => {
      const text = await readMetaText(META, `plugins/${plugin.id}/plugin.json`);
      if (!text) return;
      try {
        const raw = JSON.parse(text) as {
          collection?: { states?: { id: string }[]; logics?: { id: string }[] };
          contributions?: { tiles?: Template[] };
        };
        logicIds = raw.collection?.logics?.map((entry) => entry.id) ?? [];
        stateIds = raw.collection?.states?.map((entry) => entry.id) ?? [];
        existingTiles = raw.contributions?.tiles ?? [];
        tileIds = existingTiles.map((tile) => tile.id);
      } catch {
        error =
          "The plugin manifest is unreadable; start from a fresh selection.";
      }
    })();
  });
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Create plugin">
  <div class="modal-card card">
    <div class="head">
      <div>
        <h3>{plugin ? "Save a new version" : "Create plugin"}</h3>
        <p class="hint text-muted">
          Step {step + 1} of {steps.length}: {steps[step]}
        </p>
      </div>
      <button
        type="button"
        class="btn btn-sm"
        disabled={busy}
        onclick={onClose}
      >
        Close
      </button>
    </div>

    {#if step === 0}
      <label class="field">
        <span class="label-mono">Plugin id</span>
        <input
          class="mono"
          bind:value={id}
          readonly={!!plugin}
          placeholder="pv.forecast"
        />
      </label>
      <label class="field">
        <span class="label-mono">Name</span>
        <input bind:value={name} placeholder="PV forecast" />
      </label>
      <label class="field">
        <span class="label-mono">Version</span>
        <input class="mono" bind:value={version} />
      </label>
      <p class="hint text-muted">
        Saving captures the selected logic, states and tile into the plugin
        folder. The next install creates them on another instance.
      </p>
    {:else if step === 1}
      {#if logics.length === 0}
        <p class="hint text-muted">There is no logic or action to select.</p>
      {:else}
        <div class="picks">
          {#each logics as logic (logic.id)}
            {@const owner = ownerOf(logic)}
            <label class="pick" class:disabled={!!owner && owner !== id}>
              <input
                type="checkbox"
                checked={logicIds.includes(logic.id)}
                disabled={!!owner && owner !== id}
                onchange={() => toggleLogic(logic)}
              />
              <span class="pick-body">
                <span class="pick-name">{logic.name}</span>
                <span class="mono text-muted">{logic.id}</span>
                {#if owner}
                  <span class="badge">
                    {owner === id ? "this plugin" : `owned by ${owner}`}
                  </span>
                {/if}
              </span>
            </label>
          {/each}
        </div>
      {/if}
    {:else if step === 2}
      <p class="hint text-muted">
        The logic output is selected by default. Untick a state to keep it as an
        external use instead of owning it.
      </p>
      {#if suggestions.length === 0}
        <p class="hint text-muted">The selected logic names no state.</p>
      {:else}
        <div class="picks">
          {#each suggestions as row (row.id)}
            <label class="pick">
              <input
                type="checkbox"
                checked={stateIds.includes(row.id)}
                onchange={() => toggleState(row.id)}
              />
              <span class="pick-body">
                <span class="mono">{row.id}</span>
                <span class="text-muted">
                  {row.usedBy.join(", ")}{objectName(row.id)}
                  {#if row.ownedByDefault}
                    · output{/if}
                </span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
      <div class="add-row">
        <input
          class="mono"
          bind:value={extraState}
          placeholder="0_userdata.0.extra.state"
          onkeydown={(event) => {
            if (event.key === "Enter") addState();
          }}
        />
        <button type="button" class="btn btn-sm" onclick={addState}
          >Add state</button
        >
      </div>
      {#if uses.length}
        <p class="hint text-muted">
          Used but not owned: {uses.join(", ")}
        </p>
      {/if}
    {:else if step === 3}
      {#if tileChoices.length === 0}
        <p class="hint text-muted">There is no user tile template to select.</p>
      {:else}
        <div class="picks">
          {#each tileChoices as tile (tile.id)}
            <label class="pick">
              <input
                type="checkbox"
                checked={tileIds.includes(tile.id)}
                onchange={() => toggleTile(tile.id)}
              />
              <span class="pick-body">
                <span class="pick-name">{tile.name}</span>
                <span class="mono text-muted">{tile.id}</span>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    {:else}
      <div class="review">
        <p><strong>{name}</strong> <span class="mono text-muted">{id}</span></p>
        <p class="hint text-muted">Version {version}</p>
        <p>
          {logicIds.length} logic · {stateIds.length} states · {tileIds.length} tiles
        </p>
        {#if stateIds.length}
          <p class="hint text-muted mono">{stateIds.join(", ")}</p>
        {/if}
        {#if uses.length}
          <p class="hint text-muted">Uses: {uses.join(", ")}</p>
        {/if}
        <p class="warning-banner">
          Saving claims the selected items for this plugin. Logic runs while the
          plugin is enabled.
        </p>
      </div>
    {/if}

    {#if error}
      <p class="text-danger hint">{error}</p>
    {/if}

    <div class="actions">
      <button
        type="button"
        class="btn"
        disabled={busy || step === 0}
        onclick={() => go(step - 1)}
      >
        Back
      </button>
      {#if step < steps.length - 1}
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onclick={() => go(step + 1)}
        >
          Next
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onclick={save}
        >
          Save plugin
        </button>
      {/if}
    </div>
  </div>
</div>

{#if conflicts.length}
  <CollectionConflicts
    {conflicts}
    onCancel={() => (conflicts = [])}
    onOverwrite={() => {
      conflicts = [];
      void applyCollection(id, true)
        .then(() => onSaved())
        .catch((failure) => {
          error = failure instanceof Error ? failure.message : String(failure);
        });
    }}
  />
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.5);
  }

  .modal-card {
    width: min(38rem, 100%);
    max-height: 90vh;
    overflow-y: auto;
    padding: 1rem;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .head h3 {
    margin: 0;
  }

  .picks {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 22rem;
    overflow-y: auto;
  }

  .pick {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    background: var(--surface-color);
  }

  .pick.disabled {
    opacity: 0.6;
  }

  .pick-body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .pick-name {
    font-weight: 600;
  }

  .badge {
    align-self: flex-start;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    padding: 0 0.4rem;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .add-row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .add-row input {
    flex: 1 1 auto;
  }

  .review p {
    margin: 0.25rem 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1rem;
  }
</style>
