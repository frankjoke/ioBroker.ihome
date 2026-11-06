<script lang="ts">
  import type { Input, LogicDef, Output } from "$logic/types";
  import type { Issue } from "$logic/validate";
  import { renameCodeRefs } from "$logic/expr-code";
  import InputsEditor from "./InputsEditor.svelte";
  import OutputEditor from "./OutputEditor.svelte";
  import CodeField from "./CodeField.svelte";
  import MachineEditor from "./MachineEditor.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    roomList,
    enumLabelFromObject,
    roomsOf,
    functionsOf,
  } from "$lib/config/rooms";
  import { stateIdFor } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";

  /** The logic's body only. Its identity, save and close live on the list line
   *  that opened it, so nothing is shown twice (UI-DESIGN §5.3). */
  let {
    draft = $bindable(),
    issues = [],
    logics = [],
  }: {
    draft: LogicDef;
    issues: Issue[];
    /** The whole document's logics: their outputs are event sources (D29). */
    logics?: LogicDef[];
  } = $props();

  const output = $derived<Output>(
    draft.output ?? { scope: "memory", name: draft.id },
  );
  const RESULT_PLACEHOLDER = 'get("temp") > 20 ? "On" : "Off"';
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

  /** A state output's own organisation: shown until the logic overrides a part. */
  const inherited = $derived.by(() => {
    const out = draft.output;
    if (out?.scope !== "state" || !out.ref) {
      return { rooms: [] as string[], functions: [] as string[] };
    }
    const id = stateIdFor(out.ref, getVariables());
    return {
      rooms: roomsOf(ioBroker.enums, id),
      functions: functionsOf(ioBroker.enums, id),
    };
  });
  const shownRooms = $derived(ownRooms.length ? ownRooms : inherited.rooms);
  const shownFunctions = $derived(
    ownFunctions.length ? ownFunctions : inherited.functions,
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
        if (key === "code" && typeof item === "string") {
          out[key] = renameCodeRefs(item, from, to);
        } else if ((key === "ref" || key === "on") && item === from) {
          out[key] = to;
        } else out[key] = renameRefs(item, from, to);
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
      logicId={draft.id}
      {logics}
      onchange={(next) => patch({ output: next })}
    />
    <div class="form-grid">
      <label class="field"
        ><span class="label-mono">Rooms</span>
        <MultiSelect
          options={roomOptions}
          selected={shownRooms}
          enums={ioBroker.enums}
          placeholder="Select…"
          onChange={(ids) => setOrg("rooms", ids)}
        /></label
      >
      <label class="field"
        ><span class="label-mono">Functions</span>
        <MultiSelect
          options={functionOptions}
          selected={shownFunctions}
          enums={ioBroker.enums}
          placeholder="Select…"
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
      {logics}
      selfId={draft.id}
    />
  </div>

  {#if draft.kind === "function"}
    <div class="block">
      <span class="label-mono">Result expression</span>
      <CodeField
        code={draft.expr.code}
        label="Result expression"
        placeholder={RESULT_PLACEHOLDER}
        hint="fetchJson(url, (data, error) => …)"
        allowNoop
        {logics}
        inputs={draft.inputs}
        onchange={(code) => patch({ expr: { code } })}
      />
    </div>
  {:else}
    <MachineEditor logic={draft} {logics} onchange={(next) => (draft = next)} />
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
