<script lang="ts">
  import type { Input, LogicDef, Output } from "$logic/types";
  import type { Issue } from "$logic/validate";
  import InputsEditor from "./InputsEditor.svelte";
  import OutputEditor from "./OutputEditor.svelte";
  import ExprEditor from "./ExprEditor.svelte";
  import MachineEditor from "./MachineEditor.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList, enumLabelFromObject } from "$lib/config/rooms";

  /** The logic's body only. Its identity, save and close live on the list line
   *  that opened it, so nothing is shown twice (UI-DESIGN §5.3). */
  let {
    draft = $bindable(),
    issues = [],
  }: {
    draft: LogicDef;
    issues: Issue[];
  } = $props();

  const output = $derived<Output>(
    draft.output ?? { scope: "memory", name: draft.id },
  );
  const stateNames = $derived(
    draft.kind === "machine" ? Object.keys(draft.states) : [],
  );

  const roomOptions = $derived(
    roomList(ioBroker.enums).map((r) => ({
      value: r.id,
      label: r.label,
      icon: r.icon,
    })),
  );
  const functionOptions = $derived(
    (((ioBroker.enums as any)?.getList("functions") as any[]) ?? []).map(
      (e: any) => ({ value: e._id, label: enumLabelFromObject(e) }),
    ),
  );
  const ownRooms = $derived(
    (draft.enums ?? []).filter((e) => e.startsWith("enum.rooms.")),
  );
  const ownFunctions = $derived(
    (draft.enums ?? []).filter((e) => e.startsWith("enum.functions.")),
  );

  /** A part with no entries inherits from the output state. */
  function setOrg(part: "rooms" | "functions", ids: string[]) {
    const keep = (draft.enums ?? []).filter(
      (e) => !e.startsWith(`enum.${part}.`),
    );
    patch({ enums: keep.length || ids.length ? [...keep, ...ids] : undefined });
  }

  function patch(update: Partial<LogicDef>) {
    draft = { ...draft, ...update } as LogicDef;
  }

  function renameRefs(value: unknown, from: string, to: string): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => renameRefs(item, from, to));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if ((key === "ref" || key === "on") && item === from) out[key] = to;
        else out[key] = renameRefs(item, from, to);
      }
      return out;
    }
    return value;
  }

  /** Renaming an input rewrites its rows, conditions and set targets. */
  function renameInput(oldName: string, newName: string) {
    const inputs = draft.inputs ?? {};
    if (!newName || newName === oldName || newName in inputs) return;
    const rebuilt: Record<string, Input> = {};
    for (const [key, value] of Object.entries(inputs)) {
      rebuilt[key === oldName ? newName : key] = value;
    }
    const rest = { ...draft } as Record<string, unknown>;
    delete rest.inputs;
    draft = {
      ...(renameRefs(rest, oldName, newName) as object),
      inputs: rebuilt,
    } as LogicDef;
  }
</script>

<div class="editor-body">
  <div class="block">
    <span class="label-mono">Output</span>
    <OutputEditor
      {output}
      {stateNames}
      onchange={(next) => patch({ output: next })}
    />
    <div class="form-grid">
      <label class="field"
        ><span class="label-mono">Rooms</span>
        <MultiSelect
          options={roomOptions}
          selected={ownRooms}
          enums={ioBroker.enums}
          placeholder="Inherit from the output"
          onChange={(ids) => setOrg("rooms", ids)}
        /></label
      >
      <label class="field"
        ><span class="label-mono">Functions</span>
        <MultiSelect
          options={functionOptions}
          selected={ownFunctions}
          enums={ioBroker.enums}
          placeholder="Inherit from the output"
          onChange={(ids) => setOrg("functions", ids)}
        /></label
      >
    </div>
  </div>

  <div class="block">
    <InputsEditor
      inputs={draft.inputs ?? {}}
      onchange={(inputs) => patch({ inputs })}
      onRename={renameInput}
      where={draft.name}
    />
  </div>

  {#if draft.kind === "function"}
    <div class="block">
      <span class="label-mono">Result expression</span>
      <ExprEditor
        expr={draft.expr}
        allowNoop
        onchange={(expr) => patch({ expr })}
      />
    </div>
  {:else}
    <MachineEditor logic={draft} onchange={(next) => (draft = next)} />
  {/if}

  {#if issues.length > 0}
    <ul class="issues">
      {#each issues as issue (issue.path + issue.message)}
        <li class:text-danger={issue.severity === "error"}>
          <span class="mono">{issue.path}</span> — {issue.message}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .editor-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .issues {
    margin: 0;
    padding: 0.5rem 0.75rem 0.5rem 1.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--body-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
  }
</style>
