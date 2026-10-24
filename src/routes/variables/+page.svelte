<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    getVariables,
    upsertVariable,
    deleteVariable,
  } from "$lib/stores/variables.svelte";
  import { applyVariable, saveVariables } from "$lib/variables.svelte.js";
  import {
    buildStateId,
    convertValue,
    isIhomeNamespace,
    nameTaken,
    namespaceOptions,
    relativeIdFor,
    reservedName,
    restrictName,
    splitStateId,
    validName,
    validStateId,
    type GlobalVariable,
  } from "$lib/config/variables";
  import { formatValue } from "$lib/config/format";
  import { collectStates } from "$lib/config/state-tree";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import StatePicker from "$lib/components/discovery/StatePicker.svelte";
  import {
    enumLabelFromObject,
    roomList,
    roomsOf as roomsOfEnum,
  } from "$lib/config/rooms";

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const variables = $derived(getVariables());
  const namespaces = $derived(namespaceOptions(objects, ioBroker.namespace));

  let editing = $state<GlobalVariable | null>(null);
  let showForm = $state(false);
  let picking = $state(false);
  let formError = $state("");
  let stateMode = $state<"existing" | "new">("new");
  let namespace = $state("ihome.0");
  /** The relative id for every namespace but iHome's own; iHome instances use
   *  `leaf` under the fixed `Variables.` prefix. */
  let relative = $state("");
  let leaf = $state("");
  let pendingDelete = $state<GlobalVariable | null>(null);
  let search = $state("");
  let sortBy = $state<"name" | "kind">("name");
  let sortDir = $state<"asc" | "desc">("asc");

  const shown = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? variables.filter(
          (v) =>
            v.name.toLowerCase().includes(q) ||
            (v.stateId ?? "").toLowerCase().includes(q) ||
            (v.value ?? "").toLowerCase().includes(q),
        )
      : [...variables];
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (v: GlobalVariable) =>
      sortBy === "name" ? v.name : v.kind === "constant" ? "constant" : "state";
    return list.sort((a, b) => dir * key(a).localeCompare(key(b)));
  });

  const rooms = $derived(roomList(ioBroker.enums));
  function roomsOf(id: string): string[] {
    return roomsOfEnum(ioBroker.enums, id);
  }

  /** Role suggestions: what the broker already carries, plus the usual ones. */
  const ROLE_SEED = [
    "value",
    "value.temperature",
    "value.humidity",
    "value.power",
    "switch",
    "level.dimmer",
    "indicator",
    "text",
  ];
  const roleOptions = $derived(
    [
      ...new Set([
        ...ROLE_SEED,
        ...collectStates(objects)
          .map((s) => String(s.obj?.common?.role ?? ""))
          .filter(Boolean),
      ]),
    ].sort(),
  );

  const roomOptions = $derived(
    rooms.map((r) => ({ value: r.id, label: r.label, icon: r.icon })),
  );
  const functionOptions = $derived(
    (((ioBroker.enums as any)?.getList("functions") as any[]) ?? []).map(
      (e: any) => ({ value: e._id, label: enumLabelFromObject(e) }),
    ),
  );

  const enumRooms = $derived(
    (editing?.enums ?? []).filter((e) => e.startsWith("enum.rooms.")),
  );
  const enumFunctions = $derived(
    (editing?.enums ?? []).filter((e) => e.startsWith("enum.functions.")),
  );

  /** The name is the reference, so it is kept id-safe while it is typed. */
  function setEditingName(raw: string) {
    if (!editing) return;
    editing.name = restrictName(raw);
    formError = "";
  }

  /** One MultiSelect's pick replaces only its own enum kind. */
  function setEnumPart(kind: "rooms" | "functions", ids: string[]) {
    if (!editing) return;
    const keep = (editing.enums ?? []).filter(
      (e) => !e.startsWith(`enum.${kind}.`),
    );
    editing.enums = [...keep, ...ids];
  }

  /** Input text as a number; empty stays "not set". */
  function numberOrUndefined(value: string): number | undefined {
    return value.trim() === "" ? undefined : Number(value);
  }

  /** iHome's own instance: the state must go to its Variables folder, so no
   *  other iHome object (the config documents, …) can be overwritten. */
  const ihomeNamespace = $derived(isIhomeNamespace(namespace));
  const effectiveRelative = $derived(
    ihomeNamespace ? relativeIdFor(namespace, leaf) : relative,
  );

  /** The id a "new state" form would build, for the preview line. */
  const previewId = $derived(buildStateId(namespace, effectiveRelative));
  const previewExists = $derived(!!previewId && objects.has(previewId));

  const VALUE_TYPES = ["string", "number", "boolean"];

  /** Known to exist: the object cache holds it, or its value was fetched. A
   *  state outside `ihome.0` may never enter the object cache. */
  function stateExists(id: string | undefined): boolean {
    return !!id && (objects.has(id) || ioBroker.states.has(id));
  }

  /** A state variable's current value, or why it has none. */
  function stateLabel(v: GlobalVariable): string {
    if (!v.stateId) return "no state";
    if (!stateExists(v.stateId)) return "missing";
    const st: any = ioBroker.states.get(v.stateId);
    if (!st) return "…";
    const unit = v.unit || objects.get(v.stateId)?.common?.unit;
    return formatValue(st.value, unit);
  }

  function startAdd() {
    editing = {
      id: newId(),
      name: "",
      kind: "constant",
      type: "string",
      value: "",
    };
    formError = "";
    stateMode = "new";
    namespace = ioBroker.namespace || "ihome.0";
    relative = "";
    leaf = "";
    showForm = true;
  }

  function startEdit(v: GlobalVariable) {
    editing = { ...v };
    formError = "";
    if (v.kind === "state" && stateExists(v.stateId)) {
      stateMode = "existing";
    } else {
      stateMode = "new";
      const split = splitStateId(v.stateId ?? "");
      namespace = split.namespace || ioBroker.namespace || "ihome.0";
      relative = split.relative;
      leaf = split.relative.replace(/^Variables\./, "");
    }
    showForm = true;
  }

  /** Switching namespace keeps what was typed: the leaf follows the prefix. */
  function setNamespace(ns: string) {
    if (ihomeNamespace && !isIhomeNamespace(ns))
      relative = relativeIdFor(namespace, leaf);
    if (isIhomeNamespace(ns) && !ihomeNamespace)
      leaf = relative.replace(/^Variables\./, "");
    namespace = ns;
  }

  /** A picked state brings its own type and (empty) unit along. */
  function pickState(id: string) {
    if (!editing || !id) return;
    editing.stateId = id;
    editing.type = String(objects.get(id)?.common?.type ?? "mixed");
    if (!editing.unit)
      editing.unit = String(objects.get(id)?.common?.unit ?? "");
    stateMode = "existing";
    picking = false;
  }

  /** Keep the type valid for the control the form currently shows. */
  function switchKind(kind: string) {
    if (!editing) return;
    editing.kind = kind === "state" ? "state" : "constant";
    if (!VALUE_TYPES.includes(editing.type)) editing.type = "string";
  }

  function setStateMode(mode: "existing" | "new") {
    stateMode = mode;
    if (editing && !VALUE_TYPES.includes(editing.type)) editing.type = "string";
  }

  async function save() {
    if (!editing) return;
    const v: GlobalVariable = { ...editing, name: editing.name.trim() };
    if (!validName(v.name)) {
      formError = "Give the variable a name (letters, digits, underscore).";
      return;
    }
    if (reservedName(v.name)) {
      formError = `"${v.name}" belongs to the expression engine — pick another name.`;
      return;
    }
    if (nameTaken(getVariables(), v.name, editing.id)) {
      formError = `Another variable is already called "${v.name}".`;
      return;
    }
    if (v.kind === "constant") {
      const r = convertValue(v.value ?? "", v.type);
      if (r.error) {
        formError = r.error;
        return;
      }
      v.value = String(r.value);
      v.stateId = undefined;
    } else {
      if (stateMode === "new")
        v.stateId = buildStateId(namespace, effectiveRelative);
      if (!v.stateId || !validStateId(v.stateId)) {
        formError = "Enter a state id like ihome.0.Variables.name.";
        return;
      }
      v.value = undefined;
    }
    upsertVariable(v);
    saveVariables();
    const err = await applyVariable(v);
    if (err) {
      formError = err;
      return;
    }
    showForm = false;
    editing = null;
  }

  function confirmDelete() {
    if (pendingDelete) {
      deleteVariable(pendingDelete.id);
      saveVariables();
    }
    pendingDelete = null;
  }
