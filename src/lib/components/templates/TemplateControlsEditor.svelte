<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { featureCatalog, type FeatureDef } from "$lib/config/features";
  import {
    addFeature,
    moveFeature,
    removeFeature,
    setPrimaryFeature,
    updateFeature,
  } from "$lib/config/template-features";
  import type { DeviceType, Widget } from "$lib/types/device";

  let {
    features,
    type,
    disabled = false,
    onchange,
  }: {
    features: FeatureDef[];
    type: DeviceType;
    disabled?: boolean;
    onchange: (features: FeatureDef[]) => void;
  } = $props();

  const widgets: Widget[] = [
    "switch",
    "level",
    "color",
    "value",
    "enum",
    "button",
  ];
  const group = $props.id();
  const catalog = $derived(
    featureCatalog(type).filter(
      (entry) => !features.some((feature) => feature.feature === entry.feature),
    ),
  );
  const primaryAt = $derived(
    Math.max(
      0,
      features.findIndex((feature) => feature.primary === true),
    ),
  );

  function patch(index: number, change: Partial<FeatureDef>): void {
    onchange(updateFeature(features, index, change));
  }

  function add(catalogFeature: FeatureDef): void {
    if (!catalogFeature) return;
    onchange(addFeature(features, catalogFeature));
  }

  function addCustom(): void {
    onchange(
      addFeature(features, {
        feature: "",
        label: "",
        widget: "value",
        roleHints: [],
      }),
    );
  }
</script>

<section class="controls-editor">
  <div class="controls-head">
    <div>
      <span class="label-mono">Controls</span>
      <p class="hint text-muted">
        The features a device from this template can have. The primary feature
        is the state picked first.
      </p>
    </div>
    <div class="controls-add">
      <select
        aria-label="Add a known feature"
        value=""
        {disabled}
        onchange={(event) => {
          const select = event.currentTarget;
          const entry = catalog[Number(select.value)];
          select.selectedIndex = 0;
          if (entry) add(entry);
        }}
      >
        <option value="">Add feature…</option>
        {#each catalog as entry, index (entry.feature)}
          <option value={index}>{entry.label}</option>
        {/each}
      </select>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        {disabled}
        onclick={addCustom}
      >
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
        Custom
      </button>
    </div>
  </div>

  {#if features.length === 0}
    <p class="hint text-muted">
      No controls yet. Add the features this template can create.
    </p>
  {:else}
    <div class="controls-list">
      {#each features as feature, index (index)}
        <div class="control-row">
          <label class="primary" title="The state picked first">
            <input
              type="radio"
              name={group}
              checked={primaryAt === index}
              {disabled}
              onchange={() => onchange(setPrimaryFeature(features, index))}
            />
            <span class="label-mono">Primary</span>
          </label>
          <label class="field">
            <span class="label-mono">Feature</span>
            <input
              value={feature.feature}
              {disabled}
              oninput={(event) =>
                patch(index, { feature: event.currentTarget.value })}
            />
          </label>
          <label class="field">
            <span class="label-mono">Label</span>
            <input
              value={feature.label}
              {disabled}
              oninput={(event) =>
                patch(index, { label: event.currentTarget.value })}
            />
          </label>
          <label class="field">
            <span class="label-mono">Widget</span>
            <select
              value={feature.widget}
              {disabled}
              onchange={(event) =>
                patch(index, {
                  widget: event.currentTarget.value as Widget,
                })}
            >
              {#each widgets as widget (widget)}
                <option value={widget}>{widget}</option>
              {/each}
            </select>
          </label>
          <label class="field wide">
            <span class="label-mono">Role hints</span>
            <input
              value={feature.roleHints.join(", ")}
              placeholder="value.temperature, temperature"
              {disabled}
              onchange={(event) =>
                patch(index, {
                  roleHints: event.currentTarget.value
                    .split(",")
                    .map((hint) => hint.trim())
                    .filter(Boolean),
                })}
            />
          </label>
          <label class="required">
            <input
              type="checkbox"
              checked={feature.required === true}
              {disabled}
              onchange={(event) =>
                patch(index, { required: event.currentTarget.checked })}
            />
            <span class="label-mono">Required</span>
          </label>
          <span class="row-actions">
            <button
              type="button"
              class="btn btn-sm btn-outline"
              title="Move up"
              aria-label={`Move ${feature.label || feature.feature} up`}
              disabled={disabled || index === 0}
              onclick={() => onchange(moveFeature(features, index, index - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline"
              title="Move down"
              aria-label={`Move ${feature.label || feature.feature} down`}
              disabled={disabled || index === features.length - 1}
              onclick={() => onchange(moveFeature(features, index, index + 1))}
            >
              ↓
            </button>
            <IconButton
              icon="delete"
              danger
              label={`Remove ${feature.label || feature.feature || "feature"}`}
              {disabled}
              onclick={() => onchange(removeFeature(features, index))}
            />
          </span>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .controls-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .controls-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .controls-head .hint {
    margin: 0;
    max-width: 32rem;
  }

  .controls-add {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .controls-add .material-symbols-outlined {
    font-size: 16px;
  }

  .controls-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .control-row {
    display: grid;
    grid-template-columns:
      auto minmax(7rem, 1fr) minmax(7rem, 1fr)
      7rem auto auto;
    align-items: end;
    gap: 0.4rem;
    padding: 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 6px);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .field.wide {
    grid-column: 2 / 5;
  }

  .primary,
  .required {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--body-sm);
    white-space: nowrap;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    justify-self: end;
  }

  @media (max-width: 760px) {
    .control-row {
      grid-template-columns: auto 1fr;
    }

    .field,
    .field.wide {
      grid-column: 2;
    }

    .row-actions {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
