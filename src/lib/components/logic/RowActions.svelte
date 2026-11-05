<script lang="ts">
  import type { Input, LogicDef, OnRow } from "$logic/types";
  import CodeField from "./CodeField.svelte";

  let {
    row,
    onchange,
    stateNames,
    logics = [],
    inputs = {},
  }: {
    row: OnRow;
    onchange: (row: OnRow) => void;
    stateNames: string[];
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
    /** The logic's own variables/events, as quick-insert badges. */
    inputs?: Record<string, Input>;
  } = $props();

  const mode = $derived(row.mode ?? "goto");
  const hasGotoDraft = $derived(mode !== "goto" && !!row.goto);
  const hasCodeDraft = $derived(mode !== "function" && !!row.do?.code.trim());
</script>

<div class="row-actions">
  <div class="log-line">
    <span class="label-mono">log</span>
    <select
      aria-label="Log level"
      value={row.log?.level ?? ""}
      onchange={(e) => {
        const level = e.currentTarget.value as "" | "info" | "warn";
        const text = row.log?.text ?? "";
        onchange({
          ...row,
          log: level ? { text, level } : text ? { text } : undefined,
        });
      }}
    >
      <option value="">— no log —</option>
      <option value="info">info</option>
      <option value="warn">warn</option>
    </select>
    {#if row.log?.level}
      <input
        aria-label="Log text"
        value={row.log.text}
        placeholder={"message — {{ref}} for a value"}
        oninput={(e) =>
          onchange({
            ...row,
            log: { text: e.currentTarget.value, level: row.log!.level },
          })}
      />
    {/if}
  </div>

  <div class="tabs">
    <button
      type="button"
      class="btn btn-sm"
      class:active={mode === "goto"}
      aria-pressed={mode === "goto"}
      onclick={() => onchange({ ...row, mode: "goto" })}
    >
      goto{#if hasGotoDraft}<span class="dot" title="Has a saved goto"
        ></span>{/if}
    </button>
    <button
      type="button"
      class="btn btn-sm"
      class:active={mode === "function"}
      aria-pressed={mode === "function"}
      onclick={() => onchange({ ...row, mode: "function" })}
    >
      function{#if hasCodeDraft}<span class="dot" title="Has saved code"
        ></span>{/if}
    </button>
    <label class="continue">
      <input
        type="checkbox"
        checked={row.continue === true}
        onchange={(e) => {
          const checked = e.currentTarget.checked;
          onchange({
            ...row,
            continue: checked || undefined,
            mode: checked ? "function" : row.mode,
          });
        }}
      />
      continue to next row
    </label>
  </div>

  {#if mode === "goto"}
    <select
      aria-label="Target state"
      value={row.goto ?? ""}
      onchange={(e) => {
        const goto = e.currentTarget.value || undefined;
        onchange({
          ...row,
          goto,
          mode: "goto",
          continue: goto ? undefined : row.continue,
        });
      }}
    >
      <option value="">— stay —</option>
      {#each stateNames as target (target)}
        <option value={target}>{target}</option>
      {/each}
    </select>
  {:else}
    <CodeField
      code={row.do?.code ?? ""}
      mode="statements"
      label="Function"
      minRows={3}
      allowGoto
      {stateNames}
      {logics}
      {inputs}
      placeholder={[
        'set("light", true)',
        'log("motion on")',
        'goto("On")',
      ].join("\n")}
      onchange={(code) =>
        onchange({
          ...row,
          do: code.trim() ? { code } : undefined,
          mode: "function",
        })}
    />
  {/if}
</div>

<style>
  .row-actions,
  .log-line,
  .tabs {
    display: flex;
    gap: 0.4rem;
  }

  .row-actions {
    flex-direction: column;
  }

  .log-line,
  .tabs {
    flex-wrap: wrap;
    align-items: center;
  }

  .log-line input {
    flex: 1;
    min-width: 12rem;
  }

  .tabs .active {
    background: var(--primary-color);
    color: var(--on-primary, #fff);
  }

  .continue {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
    font-size: var(--body-sm);
  }

  .dot {
    display: inline-block;
    width: 0.4rem;
    height: 0.4rem;
    margin-left: 0.3rem;
    border-radius: 50%;
    background: var(--secondary-color);
  }
</style>
