<script lang="ts">
  import type { SettingsField } from "$adapter/settings-schema";
  import {
    structuredValue,
    valueProblem,
    visibleFields,
    type ArrayHooks,
  } from "$lib/config/schema-values";
  import SchemaFields from "./SchemaFields.svelte";
  import SchemaRows from "./SchemaRows.svelte";

  let {
    schema,
    value,
    onchange,
    hooks,
  }: {
    schema: SettingsField[];
    value: Record<string, unknown>;
    onchange: (name: string, next: unknown) => void;
    hooks?: Record<string, ArrayHooks>;
  } = $props();

  const shown = $derived(visibleFields(schema, value));

  function set(name: string, next: unknown): void {
    onchange(name, next);
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  function selectOptions(field: SettingsField): string[] {
    const current = value[field.name];
    const options = [...(field.options ?? [])];
    if (typeof current === "string" && current && !options.includes(current)) {
      options.unshift(current);
    }
    return options;
  }

  function jsonValue(field: SettingsField): string {
    const current = value[field.name];
    return typeof current === "string"
      ? current
      : JSON.stringify(current ?? "", null, 2);
  }

  function fieldProblem(field: SettingsField): string | null {
    return valueProblem(field, value[field.name]);
  }

  function asArray(field: SettingsField): unknown {
    const parsed = structuredValue(field, value[field.name]);
    return "value" in parsed ? parsed.value : value[field.name];
  }

  function objectValue(field: SettingsField): Record<string, unknown> {
    const parsed = structuredValue(field, value[field.name]);
    return "value" in parsed ? asRecord(parsed.value) : {};
  }
</script>

<div class="schema-fields">
  {#each shown as field (field.name)}
    {@const problem = fieldProblem(field)}
    <div
      class="field"
      class:wide={field.type === "object" || field.type === "array"}
    >
      <span class="label-mono">{field.label}</span>
      {#if field.type === "boolean"}
        <label class="check">
          <input
            type="checkbox"
            checked={value[field.name] === undefined
              ? field.default === true
              : value[field.name] === true}
            disabled={field.readonly}
            onchange={(event) => set(field.name, event.currentTarget.checked)}
          />
          <span
            >{value[field.name] === undefined
              ? field.default === true
                ? "on"
                : "off"
              : value[field.name] === true
                ? "on"
                : "off"}</span
          >
        </label>
      {:else if field.type === "select"}
        <select
          value={String(value[field.name] ?? "")}
          disabled={field.readonly}
          onchange={(event) => set(field.name, event.currentTarget.value)}
        >
          {#if field.placeholder}
            <option value="">{field.placeholder}</option>
          {/if}
          {#each selectOptions(field) as option (option)}
            <option value={option}>{option}</option>
          {/each}
        </select>
      {:else if field.type === "number"}
        <input
          type="number"
          value={typeof value[field.name] === "number" ? value[field.name] : ""}
          disabled={field.readonly}
          oninput={(event) =>
            set(
              field.name,
              event.currentTarget.value === ""
                ? undefined
                : Number(event.currentTarget.value),
            )}
        />
      {:else if field.type === "json"}
        <textarea
          class="json"
          rows="5"
          spellcheck="false"
          value={jsonValue(field)}
          oninput={(event) => set(field.name, event.currentTarget.value)}
        ></textarea>
      {:else if field.type === "object"}
        <div class="section-panel nested">
          <SchemaFields
            schema={field.fields ?? []}
            value={objectValue(field)}
            onchange={(name, next) =>
              set(field.name, { ...objectValue(field), [name]: next })}
            {hooks}
          />
        </div>
      {:else if field.type === "array"}
        <SchemaRows
          {field}
          rows={asArray(field)}
          onchange={(next) => set(field.name, next)}
          hooks={hooks?.[field.name]}
        />
      {:else}
        <input
          type="text"
          value={String(value[field.name] ?? "")}
          placeholder={field.placeholder}
          disabled={field.readonly}
          oninput={(event) => set(field.name, event.currentTarget.value)}
        />
      {/if}
      {#if field.description}
        <span class="hint text-muted">{field.description}</span>
      {/if}
      {#if problem}
        <span class="hint text-danger">{problem}</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .schema-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .wide {
    grid-column: 1 / -1;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    font-size: var(--label-mono-size);
    cursor: pointer;
  }
  .nested {
    padding: 0.5rem;
  }
  .json {
    width: 100%;
    font-family: var(--font-code);
    font-size: var(--body-sm);
    resize: vertical;
  }
  .text-danger {
    color: var(--danger-color);
  }
</style>
