<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import type { SettingsField } from "$adapter/settings-schema";
  import {
    itemDefaults,
    objectProblem,
    rowSummary,
    structuredValue,
    type ArrayHooks,
  } from "$lib/config/schema-values";
  import SchemaFields from "./SchemaFields.svelte";

  let {
    field,
    rows,
    onchange,
    hooks,
  }: {
    field: SettingsField;
    rows: unknown;
    onchange: (next: unknown[]) => void;
    hooks?: ArrayHooks;
  } = $props();

  const item = $derived(field.item!);
  const objectItem = $derived(typeof item === "object" ? item : null);
  const itemFields = $derived(objectItem?.fields ?? []);
  const parsed = $derived(structuredValue(field, rows));
  const items = $derived(
    "value" in parsed && Array.isArray(parsed.value) ? parsed.value : [],
  );
  const parsedProblem = $derived("problem" in parsed ? parsed.problem : "");

  let open = $state<number | null>(null);
  let draft = $state<Record<string, unknown> | null>(null);
  let initial = $state("");
  let problem = $state("");
  let askDiscard = $state(false);
  let pendingAction: (() => void) | null = null;
  let jsonText = $state("");
  let jsonError = $state("");
  let jsonReady = false;

  $effect(() => {
    if (parsedProblem && !jsonReady) {
      jsonReady = true;
      jsonText =
        typeof rows === "string" ? rows : JSON.stringify(rows ?? [], null, 2);
    }
  });

  function dirty(): boolean {
    return !!draft && JSON.stringify(draft) !== initial;
  }

  function closeNow(): void {
    open = null;
    draft = null;
    initial = "";
    problem = "";
  }

  function guard(action: () => void): void {
    if (hooks?.managed && open !== null && dirty()) {
      pendingAction = action;
      askDiscard = true;
      return;
    }
    action();
  }

  function toggle(index: number): void {
    guard(() => {
      if (open === index) {
        closeNow();
        return;
      }
      closeNow();
      open = index;
      if (hooks?.managed) {
        draft = { ...(items[index] as Record<string, unknown>) };
        initial = JSON.stringify(draft);
      }
    });
  }

  function onLine(event: MouseEvent, index: number): void {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, label, details")) {
      return;
    }
    toggle(index);
  }

  function editorValue(index: number): Record<string, unknown> {
    if (hooks?.managed) return draft ?? {};
    return (items[index] ?? {}) as Record<string, unknown>;
  }

  function change(index: number, name: string, next: unknown): void {
    if (hooks?.managed && draft) {
      draft = { ...draft, [name]: next };
      return;
    }
    onchange(
      items.map((row, at) =>
        at === index
          ? { ...(row as Record<string, unknown>), [name]: next }
          : row,
      ),
    );
  }

  function scalarChange(index: number, value: unknown): void {
    onchange(items.map((row, at) => (at === index ? value : row)));
  }

  async function saveRow(): Promise<void> {
    if (!draft || !hooks?.saveRow) return;
    problem = "";
    const schemaProblem = objectItem ? objectProblem(objectItem, draft) : null;
    if (schemaProblem) {
      problem = schemaProblem;
      return;
    }
    const hostProblem = hooks.validateItem?.(draft) ?? null;
    if (hostProblem) {
      problem = hostProblem;
      return;
    }
    try {
      await hooks.saveRow(draft);
      closeNow();
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }

  async function remove(index: number): Promise<void> {
    const row = items[index] as Record<string, unknown>;
    if (hooks?.removeRow) {
      try {
        await hooks.removeRow(row);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    onchange(items.filter((_, at) => at !== index));
    if (open === index) closeNow();
  }

  function add(): void {
    if (hooks?.createRow) {
      const row = hooks.createRow();
      if (row) onchange([...items, row]);
      return;
    }
    onchange([...items, itemDefaults(item)]);
  }

  function resetJson(): void {
    jsonText = JSON.stringify(items, null, 2);
    jsonError = "";
  }

  function applyJson(text: string): void {
    jsonText = text;
    try {
      const next = JSON.parse(text);
      if (!Array.isArray(next)) {
        jsonError = "Must be a JSON array.";
        return;
      }
      jsonError = "";
      onchange(next);
    } catch (error) {
      jsonError = error instanceof Error ? error.message : "Invalid JSON.";
    }
  }

  function labelFor(index: number): string {
    return (
      rowSummary(itemFields, (items[index] ?? {}) as Record<string, unknown>) ||
      `entry ${index + 1}`
    );
  }
</script>

<div class="schema-rows">
  {#if parsedProblem}
    <p class="hint text-danger">{parsedProblem}</p>
    <textarea
      class="json"
      rows="6"
      spellcheck="false"
      value={jsonText}
      oninput={(event) => applyJson(event.currentTarget.value)}
    ></textarea>
    {#if jsonError}<span class="hint text-danger">{jsonError}</span>{/if}
  {:else if objectItem}
    {#each items as row, index (index)}
      {@const record = row as Record<string, unknown>}
      {@const openRow = open === index}
      <div class="item" class:open={openRow}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="item-line" onclick={(event) => onLine(event, index)}>
          <span class="mono summary">{labelFor(index)}</span>
          {#if hooks?.rowNote}
            <span class="badge">{hooks.rowNote(record)}</span>
          {/if}
          <span class="item-actions">
            {#each hooks?.rowActions?.(record) ?? [] as action (action.label)}
              <IconButton
                icon={action.icon}
                label={action.label}
                title={action.title}
                disabled={action.disabled}
                onclick={action.onclick}
              />
            {/each}
            <IconButton
              icon="delete"
              label={`Delete ${labelFor(index)}`}
              danger
              onclick={() => void remove(index)}
            />
            {#if openRow && hooks?.managed}
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={!dirty()}
                onclick={() => void saveRow()}>Save</button
              >
            {/if}
          </span>
        </div>
        {#if openRow}
          <div class="item-editor">
            <SchemaFields
              schema={itemFields}
              value={editorValue(index)}
              onchange={(name, next) => change(index, name, next)}
            />
            {#if problem}<p class="hint text-danger">{problem}</p>{/if}
          </div>
        {/if}
      </div>
    {:else}
      <p class="hint text-muted">No entries yet.</p>
    {/each}
  {:else}
    {#each items as value, index (index)}
      <div class="scalar-row">
        {#if item === "boolean"}
          <label class="check">
            <input
              type="checkbox"
              checked={value === true}
              onchange={(event) =>
                scalarChange(index, event.currentTarget.checked)}
            />
            <span>{value === true ? "on" : "off"}</span>
          </label>
        {:else}
          <input
            type={item === "number" ? "number" : "text"}
            value={String(value ?? "")}
            oninput={(event) =>
              scalarChange(
                index,
                item === "number"
                  ? event.currentTarget.value === ""
                    ? undefined
                    : Number(event.currentTarget.value)
                  : event.currentTarget.value,
              )}
          />
        {/if}
        <IconButton
          icon="delete"
          label={`Delete entry ${index + 1}`}
          danger
          onclick={() => void remove(index)}
        />
      </div>
    {/each}
  {/if}

  {#if !parsedProblem}
    <div class="row-actions">
      <button type="button" class="btn btn-outline btn-sm" onclick={add}
        >+ Add</button
      >
      {#if objectItem}
        <details ontoggle={(event) => event.currentTarget.open && resetJson()}>
          <summary class="hint text-muted">Edit as JSON</summary>
          <textarea
            class="json"
            rows="6"
            spellcheck="false"
            value={jsonText}
            oninput={(event) => applyJson(event.currentTarget.value)}
          ></textarea>
          {#if jsonError}<span class="hint text-danger">{jsonError}</span>{/if}
        </details>
      {/if}
    </div>
  {/if}
</div>

{#if askDiscard}
  <ConfirmModal
    title="Discard changes?"
    confirmLabel="Discard"
    onConfirm={() => {
      const action = pendingAction;
      pendingAction = null;
      askDiscard = false;
      closeNow();
      action?.();
    }}
    onCancel={() => {
      pendingAction = null;
      askDiscard = false;
    }}
  >
    The row has unsaved changes. Closing discards them.
  </ConfirmModal>
{/if}

<style>
  .schema-rows {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .summary {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .scalar-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .scalar-row input[type="text"],
  .scalar-row input[type="number"] {
    flex: 1 1 auto;
    min-width: 0;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--label-mono-size);
    cursor: pointer;
    flex: 1 1 auto;
  }
  .row-actions {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: flex-start;
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