</script>

<svelte:head>
  <title>Global Variables - iHome</title>
</svelte:head>

<div class="variables-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>Global Variables</h1>
    </div>
    <div class="page-actions">
      <button
        type="button"
        class="icon-btn primary"
        title="Add variable"
        aria-label="Add variable"
        disabled={showForm}
        onclick={startAdd}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>
  </div>

  <p class="text-muted hint">
    Constants live only in iHome. A state variable names one ioBroker state — in <code
      >ihome.0.Variables</code
    >
    or anywhere else, e.g.
    <code>0_userdata.0</code>. New states are created when you save.
  </p>

  {#if variables.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No variables yet — add one to get started.</p>
    </div>
  {:else}
    <div class="filter-bar">
      <input
        type="search"
        placeholder="Search name, value or state…"
        bind:value={search}
      />
      <select bind:value={sortBy} aria-label="Sort by">
        <option value="name">Name</option>
        <option value="kind">Constant / state</option>
      </select>
      <button
        type="button"
        class="sort-dir"
        title="Toggle sort direction"
        aria-label="Toggle sort direction"
        onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
      >
        <span class="material-symbols-outlined"
          >{sortDir === "asc" ? "arrow_upward" : "arrow_downward"}</span
        >
      </button>
    </div>

    {#if shown.length === 0}
      <div class="card empty-state">
        <p class="text-muted">No variables match the search.</p>
      </div>
    {/if}

    <div class="var-list">
      {#each shown as v (v.id)}
        <div class="card var-row">
          <div class="var-main">
            <span class="var-title">
              <span class="var-name">{v.name}</span>
              <span class="badge badge-secondary"
                >{v.kind === "constant" ? "constant" : "state"}</span
              >
              {#if v.unit}<span class="text-muted">{v.unit}</span>{/if}
            </span>
            {#if v.kind === "constant"}
              <code class="var-value">{v.value}</code>
            {:else}
              <code class="var-value">{v.stateId ?? "no state"}</code>
              <span class="var-live" class:missing={!stateExists(v.stateId)}
                >{stateLabel(v)}</span
              >
            {/if}
            {#if v.notes}<span class="hint text-muted">{v.notes}</span>{/if}
          </div>
          <div class="var-actions">
            <button
              type="button"
              class="icon-btn"
              title="Edit"
              aria-label="Edit"
              onclick={() => startEdit(v)}
            >
              <span class="material-symbols-outlined">edit</span>
            </button>
            <button
              type="button"
              class="icon-btn danger"
              title="Remove"
              aria-label="Remove"
              onclick={() => (pendingDelete = v)}
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if showForm && editing}
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Global variable"
    >
      <div class="modal-card card">
        <h3>{editing.name ? "Edit variable" : "New variable"}</h3>

        <label class="field"
          ><span class="label-mono">Name</span>
          <input
            type="text"
            value={editing.name}
            oninput={(e) => setEditingName(e.currentTarget.value)}
          /></label
        >
        <p class="hint text-muted">
          No dots or spaces — the name <em>is</em> the reference, e.g. in a
          formula. <code>sum</code>, <code>get</code> and <code>active</code> are
          taken.
        </p>

        <label class="field"
          ><span class="label-mono">Type</span>
          <select
            value={editing.kind}
            onchange={(e) => switchKind(e.currentTarget.value)}
          >
            <option value="constant">Constant — kept in iHome</option>
            <option value="state">State — an ioBroker state</option>
          </select></label
        >

        {#if editing.kind === "constant"}
          <div class="form-grid">
            <label class="field"
              ><span class="label-mono">Value</span>
              <input type="text" bind:value={editing.value} /></label
            >
            <label class="field"
              ><span class="label-mono">Value type</span>
              <select bind:value={editing.type}>
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">True / false</option>
              </select></label
            >
          </div>
          <p class="hint text-muted">
            A constant stays here — no ioBroker state is created.
          </p>
        {:else}
          <div class="seg">
            <label class="check">
              <input
                type="radio"
                name="state-mode"
                checked={stateMode === "existing"}
                onchange={() => setStateMode("existing")}
              />
              <span>Existing state</span>
            </label>
            <label class="check">
              <input
                type="radio"
                name="state-mode"
                checked={stateMode === "new"}
                onchange={() => setStateMode("new")}
              />
              <span>New state</span>
            </label>
          </div>

          {#if stateMode === "existing"}
            <div class="state-row">
              <code class="var-value"
                >{editing.stateId || "no state chosen"}</code
              >
              <button
                type="button"
                class="btn btn-outline"
                onclick={() => (picking = true)}>Choose…</button
              >
            </div>
            {#if editing.stateId && !stateExists(editing.stateId)}
              <p class="hint error">
                That state does not exist — choose another one, or create it as
                a new state.
              </p>
            {/if}
          {:else}
            <div class="form-grid">
              <label class="field"
                ><span class="label-mono">Namespace</span>
                <select
                  value={namespace}
                  onchange={(e) => setNamespace(e.currentTarget.value)}
                >
                  {#each namespaces as ns (ns)}
                    <option value={ns}>{ns}</option>
                  {/each}
                </select></label
              >
              {#if ihomeNamespace}
                <label class="field"
                  ><span class="label-mono">State name</span>
                  <span class="prefix-row">
                    <code class="prefix">Variables.</code>
                    <input
                      type="text"
                      bind:value={leaf}
                      placeholder="myValue"
                    />
                  </span></label
                >
              {:else}
                <label class="field"
                  ><span class="label-mono">Relative id</span>
                  <input
                    type="text"
                    bind:value={relative}
                    placeholder="myValue"
                  /></label
                >
              {/if}
            </div>
            <label class="field narrow"
              ><span class="label-mono">Value type</span>
              <select bind:value={editing.type}>
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">True / false</option>
              </select></label
            >

            <label class="field"
              ><span class="label-mono">Role</span>
              <input
                type="text"
                list="ihome-state-roles"
                bind:value={editing.role}
                placeholder="value"
              /></label
            >
            <datalist id="ihome-state-roles">
              {#each roleOptions as r (r)}
                <option value={r}></option>
              {/each}
            </datalist>

            {#if editing.type === "number"}
              <div class="form-grid three">
                <label class="field"
                  ><span class="label-mono">Min</span>
                  <input
                    type="number"
                    value={editing.min ?? ""}
                    oninput={(e) =>
                      (editing.min = numberOrUndefined(e.currentTarget.value))}
                  /></label
                >
                <label class="field"
                  ><span class="label-mono">Max</span>
                  <input
                    type="number"
                    value={editing.max ?? ""}
                    oninput={(e) =>
                      (editing.max = numberOrUndefined(e.currentTarget.value))}
                  /></label
                >
                <label class="field"
                  ><span class="label-mono">Step</span>
                  <input
                    type="number"
                    value={editing.step ?? ""}
                    oninput={(e) =>
                      (editing.step = numberOrUndefined(e.currentTarget.value))}
                  /></label
                >
              </div>
            {/if}

            <div class="form-grid">
              <label class="field"
                ><span class="label-mono">Rooms</span>
                <MultiSelect
                  options={roomOptions}
                  selected={enumRooms}
                  enums={ioBroker.enums}
                  placeholder="No room"
                  onChange={(ids) => setEnumPart("rooms", ids)}
                /></label
              >
              <label class="field"
                ><span class="label-mono">Functions</span>
                <MultiSelect
                  options={functionOptions}
                  selected={enumFunctions}
                  enums={ioBroker.enums}
                  placeholder="No function"
                  onChange={(ids) => setEnumPart("functions", ids)}
                /></label
              >
            </div>

            <p class="hint text-muted">
              {#if previewExists}
                <code>{previewId}</code> already exists — it is used as it is.
              {:else if previewId}
                <code>{previewId}</code> is created when you save.
              {/if}
              {#if ihomeNamespace}
                iHome states live in <code>{ioBroker.namespace}</code>.<code
                  >Variables</code
                >, so nothing else of this adapter can be overwritten.
              {:else}
                States under <code>ihome.0</code> disappear if the adapter is
                removed; put it elsewhere (e.g. <code>0_userdata.0</code>) to
                keep it.
              {/if}
            </p>
          {/if}
        {/if}

        <div class="form-grid">
          <label class="field"
            ><span class="label-mono">Unit</span>
            <input type="text" bind:value={editing.unit} /></label
          >
          <label class="field"
            ><span class="label-mono">Notes</span>
            <input type="text" bind:value={editing.notes} /></label
          >
        </div>

        {#if formError}
          <p class="hint error">{formError}</p>
        {/if}

        <div class="actions">
          <button
            type="button"
            class="btn"
            onclick={() => {
              showForm = false;
              editing = null;
            }}>Cancel</button
          >
          <button type="button" class="btn btn-primary" onclick={save}
            >Save</button
          >
        </div>
      </div>
    </div>
  {/if}

  {#if picking}
    <StatePicker
      deviceType="Value"
      {objects}
      {rooms}
      {roomsOf}
      enums={ioBroker.enums}
      mode="replace"
      onAdd={(controls) => pickState(controls[0]?.stateId ?? "")}
      onClose={() => (picking = false)}
    />
  {/if}

  {#if pendingDelete}
    <ConfirmModal
      title={pendingDelete.kind === "state"
        ? "Remove variable"
        : "Delete constant"}
      confirmLabel="Remove"
      onConfirm={confirmDelete}
      onCancel={() => (pendingDelete = null)}
    >
      <p>
        Remove <strong>{pendingDelete.name}</strong> from the variable list?
      </p>
      {#if pendingDelete.kind === "state" && pendingDelete.stateId}
        <p class="text-muted">
          The ioBroker state <code>{pendingDelete.stateId}</code> is left in place.
        </p>
      {/if}
    </ConfirmModal>
  {/if}
</div>

<style>
  .variables-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 640px;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-header h1 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .hint {
    font-size: var(--body-sm);
  }

  .error {
    color: var(--danger-color, #c0392b);
    margin: 0;
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 2fr 1fr auto;
    gap: 0.5rem;
  }

  .filter-bar input,
  .filter-bar select {
    min-width: 0;
    padding: 0.35rem;
  }

  .sort-dir {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .sort-dir:hover {
    background: var(--surface-container);
  }

  .sort-dir .material-symbols-outlined {
    font-size: 18px;
  }

  .var-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .var-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    flex-wrap: wrap;
  }

  .var-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .var-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .var-name {
    font-weight: 600;
  }

  .var-value {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .var-live {
    font-size: var(--body-sm);
  }

  .var-live.missing {
    color: var(--warning-color);
  }

  .var-actions {
    display: flex;
    gap: 0.35rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill, 999px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .icon-btn:hover {
    background: var(--surface-container);
  }

  .icon-btn .material-symbols-outlined {
    font-size: 20px;
  }

  .icon-btn.primary {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--on-primary);
  }

  .icon-btn.primary:hover {
    background: var(--primary-dark);
    border-color: var(--primary-dark);
  }

  .icon-btn.danger:hover {
    background: var(--danger-color, #c0392b);
    border-color: var(--danger-color, #c0392b);
    color: #fff;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }

  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 900;
    padding: 1rem;
  }

  .modal-card {
    width: min(560px, 100%);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-height: 90vh;
    overflow-y: auto;
  }

  .modal-card h3 {
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .field.narrow {
    max-width: 14rem;
  }

  .field input {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .seg {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .state-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  /* The fixed `Variables.` prefix of an iHome state: visible, not editable. */
  .prefix-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .prefix-row input {
    min-width: 0;
  }

  .prefix {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .form-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .form-grid.three {
    grid-template-columns: 1fr 1fr 1fr;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
