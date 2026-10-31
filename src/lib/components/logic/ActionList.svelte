<script lang="ts">
  import type { Action, Expr } from "$logic/types";
  import StateRefField from "./StateRefField.svelte";
  import ExprEditor from "./ExprEditor.svelte";

  let {
    actions,
    onchange,
    allowGoto = false,
    stateNames = [],
  }: {
    actions: Action[];
    onchange: (actions: Action[]) => void;
    allowGoto?: boolean;
    stateNames?: string[];
  } = $props();

  const SET_VALUE: Expr = { const: true };

  function replace(index: number, action: Action) {
    const next = [...actions];
    next[index] = action;
    onchange(next);
  }

  function add(kind: "set" | "log") {
    onchange([
      ...actions,
      kind === "set"
        ? { set: { target: { ref: "" }, value: SET_VALUE } }
        : { log: { text: "" } },
    ]);
  }
</script>

<div class="actions">
  {#each actions as action, index (index)}
    <div class="action-row">
      {#if "set" in action}
        <span class="label-mono">set</span>
        <StateRefField
          value={action.set.target.ref}
          label="Target"
          onchange={(ref) =>
            replace(index, {
              set: { ...action.set, target: { ref } },
            })}
        />
        <ExprEditor
          expr={action.set.value}
          onchange={(value) => {
            if ("noop" in value) return;
            replace(index, { set: { ...action.set, value } });
          }}
        />
        <label class="inline"
          >ack <input
            type="checkbox"
            checked={action.set.ack === true}
            onchange={(e) =>
              replace(index, {
                set: { ...action.set, ack: e.currentTarget.checked },
              })}
          /></label
        >
        <label class="inline"
          >every time <input
            type="checkbox"
            checked={action.set.forward === "always"}
            onchange={(e) =>
              replace(index, {
                set: {
                  ...action.set,
                  forward: e.currentTarget.checked ? "always" : "changed",
                },
              })}
          /></label
        >
      {:else if "goto" in action}
        <span class="label-mono">goto</span>
        <select
          aria-label="Target state"
          value={action.goto}
          onchange={(e) => replace(index, { goto: e.currentTarget.value })}
        >
          {#each stateNames as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      {:else if "log" in action}
        <span class="label-mono">log</span>
        <input
          aria-label="Log text"
          value={action.log.text}
          placeholder="message"
          onchange={(e) =>
            replace(index, {
              log: { ...action.log, text: e.currentTarget.value },
            })}
        />
        <select
          aria-label="Log level"
          value={action.log.level ?? "info"}
          onchange={(e) =>
            replace(index, {
              log: {
                ...action.log,
                level: e.currentTarget.value as "info" | "warn",
              },
            })}
        >
          <option value="info">info</option>
          <option value="warn">warn</option>
        </select>
      {/if}
      <button
        type="button"
        class="icon-btn"
        aria-label="Remove action"
        onclick={() => onchange(actions.filter((_, i) => i !== index))}
      >
        <span class="material-symbols-outlined">remove</span>
      </button>
    </div>
  {/each}

  <div class="action-add">
    <button type="button" class="btn btn-sm" onclick={() => add("set")}
      >Add set</button
    >
    <button type="button" class="btn btn-sm" onclick={() => add("log")}
      >Add log</button
    >
    {#if allowGoto}
      <span class="hint text-muted">goto is a row field below.</span>
    {/if}
  </div>
</div>

<style>
  .actions {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .action-row,
  .action-add,
  .inline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .action-row {
    padding: 0.4rem 0;
    border-bottom: 1px dashed var(--border-color);
  }
</style>
