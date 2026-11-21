<script lang="ts">
  import type { SettingsField } from "$adapter/settings-schema";
  import { objectProblem, type ArrayHooks } from "$lib/config/schema-values";
  import SchemaFields from "./SchemaFields.svelte";

  let {
    schema,
    values = $bindable(),
    valid = $bindable(true),
    hooks,
  }: {
    schema?: SettingsField[];
    values: Record<string, unknown>;
    valid?: boolean;
    hooks?: Record<string, ArrayHooks>;
  } = $props();

  let jsonText = $state(JSON.stringify(values, null, 2));
  let jsonError = $state("");

  function change(name: string, next: unknown): void {
    values = { ...values, [name]: next };
  }

  function updateJson(text: string): void {
    jsonText = text;
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        jsonError = "Settings must be a JSON object.";
        valid = false;
        return;
      }
      jsonError = "";
      valid = true;
      values = parsed as Record<string, unknown>;
    } catch (error) {
      jsonError = error instanceof Error ? error.message : "Invalid JSON.";
      valid = false;
    }
  }

  $effect(() => {
    if (schema?.length) {
      valid = objectProblem({ fields: schema }, values) === null;
    }
  });
</script>

{#if !schema?.length}
  <label class="field">
    <span class="label-mono">Settings (JSON)</span>
    <textarea
      class="json"
      rows="5"
      spellcheck="false"
      value={jsonText}
      oninput={(event) => updateJson(event.currentTarget.value)}
    ></textarea>
    {#if jsonError}
      <span class="hint text-danger">{jsonError}</span>
    {:else}
      <span class="hint text-muted"
        >No schema — edit the JSON object directly.</span
      >
    {/if}
  </label>
{:else}
  <SchemaFields {schema} value={values} onchange={change} {hooks} />
{/if}

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
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
