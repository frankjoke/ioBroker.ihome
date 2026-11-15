<script lang="ts">
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import IconImporter from "$lib/components/icons/IconImporter.svelte";
  import {
    roleChoicesFromObjects,
    type IconPair,
    type IconPool,
  } from "$lib/config/icon-library";
  import { glyphForRole, presetGlyph } from "$lib/config/icon-ops";
  import { PRESETS } from "$lib/config/presets";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import type { DeviceType } from "$lib/types/device";

  /** The role/template defaults: a small map, edited through the same draft the
   *  library uses. Value pairs, never references. */
  let {
    draft,
    writable,
    dirty,
    saving,
    onSet,
    onSave,
  }: {
    draft: IconPool;
    writable: boolean;
    dirty: boolean;
    saving: boolean;
    onSet: (
      kind: "roles" | "templates",
      key: string,
      pair: IconPair | null,
    ) => void;
    onSave: () => void;
  } = $props();

  type Target = { kind: "roles" | "templates"; key: string; name: string };

  let search = $state("");
  let target = $state<Target | null>(null);

  const roleRows = $derived.by(() => {
    const objects =
      (ioBroker.objects as Iterable<[string, unknown]> | undefined) ?? [];
    const query = search.trim().toLowerCase();
    return roleChoicesFromObjects(objects).filter(
      (row) => !query || row.value.toLowerCase().includes(query),
    );
  });

  const templateRows = $derived.by(() => {
    const seen: string[] = [];
    const rows: { id: string; name: string; fallback?: string }[] = [];
    for (const template of getTemplateRegistry().templates ?? []) {
      if (seen.includes(template.id)) continue;
      seen.push(template.id);
      rows.push({
        id: template.id,
        name: template.name,
        fallback: presetGlyph(template.type),
      });
    }
    for (const type of Object.keys(PRESETS) as DeviceType[]) {
      const preset = PRESETS[type];
      if (seen.includes(preset.id)) continue;
      seen.push(preset.id);
      rows.push({
        id: preset.id,
        name: `${preset.name} (preset)`,
        fallback: presetGlyph(type),
      });
    }
    const query = search.trim().toLowerCase();
    return rows.filter(
      (row) => !query || row.name.toLowerCase().includes(query),
    );
  });

  const roleCount = (label: string): string =>
    label.split("·")[1]?.trim() ?? "";

  function effective(
    kind: "roles" | "templates",
    key: string,
    fallback?: string,
  ): { value?: string; active?: string; own: boolean } {
    const pair = draft.defaults[kind][key];
    if (pair) {
      return { value: pair.value, active: pair.activeValue, own: true };
    }
    return { value: fallback, own: false };
  }

  function setFromImporter(
    value: string,
    meta: { activeValue?: string; keywords: string[]; name: string },
  ): void {
    if (!target) return;
    onSet(
      target.kind,
      target.key,
      meta.activeValue ? { value, activeValue: meta.activeValue } : { value },
    );
    target = null;
  }
</script>

<div class="defaults-page">
  <div class="item">
    <div class="item-line title-line">
      <Icon value="tune" size={18} />
      <span class="name">Default icons</span>
      <span class="badge"
        >{Object.keys(draft.defaults.roles).length} roles ·
        {Object.keys(draft.defaults.templates).length} templates</span
      >
      <span class="item-actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          disabled={!dirty || !writable || saving}
          onclick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </span>
    </div>
  </div>

  <div class="list-filter">
    <span class="label-mono filter-label">Filters</span>
    <input
      type="search"
      placeholder="Search roles or templates…"
      bind:value={search}
    />
  </div>

  <p class="label-mono group-title">Roles</p>
  {#if roleRows.length === 0}
    <p class="hint text-muted">No roles match the search.</p>
  {:else}
    <div class="list">
      {#each roleRows as row (row.value)}
        {@const icon = effective("roles", row.value, glyphForRole(row.value))}
        <div class="item">
          <div class="item-line">
            {#if icon.value}
              <Icon value={icon.value} size={18} />
            {:else}
              <span class="material-symbols-outlined muted">help</span>
            {/if}
            <span class="name role-name">{row.value}</span>
            {#if roleCount(row.label)}
              <span class="badge">{roleCount(row.label)}</span>
            {/if}
            {#if icon.active && icon.active !== icon.value}
              <Icon value={icon.active} size={16} />
            {/if}
            {#if !icon.own && icon.value}
              <span class="badge">code default</span>
            {/if}
            <span class="item-actions">
              {#if icon.own}
                <IconButton
                  icon="restart_alt"
                  label={`Reset the default of ${row.value}`}
                  disabled={!writable}
                  onclick={() => onSet("roles", row.value, null)}
                />
              {/if}
              <IconButton
                icon="edit"
                label={`Change the default icon of ${row.value}`}
                disabled={!writable}
                onclick={() =>
                  (target = {
                    kind: "roles",
                    key: row.value,
                    name: row.value,
                  })}
              />
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <p class="label-mono group-title">Templates</p>
  {#if templateRows.length === 0}
    <p class="hint text-muted">No templates match the search.</p>
  {:else}
    <div class="list">
      {#each templateRows as row (row.id)}
        {@const icon = effective("templates", row.id, row.fallback)}
        <div class="item">
          <div class="item-line">
            {#if icon.value}
              <Icon value={icon.value} size={18} />
            {:else}
              <span class="material-symbols-outlined muted">help</span>
            {/if}
            <span class="name">{row.name}</span>
            {#if icon.active && icon.active !== icon.value}
              <Icon value={icon.active} size={16} />
            {/if}
            {#if !icon.own && icon.value}
              <span class="badge">code default</span>
            {/if}
            <span class="item-actions">
              {#if icon.own}
                <IconButton
                  icon="restart_alt"
                  label={`Reset the default of ${row.name}`}
                  disabled={!writable}
                  onclick={() => onSet("templates", row.id, null)}
                />
              {/if}
              <IconButton
                icon="edit"
                label={`Change the default icon of ${row.name}`}
                disabled={!writable}
                onclick={() =>
                  (target = {
                    kind: "templates",
                    key: row.id,
                    name: row.name,
                  })}
              />
            </span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if target}
  <IconImporter onPick={setFromImporter} onClose={() => (target = null)} />
{/if}

<style>
  .defaults-page {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .title-line {
    cursor: default;
  }

  .group-title {
    margin: 0.5rem 0 0.1rem;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .list-filter {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .list-filter input {
    padding: 0.35rem;
  }

  .role-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .muted {
    color: var(--text-muted);
    font-size: 18px;
  }
</style>
