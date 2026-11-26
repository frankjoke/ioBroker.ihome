<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue, localizeName } from "$lib/config/format";
  import { stateRoles } from "$lib/config/state-settings";
  import { writeStateCommon } from "$lib/config/state-write";
  import { enumLabelFromObject, enumsOf, roomList } from "$lib/config/rooms";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";
  import RoleSelect from "$lib/components/common/RoleSelect.svelte";

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
    states: string;
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

  function statesText(value: unknown): string {
    if (!value) return "{}";
    return JSON.stringify(value, null, 2);
  }

  function draftOf(common: Record<string, any>): Draft {
    return {
      name: localizeName(common.name),
      type: String(common.type ?? ""),
      role: String(common.role ?? ""),
      unit: String(common.unit ?? ""),
      desc: String(common.desc ?? ""),
      states: statesText(common.states),
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

  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
  const common = $derived((object?.common ?? {}) as Record<string, any>);
  const managed = $derived<string | undefined>(
    object?.native?.ihomeCollection?.plugin,
  );

  function numberOrNull(text: string): number | null | string {
    const value = text.trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : text;
  }

  function sameList(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((v) => right.includes(v));
  }

  function parseStates(text: string): Record<string, string> | null {
    if (!text.trim()) return null;
    const value: unknown = JSON.parse(text);
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The enums must be a JSON object.");
    }
    const states: Record<string, string> = {};
    for (const [key, label] of Object.entries(value)) {
      if (typeof label !== "string") {
        throw new Error(`The label for ${key} must be text.`);
      }
      states[key] = label;
    }
    return states;
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
    let states: Record<string, string> | null = null;
    const statesChanged = draft.states !== saved.states;
    if (statesChanged) {
      try {
        states = parseStates(draft.states);
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
        return;
      }
    }
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
    if (statesChanged) patch.states = states;
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
          states: draft.states,
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
      rooms: [...saved.rooms],
      functions: [...saved.functions],
    };
    error = "";
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
    <label class="field wide">
      <span class="label-mono">Enums</span>
      <textarea
        class="enums"
        rows="4"
        spellcheck="false"
        bind:value={draft.states}
      ></textarea>
      <span class="hint text-muted">
        Value to label, as a JSON object (for example 0 = Idle, 1 = Busy).
      </span>
    </label>
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

  <div class="footer">
    <dl class="summary">
      <dt>Value</dt>
      <dd class="mono">
        {formatValue(live?.val, common.unit, common.role)}
        {#if live?.from}<span class="text-muted"> · {live.from}</span>{/if}
      </dd>
    </dl>
    <div class="actions">
      <button
        type="button"
        class="btn btn-sm"
        disabled={!dirty || busy}
        onclick={reset}>Reset</button
      >
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={!dirty || busy}
        onclick={() => void save()}>{busy ? "Saving…" : "Save"}</button
      >
    </div>
  </div>
</div>

<style>
  .state-general {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
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

  .enums {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-code);
    font-size: var(--body-sm);
    resize: vertical;
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

  .footer {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    margin-left: auto;
  }

  .summary {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin: 0;
    flex: 1 1 16rem;
    min-width: 0;
  }

  .summary dt {
    color: var(--text-muted);
    font-size: var(--body-sm);
  }

  .summary dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  @media (max-width: 560px) {
    .grid,
    .three {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
