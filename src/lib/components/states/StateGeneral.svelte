<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue, localizeName } from "$lib/config/format";
  import { stateRoles } from "$lib/config/state-settings";
  import { normalizeStates } from "$lib/config/state-meta";
  import { writeStateCommon, writeStateValue } from "$lib/config/state-write";
  import { parseValueText, valueText } from "$lib/config/state-value";
  import { enumLabelFromObject, enumsOf, roomList } from "$lib/config/rooms";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import RoleSelect from "$lib/components/common/RoleSelect.svelte";
  import StateLabelsEditor from "./StateLabelsEditor.svelte";

  const TYPES = [
    "boolean",
    "number",
    "string",
    "mixed",
    "object",
    "array",
    "json",
  ];
  interface Draft {
    name: string;
    type: string;
    role: string;
    unit: string;
    desc: string;
    states: Record<string, string>;
    min: string;
    max: string;
    step: string;
    read: boolean;
    write: boolean;
    rooms: string[];
    functions: string[];
  }

  let {
    id,
    object,
    live,
    onchanged,
  }: {
    id: string;
    object: any;
    live: any;
    onchanged: () => void;
  } = $props();

  const objects = $derived(ioBroker.objects as unknown as Map<string, any>);
  const roomOptions = $derived(
    roomList(ioBroker.enums).map((room) => ({
      value: room.id,
      label: room.label,
      icon: room.icon,
    })),
  );
  const functionOptions = $derived(
    (((ioBroker.enums as any)?.getList("functions") as any[]) ?? []).map(
      (entry: any) => ({
        value: entry._id,
        label: enumLabelFromObject(entry),
      }),
    ),
  );
  const roles = $derived(stateRoles(objects));

  function draftOf(common: Record<string, any>): Draft {
    return {
      name: localizeName(common.name),
      type: String(common.type ?? ""),
      role: String(common.role ?? ""),
      unit: String(common.unit ?? ""),
      desc: String(common.desc ?? ""),
      states: normalizeStates(common.states) ?? {},
      min: common.min === undefined ? "" : String(common.min),
      max: common.max === undefined ? "" : String(common.max),
      step: common.step === undefined ? "" : String(common.step),
      read: common.read !== false,
      write: common.write === true,
      rooms: enumsOf(ioBroker.enums, id, "rooms"),
      functions: enumsOf(ioBroker.enums, id, "functions"),
    };
  }

  // The component is keyed by state id; it intentionally snapshots the object.
  let draft = $state<Draft>(
    untrack(() => draftOf((object?.common ?? {}) as Record<string, any>)),
  );
  let saved = $state<Draft>(untrack(() => ({ ...draft })));
  let busy = $state(false);
  let error = $state("");
  let valueDraft = $state(untrack(() => valueText(live?.val)));
  let valueBool = $state(untrack(() => live?.val === true));
  let valueAck = $state(false);
  let valueBusy = $state(false);
  let valueError = $state("");
  let valueMessage = $state("");
  let valueTouched = false;

  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
  const common = $derived((object?.common ?? {}) as Record<string, any>);
  const managed = $derived<string | undefined>(
    object?.native?.ihomeCollection?.plugin,
  );
  const valueKind = $derived(String(common.type ?? "string").toLowerCase());
  const valueIsBoolean = $derived(valueKind === "boolean");
  const valueIsNumber = $derived(
    valueKind === "number" || valueKind === "multistate",
  );
  const valueIsLong = $derived(
    ["object", "array", "json", "mixed"].includes(valueKind) ||
      common.role === "text.json",
  );
  const valuePreview = $derived.by(() => {
    const text = formatValue(live?.val, common.unit, common.role);
    return text.length > 80 ? `${text.slice(0, 77)}…` : text;
  });

  $effect(() => {
    if (valueTouched) return;
    const next = valueText(live?.val);
    if (next !== valueDraft) valueDraft = next;
    const nextBool = live?.val === true;
    if (nextBool !== valueBool) valueBool = nextBool;
  });

  // The states page does not subscribe every row; load the selected state's
  // value so the editor starts from the broker value, not an empty draft.
  $effect(() => {
    if (live) return;
    void ioBroker.getState(id, true).catch(() => undefined);
  });

  function numberOrNull(text: string): number | null | string {
    const value = text.trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : text;
  }

  function sameList(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((v) => right.includes(v));
  }

  async function applyEnums(
    kind: "rooms" | "functions",
    selected: string[],
  ): Promise<void> {
    const options = kind === "rooms" ? roomOptions : functionOptions;
    const current = enumsOf(ioBroker.enums, id, kind);
    for (const option of options) {
      const want = selected.includes(option.value);
      if (current.includes(option.value) === want) continue;
      const enumObject = (await ioBroker.emitAsync(
        "getObject",
        option.value,
      )) as Record<string, any> | null;
      if (!enumObject) throw new Error(`Enum not found: ${option.value}`);
      const members = Array.isArray(enumObject.common?.members)
        ? enumObject.common.members
        : [];
      const next = want
        ? [...members.filter((member: string) => member !== id), id]
        : members.filter((member: string) => member !== id);
      if (next.length === members.length && want === members.includes(id)) {
        continue;
      }
      await ioBroker.emitAsync("setObject", option.value, {
        ...enumObject,
        common: { ...enumObject.common, members: next },
      });
    }
  }

  async function save(): Promise<void> {
    const name = draft.name.trim();
    if (name !== saved.name && !name) {
      error = "The state name must not be empty.";
      return;
    }
    if (draft.type !== saved.type && !draft.type) {
      error = "Choose a state type.";
      return;
    }
    const min = numberOrNull(draft.min);
    const max = numberOrNull(draft.max);
    const step = numberOrNull(draft.step);
    if (typeof min === "string") {
      error = "Min must be a number.";
      return;
    }
    if (typeof max === "string") {
      error = "Max must be a number.";
      return;
    }
    if (typeof step === "string") {
      error = "Step must be a number.";
      return;
    }
    if (min !== null && max !== null && min > max) {
      error = "Min must not be greater than max.";
      return;
    }
    const statesChanged =
      JSON.stringify(draft.states) !== JSON.stringify(saved.states);
    const patch: Record<string, unknown> = {};
    if (name !== saved.name) patch.name = name;
    if (draft.type !== saved.type) patch.type = draft.type;
    if (draft.role !== saved.role) patch.role = draft.role;
    if (draft.unit !== saved.unit) patch.unit = draft.unit;
    if (draft.desc !== saved.desc) patch.desc = draft.desc;
    if (draft.min !== saved.min) patch.min = min;
    if (draft.max !== saved.max) patch.max = max;
    if (draft.step !== saved.step) patch.step = step;
    if (draft.read !== saved.read) patch.read = draft.read;
    if (draft.write !== saved.write) patch.write = draft.write;
    if (statesChanged) {
      patch.states = Object.keys(draft.states).length ? draft.states : null;
    }
    const roomsChanged = !sameList(draft.rooms, saved.rooms);
    const functionsChanged = !sameList(draft.functions, saved.functions);
    if (Object.keys(patch).length === 0 && !roomsChanged && !functionsChanged) {
      return;
    }
    busy = true;
    error = "";
    try {
      const nextSaved = { ...saved };
      if (Object.keys(patch).length > 0) {
        await writeStateCommon(id, patch);
        Object.assign(nextSaved, {
          name,
          type: draft.type,
          role: draft.role,
          unit: draft.unit,
          desc: draft.desc,
          min: draft.min,
          max: draft.max,
          step: draft.step,
          read: draft.read,
          write: draft.write,
          states: { ...draft.states },
        });
        saved = { ...nextSaved };
      }
      if (roomsChanged) await applyEnums("rooms", draft.rooms);
      if (functionsChanged) {
        await applyEnums("functions", draft.functions);
      }
      nextSaved.rooms = [...draft.rooms];
      nextSaved.functions = [...draft.functions];
      saved = { ...nextSaved };
      onchanged();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  function reset(): void {
    draft = {
      ...saved,
      states: { ...saved.states },
      rooms: [...saved.rooms],
      functions: [...saved.functions],
    };
    error = "";
  }

  function valueChanged(): void {
    valueTouched = true;
    valueError = "";
    valueMessage = "";
  }

  async function writeValue(): Promise<void> {
    valueError = "";
    valueMessage = "";
    let parsed: unknown;
    if (valueIsBoolean) {
      parsed = valueBool;
    } else {
      const result = parseValueText(valueDraft, valueKind);
      if ("error" in result) {
        valueError = result.error;
        return;
      }
      parsed = result.value;
    }
    valueBusy = true;
    try {
      await writeStateValue(id, parsed, valueAck);
      valueTouched = false;
      valueMessage = `Value written with ack=${valueAck}.`;
      void ioBroker.getState(id, true).catch(() => undefined);
    } catch (failure) {
      valueError = failure instanceof Error ? failure.message : String(failure);
    } finally {
      valueBusy = false;
    }
  }
</script>

<div class="state-general">
  <p class="hint text-muted">
    Written to the state object. Most adapters keep these; a managed adapter or
    plugin may overwrite them later.
  </p>
  {#if managed}
    <p class="hint text-muted">
      This state is managed by plugin <span class="mono">{managed}</span>; a
      plugin update may reset these fields.
    </p>
  {/if}

  <div class="form-panel section-panel">
    <div class="grid">
      <label class="field">
        <span class="label-mono">Name</span>
        <input bind:value={draft.name} />
      </label>
      <label class="field">
        <span class="label-mono">Type</span>
        <select bind:value={draft.type}>
          {#each TYPES as type (type)}
            <option value={type}>{type}</option>
          {/each}
          {#if draft.type && !TYPES.includes(draft.type)}
            <option value={draft.type}>{draft.type}</option>
          {/if}
        </select>
      </label>
      <label class="field">
        <span class="label-mono">Role</span>
        <RoleSelect
          value={draft.role}
          options={roles}
          type={draft.type}
          label="Role"
          onchange={(role) => (draft.role = role)}
        />
      </label>
      <label class="field">
        <span class="label-mono">Unit</span>
        <input bind:value={draft.unit} />
      </label>
      <label class="field wide">
        <span class="label-mono">Description</span>
        <input bind:value={draft.desc} />
      </label>
    </div>

    <div class="three">
      <label class="field">
        <span class="label-mono">Min</span>
        <input inputmode="decimal" bind:value={draft.min} />
      </label>
      <label class="field">
        <span class="label-mono">Max</span>
        <input inputmode="decimal" bind:value={draft.max} />
      </label>
      <label class="field">
        <span class="label-mono">Step</span>
        <input inputmode="decimal" bind:value={draft.step} />
      </label>
    </div>

    <div class="grid">
      <label class="field">
        <span class="label-mono">Rooms</span>
        <MultiSelect
          options={roomOptions}
          selected={draft.rooms}
          enums={ioBroker.enums}
          placeholder="No room"
          onChange={(ids) => (draft.rooms = ids)}
        />
      </label>
      <label class="field">
        <span class="label-mono">Functions</span>
        <MultiSelect
          options={functionOptions}
          selected={draft.functions}
          enums={ioBroker.enums}
          placeholder="No function"
          onChange={(ids) => (draft.functions = ids)}
        />
      </label>
      <div class="wide">
        <StateLabelsEditor
          value={draft.states}
          onChange={(next) => (draft.states = next ?? {})}
        />
      </div>
    </div>

    <div class="checks">
      <label class="check">
        <input type="checkbox" bind:checked={draft.read} />
        <span>Read</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={draft.write} />
        <span>Write</span>
      </label>
    </div>

    {#if error}<p class="hint text-danger">{error}</p>{/if}

    <div class="actions">
      <button
        type="button"
        class="btn btn-sm"
        disabled={!dirty || busy}
        onclick={reset}
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
        Cancel
      </button>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!dirty || busy}
        onclick={() => void save()}>{busy ? "Saving…" : "Save"}</button
      >
    </div>
  </div>

  <div class="live-value section-panel">
    <div class="value-row">
      <div class="field value-field">
        <span class="label-mono">Value</span>
        {#if valueIsBoolean}
          <label class="check value-check">
            <input
              type="checkbox"
              aria-label="Value"
              checked={valueBool}
              onchange={(event) => {
                valueChanged();
                valueBool = event.currentTarget.checked;
              }}
            />
            <span>{valueBool ? "true" : "false"}</span>
          </label>
        {:else if valueIsNumber}
          <input
            aria-label="Value"
            inputmode="decimal"
            value={valueDraft}
            oninput={(event) => {
              valueDraft = event.currentTarget.value;
              valueChanged();
            }}
          />
        {:else if valueIsLong}
          <textarea
            class="value-textarea"
            aria-label="Value"
            rows="3"
            spellcheck="false"
            value={valueDraft}
            oninput={(event) => {
              valueDraft = event.currentTarget.value;
              valueChanged();
            }}
          ></textarea>
        {:else}
          <input
            type="text"
            aria-label="Value"
            value={valueDraft}
            oninput={(event) => {
              valueDraft = event.currentTarget.value;
              valueChanged();
            }}
          />
        {/if}
      </div>
      <label class="check ack" title="Write as a confirmed reading (ack=true)">
        <input type="checkbox" bind:checked={valueAck} />
        <span>Ack</span>
      </label>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        title={valueBusy ? "Writing…" : "Write value"}
        aria-label={valueBusy ? "Writing value" : "Write value"}
        disabled={valueBusy}
        onclick={() => void writeValue()}
      >
        <span class="material-symbols-outlined" aria-hidden="true">save</span>
        {valueBusy ? "Writing…" : "Write"}
      </button>
    </div>
    <p class="hint text-muted value-hint">
      Current: {valuePreview}
      {#if live?.from}<span> · {live.from}</span>{/if}
      {#if common.write === false}
        <span class="text-warning"> · Read-only state: use Ack.</span>
      {/if}
    </p>
    {#if valueError}<p class="hint text-danger">{valueError}</p>{/if}
    {#if valueMessage}<p class="hint text-muted">{valueMessage}</p>{/if}
  </div>
</div>

<style>
  .state-general {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }

  .form-panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .live-value {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .value-row {
    display: flex;
    align-items: flex-end;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .value-field {
    flex: 1 1 14rem;
  }

  .value-check {
    align-self: flex-start;
  }

  .value-row .btn .material-symbols-outlined,
  .actions .btn .material-symbols-outlined {
    font-size: 14px;
  }

  .value-textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-code);
    font-size: var(--body-sm);
    resize: vertical;
  }

  .value-hint {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  @media (max-width: 560px) {
    .grid,
    .three {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
