<script lang="ts">
  import { onMount } from "svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import type { LogicDef } from "$logic/types";
  import type { LogicReading } from "$logic/engine";
  import {
    commitLogics,
    getLogicDocument,
    logicBlocked,
    logicSaveFailed,
    logicsLoadKind,
  } from "$lib/stores/logics.svelte";
  import LogicEditor from "$lib/components/logic/LogicEditor.svelte";
  import LogSheet from "$lib/components/logic/LogSheet.svelte";
  import TemplateInsert from "$lib/components/logic/TemplateInsert.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import NameModal from "$lib/components/common/NameModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { renameMemoryRefs, renameLogicRefs } from "$lib/config/logic-rename";
  import { validateLogicDocument } from "$logic/validate";
  import type { Issue } from "$logic/validate";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { variableNameFor } from "$lib/config/variables";
  import { stateIdFor } from "$lib/config/variables";
  import {
    roomList,
    roomsOf,
    functionsOf,
    enumLabelFromObject,
  } from "$lib/config/rooms";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatAge, formatValue } from "$lib/config/format";
  import {
    fetchPickerValues,
    getPickerValue,
  } from "$lib/picker-values.svelte.js";
  import { takeRequestedLogicConfig } from "$lib/pages.js";
  import { LOGIC_GUIDE } from "$lib/config/page-guides";

  const doc = $derived(getLogicDocument());
  let selectedId = $state<string | null>(null);
  let pendingDelete = $state<LogicDef | null>(null);
  let inserting = $state(false);
  /** The adapter log drawer, opened from the title line. */
  let showLog = $state(false);

  // The layout gives the page the space the drawer leaves (see +layout.svelte).
  $effect(() => {
    document.body.classList.toggle("log-open", showLog);
    return () => document.body.classList.remove("log-open");
  });
  /** Which new logic the name dialog is creating. */
  let pendingCreate = $state<"machine" | "action" | null>(null);
  /** Why the open row's name was rejected, if it was. */
  let nameError = $state("");
  /** The open editor, scrolled into view like the device list does. */
  let inlineForm: HTMLElement | undefined = $state();

  $effect(() => {
    if (selectedId && inlineForm) {
      inlineForm.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });

  /** A template apply asks for its generated logic to be opened on arrival. */
  let requestedId = $state("");
  onMount(() => {
    requestedId = takeRequestedLogicConfig();
  });
  $effect(() => {
    if (!requestedId) return;
    const logic = doc.logics.find((item) => item.id === requestedId);
    if (!logic) return;
    requestedId = "";
    openLogic(logic);
  });

  function uniqueId(base: string): string {
    const taken = doc.logics.map((logic) => logic.id);
    let id = base;
    let index = 2;
    while (taken.includes(id)) id = `${base}-${index++}`;
    return id;
  }

  /** Logic names are state/memory identifiers: no spaces, unique. */
  const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
  function nameProblem(name: string, exceptId?: string): string | null {
    if (!NAME_PATTERN.test(name)) {
      return "Use letters, digits, _ or - (no spaces).";
    }
    if (
      doc.logics.some((logic) => logic.id === name && logic.id !== exceptId)
    ) {
      return "That name is already used.";
    }
    return null;
  }

  function commit(logics: LogicDef[]): boolean {
    return commitLogics({ ...doc, logics });
  }

  function addMachine(name: string) {
    const logic: LogicDef = {
      id: name,
      name,
      kind: "machine",
      output: { scope: "memory", name },
      states: { Idle: {} },
    };
    if (commit([...doc.logics, logic])) select(logic);
  }

  function addAction(name: string) {
    const logic: LogicDef = {
      id: name,
      name,
      kind: "function",
      output: { scope: "memory", name },
      expr: { code: "0" },
    };
    if (commit([...doc.logics, logic])) select(logic);
  }

  function duplicate(logic: LogicDef) {
    const id = uniqueId(`${logic.id}-copy`);
    const copy = $state.snapshot(logic) as LogicDef;
    copy.id = id;
    copy.name = id;
    if (copy.output?.scope === "memory" && copy.output.name === logic.id) {
      copy.output.name = id;
    }
    if (commit([...doc.logics, copy])) select(copy);
  }

  function update(next: LogicDef) {
    commit(doc.logics.map((logic) => (logic.id === next.id ? next : logic)));
  }

  function toggle(logic: LogicDef, enabled: boolean) {
    update({ ...logic, enabled });
  }

  function confirmDelete() {
    if (pendingDelete) {
      commit(doc.logics.filter((logic) => logic.id !== pendingDelete!.id));
      if (selectedId === pendingDelete.id) selectedId = null;
    }
    pendingDelete = null;
  }

  /** The row being edited: edits happen on a copy, so the adapter only sees them
   *  on Save (the same draft model as the tile editor). */
  let draft = $state<LogicDef | null>(null);
  let askClose = $state(false);
  /** The row the user picked while the draft was dirty. */
  let pendingSelect = $state<LogicDef | null>(null);

  let search = $state("");
  let kindTab = $state<"machine" | "function">("machine");
  let tabValue = $state<"machine" | "function" | null>("machine");
  let showHelp = $state(false);
  let roomFilter = $state("");
  let functionFilter = $state("");

  const kindTabs = [
    {
      id: "machine" as const,
      label: "Logic",
      hint: "Logics that react to events.",
    },
    {
      id: "function" as const,
      label: "Actions",
      hint: "Computed values and reusable functions.",
    },
  ];

  function onKindTab(next: "machine" | "function" | null) {
    kindTab = next ?? "machine";
    tabValue = kindTab;
  }

  function startCreate(kind: "machine" | "action") {
    kindTab = kind === "machine" ? "machine" : "function";
    tabValue = kindTab;
    pendingCreate = kind;
  }

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

  /** A logic's organisation: its own override per part, else the output state's. */
  function logicEnums(logic: LogicDef): string[] {
    const own = logic.enums ?? [];
    const stateId =
      logic.output?.scope === "state" && logic.output.ref
        ? stateIdFor(logic.output.ref, getVariables())
        : undefined;
    const rooms = own.some((e) => e.startsWith("enum.rooms."))
      ? own.filter((e) => e.startsWith("enum.rooms."))
      : stateId
        ? roomsOf(ioBroker.enums, stateId)
        : [];
    const functions = own.some((e) => e.startsWith("enum.functions."))
      ? own.filter((e) => e.startsWith("enum.functions."))
      : stateId
        ? functionsOf(ioBroker.enums, stateId)
        : [];
    return [...rooms, ...functions];
  }

  const shownLogics = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return doc.logics.filter((logic) => {
      if (q && !logic.name.toLowerCase().includes(q)) return false;
      if (logic.kind !== kindTab) return false;
      if (roomFilter || functionFilter) {
        const enums = logicEnums(logic);
        if (roomFilter && !enums.includes(roomFilter)) return false;
        if (functionFilter && !enums.includes(functionFilter)) return false;
      }
      return true;
    });
  });

  const selectedLogic = $derived(
    doc.logics.find((logic) => logic.id === selectedId) ?? null,
  );
  const dirty = $derived(
    !!draft &&
      !!selectedLogic &&
      JSON.stringify(draft) !== JSON.stringify(selectedLogic),
  );
  const issues = $derived.by((): Issue[] => {
    const current = draft;
    if (!current) return [];
    // Validate against the whole document: a `$logic.<id>` or a local event
    // naming another logic must see that logic, not just this draft.
    const logs = doc.logics.map((logic) =>
      logic.id === current.id ? current : logic,
    );
    if (!logs.some((logic) => logic.id === current.id)) logs.push(current);
    return validateLogicDocument({ version: 3, logics: logs }).filter(
      (issue) => issue.logicId === current.id,
    );
  });
  const canSave = $derived(
    dirty && !nameError && !issues.some((issue) => issue.severity === "error"),
  );

  /** The row's name opens it; clicking another row asks first when the draft is
   *  dirty, so an edit is never dropped silently. */
  function select(logic: LogicDef) {
    if (dirty) {
      pendingSelect = logic;
      askClose = true;
      return;
    }
    openLogic(logic);
  }

  function openLogic(logic: LogicDef) {
    const stored = doc.logics.find((item) => item.id === logic.id) ?? logic;
    selectedId = stored.id;
    draft = $state.snapshot(stored) as LogicDef;
    askClose = false;
    pendingSelect = null;
    nameError = "";
  }

  function patch(update: Partial<LogicDef>) {
    if (draft) draft = { ...draft, ...update } as LogicDef;
  }

  /** A state id that a global variable stands for becomes the variable's name,
   *  so changing the variable later changes every logic that uses it. */
  function normalizeRefs(logic: LogicDef): LogicDef {
    const vars = getVariables();
    const toName = (ref: string) => variableNameFor(ref, vars);
    const inputs = Object.fromEntries(
      Object.entries(logic.inputs ?? {}).map(([name, input]) => {
        if (input.from.type !== "state") return [name, input];
        return [
          name,
          {
            ...input,
            from: {
              ...input.from,
              ref: toName(input.from.ref),
              refs: (input.from.refs ?? []).map(toName),
            },
          },
        ];
      }),
    ) as LogicDef["inputs"];
    const output =
      logic.output?.scope === "state"
        ? { ...logic.output, ref: toName(logic.output.ref) }
        : logic.output;
    return { ...logic, inputs, output } as LogicDef;
  }

  /** The name is the id (a state/memory identifier), so one edit renames both.
   *  Spaces and duplicates are refused; the caller resets its input. */
  function renameLogic(raw: string): boolean {
    if (!draft) return false;
    const name = raw.trim();
    const problem = nameProblem(name, draft.id);
    if (problem) {
      nameError = problem;
      return false;
    }
    nameError = "";
    const oldId = draft.id;
    const followsId =
      draft.output?.scope === "memory" &&
      (draft.output.name ?? oldId) === oldId;
    draft = (
      followsId
        ? { ...draft, id: name, name, output: { ...draft.output, name } }
        : { ...draft, id: name, name }
    ) as LogicDef;
    return true;
  }

  function save() {
    if (!canSave || !draft) return;
    const next = normalizeRefs(draft);
    const old = selectedLogic;
    if (old && old.id !== next.id) {
      const problem = nameProblem(next.id, old.id);
      if (problem) {
        nameError = problem;
        return;
      }
    }
    const oldMemory =
      old?.output?.scope === "memory" ? (old.output.name ?? old.id) : undefined;
    const newMemory =
      next.output?.scope === "memory"
        ? (next.output.name ?? next.id)
        : undefined;
    const memoryRenamed = !!(oldMemory && newMemory && oldMemory !== newMemory);
    const idRenamed = !!old && old.id !== next.id;
    // Even the renamed logic may read its own old memory name or listen to an
    // old `$logic.<id>`.
    let saved = memoryRenamed
      ? renameMemoryRefs(next, oldMemory!, newMemory!)
      : next;
    if (idRenamed) saved = renameLogicRefs(saved, old!.id, next.id);
    if (idRenamed) {
      // A rename is document-wide: the logic takes the new id, and every
      // memory reference and `$logic.<old>` trigger follows.
      const logs = doc.logics.map((logic) => {
        if (logic.id === old!.id) return saved;
        let item = memoryRenamed
          ? renameMemoryRefs(logic, oldMemory!, newMemory!)
          : logic;
        if (idRenamed) item = renameLogicRefs(item, old!.id, next.id);
        return item;
      });
      if (!commit(logs)) return;
    } else {
      update(saved);
    }
    draft = $state.snapshot(saved) as LogicDef;
    selectedId = saved.id;
  }

  function closeEditor() {
    if (dirty) {
      askClose = true;
      return;
    }
    selectedId = null;
    draft = null;
  }

  /** The whole line opens/closes its item — except the actions and any control
   *  (the name input while open, the checkboxes). */
  function onLineClick(event: MouseEvent, logic: LogicDef) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    if (selectedId === logic.id) closeEditor();
    else select(logic);
  }

  // The adapter publishes each logic's live readout as `info.logic`; the list
  // polls it (a subscribed state would need a per-logic subscription plan).
  const LOGIC_STATE = `${ioBroker.namespace}.info.logic`;
  let readings = $state<Record<string, LogicReading>>({});
  let readingBusy = false;

  async function fetchReadings(): Promise<void> {
    if (readingBusy) return;
    readingBusy = true;
    try {
      const state = await ioBroker.getState(LOGIC_STATE, true);
      const raw = state?.val;
      const page = typeof raw === "string" && raw ? JSON.parse(raw) : null;
      if (page && typeof page.logics === "object") readings = page.logics;
    } catch {
      // No feed (older adapter): the list just shows no reading.
    } finally {
      readingBusy = false;
    }
  }

  onMount(() => {
    const tick = () => {
      void fetchReadings();
      void fetchPickerValues(outputStateIds());
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  });

  /** While the row is open these edit the draft; closed, they write at once. */
  function setEnabled(logic: LogicDef, enabled: boolean) {
    if (selectedId === logic.id) patch({ enabled });
    else toggle(logic, enabled);
  }

  function setLog(logic: LogicDef, log: boolean) {
    if (selectedId === logic.id) patch({ log: log || undefined });
    else update({ ...logic, log: log || undefined });
  }

  /** The output state behind a logic, when it has one (memory has none). */
  function outputStateId(logic: LogicDef): string | null {
    const output = logic.output;
    if (output?.scope === "logic") {
      return `${ioBroker.namespace}.Logic.${logic.id}`;
    }
    if (output?.scope === "state" && output.ref) {
      return stateIdFor(output.ref, getVariables());
    }
    return null;
  }

  /** The output states the age column reads. */
  function outputStateIds(): string[] {
    const ids: string[] = [];
    for (const logic of doc.logics) {
      const id = outputStateId(logic);
      if (id) ids.push(id);
    }
    return ids;
  }

  /** The machine's state or the action's value, with its unit when it has one. */
  function readingText(logic: LogicDef): string {
    if (logic.enabled === false) return "";
    const reading = readings[logic.id];
    if (!reading) return "";
    if (logic.kind === "machine") return reading.state ?? "";
    if (reading.value === undefined) return "";
    const output = logic.output;
    let unit = "";
    let role: string | undefined;
    if (output?.scope === "logic" && output.type === "number") {
      unit = output.unit ?? "";
      role = output.role;
    } else if (output?.scope === "state" && output.type === "number") {
      const id = stateIdFor(output.ref, getVariables());
      const common = ioBroker.objects.get(id)?.common;
      unit = String(common?.unit ?? "");
      role = common?.role;
    }
    return formatValue(reading.value, unit, role);
  }

  /** How long ago the output state last changed, like the device list. */
  function agoText(logic: LogicDef): string {
    if (logic.enabled === false) return "";
    const id = outputStateId(logic);
    // A memory output has no state, so the engine's report time is the only age.
    const ts = id ? getPickerValue(id)?.ts : readings[logic.id]?.ts;
    if (typeof ts !== "number") return "";
    const age = formatAge(ts);
    return age === "now" ? "just now" : `${age} ago`;
  }

  function outputLabel(logic: LogicDef): string {
    const output = logic.output;
    if (!output) return `memory: ${logic.id}`;
    if (output.scope === "memory") return `memory: ${output.name ?? logic.id}`;
    if (output.scope === "logic") return `Logic.${logic.id}`;
    return output.ref || "(no state)";
  }
</script>

<svelte:head>
  <title>Logic - iHome</title>
</svelte:head>

<div class="logic-page">
  <div class="item" class:open={showHelp}>
    <div class="item-line title-line">
      <div class="tabs-line">
        <OptionTabs
          bind:value={tabValue}
          label="Logic type"
          tabs={kindTabs}
          collapsible={false}
          onchange={onKindTab}
        />
        <button
          type="button"
          class="btn btn-outline btn-sm"
          aria-expanded={showHelp}
          onclick={() => (showHelp = !showHelp)}
        >
          <span class="material-symbols-outlined">help</span>
          Help
          <span class="material-symbols-outlined"
            >{showHelp ? "expand_less" : "expand_more"}</span
          >
        </button>
      </div>
      <div class="page-actions">
        <label class="check" title="Show the adapter log">
          <input type="checkbox" bind:checked={showLog} />
          Show log
        </label>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => (inserting = true)}
        >
          <span class="material-symbols-outlined">dashboard_customize</span>
          From template
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={() => startCreate("machine")}
        >
          + Logic
        </button>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={() => startCreate("action")}
        >
          + Action
        </button>
      </div>
    </div>
    {#if showHelp}
      <div class="item-editor">
        <HelpSection help={LOGIC_GUIDE} static plain />
      </div>
    {/if}
  </div>

  {#if logicsLoadKind() === "unreadable"}
    <p class="text-danger hint">
      The stored logic document is unreadable — nothing can be saved until it is
      repaired.
    </p>
  {:else if logicsLoadKind() === "pending"}
    <p class="text-muted hint">Loading the logic document…</p>
  {/if}

  {#if doc.logics.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No logics yet — use From template or add one.</p>
    </div>
  {:else}
    <div class="filter-block">
      <span class="label-mono">Filters</span>
      <div class="filter-bar">
        <input type="search" placeholder="Search logic…" bind:value={search} />
        <select bind:value={roomFilter} aria-label="Filter by room">
          <option value="">All rooms</option>
          {#each roomOptions as r (r.value)}
            <option value={r.value}>{r.label}</option>
          {/each}
        </select>
        <select bind:value={functionFilter} aria-label="Filter by function">
          <option value="">All functions</option>
          {#each functionOptions as f (f.value)}
            <option value={f.value}>{f.label}</option>
          {/each}
        </select>
      </div>
    </div>

    {#if shownLogics.length === 0}
      <div class="card empty-state">
        <p class="text-muted">No logics match the filters.</p>
      </div>
    {/if}

    <div class="logic-list">
      {#each shownLogics as logic (logic.id)}
        {@const open = selectedId === logic.id}
        {@const reading = readingText(logic)}
        {@const ago = agoText(logic)}
        <div class="item" class:open>
          <!-- The free line area is a mouse convenience: keyboard users open/close
               with the name button and close with the ×. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="item-line" onclick={(e) => onLineClick(e, logic)}>
            <span
              class="kind text-muted"
              role="img"
              aria-label={logic.kind === "machine" ? "Logic" : "Action"}
              title={logic.kind === "machine" ? "Logic" : "Action"}
            >
              <span class="material-symbols-outlined" aria-hidden="true"
                >{logic.kind === "machine" ? "account_tree" : "calculate"}</span
              >
            </span>
            {#if open && draft}
              <input
                class="name-input"
                value={draft.name}
                aria-label="Logic name"
                oninput={(e) => renameLogic(e.currentTarget.value)}
              />
            {:else}
              <button type="button" class="name" onclick={() => select(logic)}>
                {logic.name}
              </button>
            {/if}
            <span class="mono hint text-muted">{outputLabel(logic)}</span>
            {#if reading}
              <span class="reading mono">{reading}</span>
            {/if}
            {#if ago}
              <span class="updated text-muted">
                <span class="material-symbols-outlined" aria-hidden="true"
                  >schedule</span
                >{ago}</span
              >
            {/if}
            <span class="item-actions">
              <label class="inline"
                >enabled <input
                  type="checkbox"
                  checked={open && draft
                    ? draft.enabled !== false
                    : logic.enabled !== false}
                  onchange={(e) => setEnabled(logic, e.currentTarget.checked)}
                /></label
              >
              <label class="inline" title="Log state changes to the adapter log"
                >log <input
                  type="checkbox"
                  checked={open && draft
                    ? draft.log === true
                    : logic.log === true}
                  onchange={(e) => setLog(logic, e.currentTarget.checked)}
                /></label
              >
              {#if open}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={!canSave}
                  onclick={save}>Save</button
                >
              {/if}
              <IconButton
                icon="content_copy"
                label={`Duplicate ${logic.name}`}
                title="Duplicate"
                onclick={() => duplicate(logic)}
              />
              <IconButton
                icon="delete"
                danger
                label={`Delete ${logic.name}`}
                onclick={() => (pendingDelete = logic)}
              />
            </span>
          </div>
          {#if open && nameError}
            <p class="text-danger hint">{nameError}</p>
          {/if}
          {#if open && draft}
            <div class="item-editor" bind:this={inlineForm}>
              <LogicEditor bind:draft {issues} logics={doc.logics} {dirty} />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if logicBlocked()}
    <p class="text-danger hint">
      Not saved yet — fix the errors above. The adapter keeps the last valid
      version.
    </p>
  {:else if logicSaveFailed()}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}
</div>

{#if pendingCreate}
  <NameModal
    title={pendingCreate === "machine" ? "New logic" : "New action"}
    confirmLabel="Create"
    validate={(name) => nameProblem(name)}
    onSubmit={(name) => {
      const kind = pendingCreate;
      pendingCreate = null;
      if (kind === "machine") addMachine(name);
      else addAction(name);
    }}
    onCancel={() => (pendingCreate = null)}
  />
{/if}

{#if inserting}
  <TemplateInsert
    taken={doc.logics.map((logic) => logic.id)}
    onInsert={(logic) => {
      kindTab = logic.kind === "machine" ? "machine" : "function";
      tabValue = kindTab;
      if (commit([...doc.logics, logic])) select(logic);
    }}
    onClose={() => (inserting = false)}
  />
{/if}

{#if askClose}
  <ConfirmModal
    title="Discard unsaved changes?"
    confirmLabel="Discard"
    cancelLabel="Keep editing"
    onConfirm={() => {
      askClose = false;
      const next = pendingSelect;
      pendingSelect = null;
      if (next) openLogic(next);
      else {
        selectedId = null;
        draft = null;
      }
    }}
    onCancel={() => {
      askClose = false;
      pendingSelect = null;
    }}
  />
{/if}

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle("logic", pendingDelete.name)}
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = null)}
  />
{/if}

{#if showLog}
  <LogSheet onClose={() => (showLog = false)} />
{/if}

<style>
  .logic-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 860px;
    /* Centered in the page — and, with the drawer open, in the leftover. */
    margin: 0 auto;
  }

  .title-line {
    cursor: default;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    flex-wrap: wrap;
  }

  .page-actions .material-symbols-outlined {
    font-size: 18px;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--body-sm);
    white-space: nowrap;
  }

  .hint {
    font-size: var(--body-sm);
  }

  .filter-block {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7.5rem 7.5rem;
    gap: 0.5rem;
  }

  .filter-bar input,
  .filter-bar select {
    min-width: 0;
    padding: 0.35rem;
  }

  @media (max-width: 640px) {
    .filter-bar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .filter-bar input {
      grid-column: 1 / -1;
    }
  }

  .logic-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .updated {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    font-size: var(--body-sm);
  }

  .updated .material-symbols-outlined {
    font-size: 1em;
  }

  .kind {
    display: inline-flex;
  }

  .kind .material-symbols-outlined {
    font-size: 18px;
  }

  /* The reading is the row's answer; the name, the output and the age are context. */
  .reading {
    font-weight: 500;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  /* "Logic" is short, so the buttons share its line and wrap one by one at their
     own width — the title never drops to a line of its own and no button stretches. */
</style>
