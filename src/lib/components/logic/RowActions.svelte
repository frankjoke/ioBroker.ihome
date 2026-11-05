<script lang="ts">
  import type { Input, LogicDef, OnRow } from "$logic/types";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
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
  const rowTabs = $derived([
    {
      id: "goto" as const,
      label: hasGotoDraft ? "goto •" : "goto",
      hint: "Pick a target state, or stay in this state",
    },
    {
      id: "function" as const,
      label: hasCodeDraft ? "function •" : "function",
      hint: "Run statements that can set, log and goto",
    },
  ]);
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

  <div class="row-flag">
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

  <OptionTabs
    value={mode}
    label="Row action"
    tabs={rowTabs}
    collapsible={false}
    onchange={(next) => {
      if (!next || next === mode) return;
      onchange({ ...row, mode: next });
    }}
  >
    {#snippet children(id)}
      <div class="option-body">
        {#if id === "goto"}
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
    {/snippet}
  </OptionTabs>
</div>

<style>
  .row-actions {
    --option-tab-bg: var(--surface-color);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .log-line,
  .row-flag {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .log-line input {
    flex: 1;
    min-width: 12rem;
  }

  .continue {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: var(--body-sm);
  }

  .option-body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.3rem 0 0.3rem 0.6rem;
    border-left: 2px solid var(--border-color);
  }
</style>
