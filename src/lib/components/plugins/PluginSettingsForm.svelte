<script lang="ts">
  import type { PluginSettingDef } from "$adapter/plugin-ops";

  let {
    schema,
    values = $bindable(),
    valid = $bindable(true),
  }: {
    schema?: PluginSettingDef[];
    values: Record<string, unknown>;
    valid?: boolean;
  } = $props();

  // The field list is stable for one plugin; the editor keys the form by id.
  let json = $state(JSON.stringify(values, null, 2));
  let jsonError = $state("");
  let jsonFieldErrors = $state<Record<string, string>>({});

  function set(name: string, value: unknown): void {
    values = { ...values, [name]: value };
  }

  function jsonText(def: PluginSettingDef): string {
    const value = values[def.name];
    if (typeof value === "string") return value;
    return JSON.stringify(value ?? def.default ?? [], null, 2);
  }

  function updateJsonField(name: string, text: string): void {
    set(name, text);
    try {
      JSON.parse(text);
      jsonFieldErrors = { ...jsonFieldErrors, [name]: "" };
    } catch (error) {
      jsonFieldErrors = {
        ...jsonFieldErrors,
        [name]: error instanceof Error ? error.message : "Invalid JSON.",
      };
    }
    valid = Object.values(jsonFieldErrors).every((message) => !message);
  }

  function updateJson(text: string): void {
    json = text;
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
</script>

{#if schema?.length}
  <div class="settings-form">
    {#each schema as def (def.name)}
      <label class="field">
        <span class="label-mono">{def.label}</span>
        {#if def.type === "boolean"}
          <input
            type="checkbox"
            checked={values[def.name] === true}
            onchange={(event) => set(def.name, event.currentTarget.checked)}
          />
        {:else if def.type === "select"}
          <select
            value={String(values[def.name] ?? def.default ?? "")}
            onchange={(event) => set(def.name, event.currentTarget.value)}
          >
            {#each def.options ?? [] as option (option)}
              <option value={option}>{option}</option>
            {/each}
          </select>
        {:else if def.type === "json"}
          <textarea
            class="json"
            rows="4"
            value={jsonText(def)}
            oninput={(event) =>
              updateJsonField(def.name, event.currentTarget.value)}
            spellcheck="false"
          ></textarea>
          {#if jsonFieldErrors[def.name]}
            <span class="hint text-danger">{jsonFieldErrors[def.name]}</span>
          {/if}
        {:else if def.type === "number"}
          <input
            type="number"
            value={typeof values[def.name] === "number" ? values[def.name] : ""}
            oninput={(event) =>
              set(
                def.name,
                event.currentTarget.value === ""
                  ? undefined
                  : Number(event.currentTarget.value),
              )}
          />
        {:else}
          <input
            type="text"
            value={String(values[def.name] ?? def.default ?? "")}
            oninput={(event) => set(def.name, event.currentTarget.value)}
          />
        {/if}
        {#if def.description}
          <span class="hint text-muted">{def.description}</span>
        {/if}
      </label>
    {/each}
  </div>
{:else}
  <label class="field">
    <span class="label-mono">Settings (JSON)</span>
    <textarea
      class="json"
      rows="5"
      bind:value={json}
      oninput={(event) => updateJson(event.currentTarget.value)}
      spellcheck="false"
    ></textarea>
    {#if jsonError}
      <span class="hint text-danger">{jsonError}</span>
    {:else}
      <span class="hint text-muted"
        >No schema — edit the JSON object directly.</span
      >
    {/if}
  </label>
{/if}

<style>
  .settings-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.6rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .json {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .text-danger {
    color: var(--danger-color);
  }
</style>
