<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    roomList,
    roomsOf as roomsOfEnum,
    enumLabelFromObject,
  } from "$lib/config/rooms";
  import { effectiveFunctions, effectiveRoom } from "$lib/config/state-meta";
  import StateBrowser from "$lib/components/discovery/StateBrowser.svelte";
  import DeviceForm from "$lib/components/config/DeviceForm.svelte";
  import {
    slotFromControl,
    slotFromState,
    slotKindForWidget,
    suggestedSlots,
  } from "$lib/config/slot-create";
  import { resolveTemplate } from "$lib/config/template-ops";
  import { widgetForState } from "$lib/config/slot-source";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { stateIdFor } from "$lib/config/variables";
  import { localizeName } from "$lib/config/format";
  import { suggestFeature, roleLabel } from "$lib/config/features";
  import { defaultUnit } from "$lib/config/units";
  import { newId } from "$lib/utils/ids";
  import type { Control, Device, DeviceType } from "$lib/types/device";
  import type {
    Slot,
    SlotKind,
    SlotSource,
    Template,
  } from "$lib/types/display";

  /** What the caller does with the picked data — the only difference between
   *  the source selector, slot addition, device controls and Variables. */
  export type PickerMode = "slot" | "source" | "control" | "state";

  let {
    mode,
    title,
    devices = [],
    templates = [],
    slots = [],
    deviceType = "Custom",
    single = false,
    onSlots,
    onSource,
    onControls,
    onState,
    onSaveDevice,
    onClose,
  }: {
    mode: PickerMode;
    title: string;
    devices?: Device[];
    templates?: Template[];
    /** A tile's slots: its own sources are offered first, then the unused
     *  controls of the devices those slots name. */
    slots?: Slot[];
    /** control mode: the feature suggestion type of the device being edited. */
    deviceType?: DeviceType;
    /** control mode: picking replaces one state instead of adding. */
    single?: boolean;
    onSlots?: (slots: Slot[]) => void;
    onSource?: (source: SlotSource) => void;
    onControls?: (controls: Control[]) => void;
    onState?: (stateId: string) => void;
    /** Persist a device created here; the picker then selects it. */
    onSaveDevice?: (device: Device) => void;
    onClose: () => void;
  } = $props();

  type Tab = "device" | "state" | "page" | "badge" | "html";

  const TABS: Record<PickerMode, { id: Tab; label: string }[]> = {
    slot: [
      { id: "device", label: "From device" },
      { id: "state", label: "Any state" },
      { id: "page", label: "Web page" },
      { id: "badge", label: "Badge" },
      { id: "html", label: "HTML" },
    ],
    source: [
      { id: "device", label: "From device" },
      { id: "state", label: "Any state" },
    ],
    control: [
      { id: "device", label: "From device" },
      { id: "state", label: "Any state" },
    ],
    state: [{ id: "state", label: "Any state" }],
  };
  const tabs = $derived(TABS[mode]);

  let tab = $state<Tab>(untrack(() => (mode === "state" ? "state" : "device")));
  let search = $state("");
  let selectedDeviceId = $state("");
  /** Slot mode: the controls of the shown device, ticked for "Add N slots". */
  let selectedControls = new SvelteSet<string>();
  /** Control mode: picked states across the device and the tree. */
  let pickedStates = new SvelteSet<string>();
  const pickedControls = new SvelteMap<string, Control>();
  let stateKind = $state<"auto" | SlotKind>("auto");
  let url = $state("");
  let html = $state("");
  let badgeKind = $state<"value" | "ago" | "offline">("value");
  let badgeControlId = $state("");
  /** A badge may read any state, not only a control of the chosen device. */
  let badgeState = $state("");
  let creatingDevice = $state(false);
  /** A device saved in this picker before the store's list caught up. */
  let createdDevice = $state<Device | null>(null);

  const objects = $derived(ioBroker.objects as Map<string, any>);
  const rooms = $derived(roomList(ioBroker.enums));
  const roomsOf = (id: string) => roomsOfEnum(ioBroker.enums, id);

  const allDevices = $derived(
    createdDevice && !devices.some((d) => d.id === createdDevice.id)
      ? [...devices, createdDevice]
      : devices,
  );
  // The device picker's filters: name/control text, room and function. They
  // widen the match to the device's controls, so a device is found by what it
  // actually offers (a 200-device installation needs this).
  let deviceRoom = $state("");
  let deviceFunction = $state("");
  const deviceFunctionOptions = $derived(
    (ioBroker.enums?.getList?.("functions") ?? []).map((e: any) => ({
      value: e._id,
      label: enumLabelFromObject(e),
    })),
  );
  const filtered = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return allDevices.filter((d) => {
      if (q) {
        const text = [
          d.name,
          d.title,
          d.type,
          ...(d.controls ?? []).flatMap((c) => [c.label, c.feature, c.stateId]),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      const controls = (d.controls ?? []).filter((c) => !c.hidden);
      const objectOf = (c: Control) => objectForState(c.stateId ?? "");
      if (
        deviceRoom &&
        !(
          d.room === deviceRoom ||
          controls.some(
            (c) =>
              effectiveRoom(c, objectOf(c), d.room, ioBroker.enums) ===
              deviceRoom,
          )
        )
      ) {
        return false;
      }
      if (
        deviceFunction &&
        !(
          d.functions?.includes(deviceFunction) ||
          controls.some((c) =>
            effectiveFunctions(
              c,
              objectOf(c),
              d.functions,
              ioBroker.enums,
            ).includes(deviceFunction),
          )
        )
      ) {
        return false;
      }
      return true;
    });
  });
  const selectedDevice = $derived(
    allDevices.find((d) => d.id === selectedDeviceId),
  );
  const controls = $derived(
    (selectedDevice?.controls ?? []).filter((c) => !c.hidden),
  );
  const suggestions = $derived(
    selectedDevice
      ? suggestedSlots(
          selectedDevice,
          resolveTemplate(selectedDevice, templates).slots,
        )
      : [],
  );

  /** A tree leaf may be a variable name; its metadata is the real state's
   *  object, while the slot keeps the name (the alias resolves it live). */
  function objectForState(id: string): any {
    const variable = getVariables().find(
      (v) => v.kind === "state" && v.name === id,
    );
    const realId = variable?.stateId ? String(variable.stateId) : id;
    return (
      objects.get(realId) ??
      (variable
        ? {
            common: {
              name: variable.name,
              type: variable.type,
              role: variable.role,
              unit: variable.unit,
              write: false,
            },
          }
        : undefined)
    );
  }

  function stateSource(id: string): SlotSource {
    return { kind: "state", stateId: id };
  }

  /** Slot sources on this tile first, then the unused controls of the devices
   *  those slots name — the source picker's shortcut list. */
  const scopedSources = $derived.by(() => {
    if ((mode !== "slot" && mode !== "source") || slots.length === 0)
      return undefined;
    const used: {
      key: string;
      label: string;
      title?: string;
      source: SlotSource;
      kind: SlotKind;
    }[] = [];
    const seen = new SvelteSet<string>();
    const deviceIds: string[] = [];
    const addUsed = (
      source: SlotSource,
      stateId: string | undefined,
      label: string,
      kind: SlotKind,
    ) => {
      const key = stateId ?? JSON.stringify(source);
      if (seen.has(key)) return;
      seen.add(key);
      used.push({ key, label, title: stateId, source, kind });
    };
    for (const slot of slots) {
      const source = slot.source;
      if (!source || typeof source === "string") continue;
      if (source.kind === "state") {
        const id = stateIdFor(source.stateId, getVariables());
        const name = localizeName(objects.get(id)?.common?.name);
        addUsed(source, id, name || id, slot.kind);
        continue;
      }
      if (!deviceIds.includes(source.device)) deviceIds.push(source.device);
      if (source.kind !== "control") continue;
      const owner = allDevices.find((d) => d.id === source.device);
      const control = owner?.controls?.find((c) => c.id === source.control);
      const label = control?.label || control?.feature || source.control;
      addUsed(
        source,
        control?.stateId,
        owner ? `${owner.name || owner.id}.${label}` : label,
        slot.kind,
      );
    }
    const more = deviceIds
      .map((id) => allDevices.find((d) => d.id === id))
      .filter((d): d is Device => !!d)
      .map((d) => ({
        device: d,
        controls: (d.controls ?? []).filter(
          (c) => !c.hidden && !(c.stateId && seen.has(c.stateId)),
        ),
      }))
      .filter((group) => group.controls.length > 0);
    return { used, more };
  });

  function chooseDevice(id: string): void {
    selectedDeviceId = selectedDeviceId === id ? "" : id;
    selectedControls.clear();
    badgeControlId = "";
  }

  function toggleControl(id: string): void {
    if (selectedControls.has(id)) selectedControls.delete(id);
    else selectedControls.add(id);
  }

  function addControl(c: Control): void {
    if (!selectedDevice) return;
    onSlots?.([slotFromControl(selectedDevice, c)]);
  }

  function addSelected(): void {
    if (!selectedDevice) return;
    const list = controls
      .filter((c) => selectedControls.has(c.id))
      .map((c) => slotFromControl(selectedDevice!, c));
    if (list.length) onSlots?.(list);
  }

  function addSuggested(): void {
    if (suggestions.length) onSlots?.(suggestions);
  }

  function pickState(id: string): void {
    const object = objectForState(id);
    const kind =
      stateKind === "auto"
        ? slotKindForWidget(widgetForState(object))
        : stateKind;
    onSlots?.([slotFromState(id, object, kind)]);
  }

  /** One click on a tree leaf: add a slot, set a source, add a control, or
   *  hand a state to the Variables page. */
  function pickRawState(id: string): void {
    if (mode === "slot") pickState(id);
    else if (mode === "source") onSource?.(stateSource(id));
    else if (mode === "state") onState?.(id);
    else togglePickedState(id);
  }

  /** Control mode: a picked state becomes a control on the edited device. */
  function controlFromState(id: string): Control {
    const variable = getVariables().find(
      (v) => v.kind === "state" && v.name === id,
    );
    const realId = variable?.stateId ? String(variable.stateId) : id;
    const obj =
      objects.get(realId) ??
      (variable
        ? {
            common: {
              name: variable.name,
              type: variable.type,
              role: variable.role,
              unit: variable.unit,
              write: false,
            },
          }
        : undefined);
    return {
      id: newId(),
      feature: suggestFeature(obj, deviceType) ?? "value",
      stateId: id,
      writable: !!obj?.common?.write,
      label: variable ? id : roleLabel(obj),
      unit: defaultUnit(obj),
    };
  }

  function togglePickedState(id: string): void {
    if (single) {
      pickedStates.clear();
      pickedControls.clear();
    }
    if (pickedStates.has(id)) {
      pickedStates.delete(id);
      pickedControls.delete(id);
      return;
    }
    pickedStates.add(id);
    pickedControls.delete(id);
  }

  function toggleDeviceState(c: Control): void {
    const key = c.stateId ?? c.id;
    if (single) {
      pickedStates.clear();
      pickedControls.clear();
    }
    if (pickedStates.has(key)) {
      pickedStates.delete(key);
      pickedControls.delete(key);
      return;
    }
    pickedStates.add(key);
    pickedControls.set(key, { ...c, id: newId() });
  }

  function addPicked(): void {
    const list = [...pickedStates].map(
      (id) => pickedControls.get(id) ?? controlFromState(id),
    );
    if (list.length) onControls?.(list);
  }

  /** A scoped chip: the source itself (source mode) or a slot from it. */
  function useSource(source: SlotSource, kind?: SlotKind): void {
    if (mode === "source") {
      onSource?.(source);
      return;
    }
    if (mode !== "slot") return;
    let slot: Slot | null = null;
    if (source.kind === "state") {
      const object = objectForState(source.stateId);
      slot = slotFromState(
        source.stateId,
        object,
        kind ?? slotKindForWidget(widgetForState(object)),
      );
    } else if (source.kind === "control") {
      const device = allDevices.find((d) => d.id === source.device);
      const control = device?.controls?.find((c) => c.id === source.control);
      if (device && control) {
        slot = {
          ...slotFromControl(device, control),
          ...(kind ? { kind } : {}),
        };
      }
    }
    if (slot) onSlots?.([slot]);
  }

  function pickDeviceControl(device: Device, c: Control): void {
    onSource?.({ kind: "control", device: device.id, control: c.id });
  }

  /** A frame slot (A38): the page it shows is its whole content. */
  function addPage(): void {
    const text = url.trim();
    if (text) onSlots?.([{ kind: "frame", options: { url: text } }]);
  }

  /** A local HTML document: detail-only by default, full scripts and styles. */
  function addHtml(): void {
    if (!html.trim()) return;
    onSlots?.([{ kind: "html", where: "modal", options: { html: html } }]);
  }

  /** A badge reads a control (value or time since), or the device itself. */
  function addBadge(): void {
    const device = selectedDevice;
    if (!device) return;
    if (badgeKind === "offline") {
      onSlots?.([
        { kind: "badge", source: { kind: "device", device: device.id } },
      ]);
      return;
    }
    const stateId = badgeState.trim();
    if (stateId) {
      const base = slotFromState(stateId, objectForState(stateId), "badge");
      onSlots?.([
        {
          ...base,
          ...(badgeKind === "ago"
            ? {
                options: { ...(base.options ?? {}), derive: "ago", from: "ts" },
              }
            : {}),
        },
      ]);
      return;
    }
    const control = controls.find((c) => c.id === badgeControlId);
    if (!control) return;
    const base = slotFromControl(device, control);
    onSlots?.([
      {
        ...base,
        kind: "badge",
        ...(badgeKind === "ago"
          ? { options: { derive: "ago", from: "ts" } }
          : {}),
      },
    ]);
  }

  function saveDevice(d: Device): void {
    onSaveDevice?.(d);
    createdDevice = d;
    selectedDeviceId = d.id;
    selectedControls.clear();
    creatingDevice = false;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" && !creatingDevice) onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label={title}>
  <div class="modal-content">
    <div class="modal-head">
      <h3>{title}</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    {#if tabs.length > 1}
      <div class="tabs" role="tablist">
        {#each tabs as t (t.id)}
          <button
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            class="tab"
            class:active={tab === t.id}
            onclick={() => (tab = t.id)}>{t.label}</button
          >
        {/each}
        {#if mode === "slot" && tab === "state"}
          <label class="kind">
            <span class="label-mono">Kind</span>
            <select
              value={stateKind}
              onchange={(e) =>
                (stateKind = e.currentTarget.value as "auto" | SlotKind)}
            >
              <option value="auto">auto</option>
              <option value="value">value</option>
              <option value="level">level</option>
              <option value="switch">switch</option>
              <option value="color">color</option>
              <option value="enum">enum</option>
              <option value="button">button</option>
            </select>
          </label>
        {/if}
      </div>
    {/if}

    {#if tab === "state"}
      {#if mode === "control"}
        <StateBrowser
          {objects}
          {roomsOf}
          {rooms}
          enums={ioBroker.enums}
          selection={pickedStates}
          onToggle={togglePickedState}
        />
      {:else}
        <StateBrowser
          {objects}
          {roomsOf}
          {rooms}
          enums={ioBroker.enums}
          onPick={pickRawState}
        />
      {/if}
    {:else if tab === "page"}
      <div class="placeholder">
        <div class="row-input">
          <input
            type="text"
            placeholder="http://…/echarts/index.html?preset=…"
            bind:value={url}
          />
          <button
            type="button"
            class="btn btn-primary"
            disabled={!url.trim()}
            onclick={addPage}>Add page</button
          >
        </div>
        <p class="text-muted hint-note">
          The page loads in a frame (A38) — the tile's own space, or the modal's
          wide row, as this slot's destination says.
        </p>
      </div>
    {:else if tab === "html"}
      <div class="placeholder">
        <label class="small grow">
          <span class="label-mono">HTML</span>
          <textarea
            class="html-input"
            rows="10"
            bind:value={html}
            placeholder="<!doctype html>…"
          ></textarea>
        </label>
        <div class="actions">
          <span class="text-muted">
            Runs as a local document in a frame; detail page only by default.
            &#123;&#123;NAME&#125;&#125; placeholders and ihome.setState(…) work
            in it.
          </span>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!html.trim()}
            onclick={addHtml}>Add HTML slot</button
          >
        </div>
      </div>
    {:else}
      {#if tab === "device" && scopedSources}
        <div class="device-sources">
          {#if scopedSources.used.length}
            <span class="device-sources-label">Used in this tile</span>
            <div class="device-sources-list">
              {#each scopedSources.used as u (u.key)}
                <button
                  type="button"
                  class="device-source"
                  title={u.title}
                  onclick={() => useSource(u.source, u.kind)}
                >
                  {u.label}
                </button>
              {/each}
            </div>
          {/if}
          {#each scopedSources.more as group (group.device.id)}
            <span class="device-sources-label"
              >{group.device.name || group.device.id}</span
            >
            <div class="device-sources-list">
              {#each group.controls as c (c.id)}
                <button
                  type="button"
                  class="device-source"
                  title={c.stateId ?? c.feature}
                  onclick={() =>
                    useSource({
                      kind: "control",
                      device: group.device.id,
                      control: c.id,
                    })}
                >
                  {c.label || c.feature || c.id}
                </button>
              {/each}
            </div>
          {/each}
        </div>
      {/if}

      <div class="device-pick">
        <div class="row-input">
          <input
            type="search"
            placeholder="Search name or control…"
            bind:value={search}
          />
          <select bind:value={deviceRoom} title="Room">
            <option value="">All rooms</option>
            {#each rooms as r (r.id)}
              <option value={r.id}>{r.label}</option>
            {/each}
          </select>
          <select bind:value={deviceFunction} title="Function">
            <option value="">All functions</option>
            {#each deviceFunctionOptions as f (f.value)}
              <option value={f.value}>{f.label}</option>
            {/each}
          </select>
          {#if onSaveDevice}
            <button
              type="button"
              class="btn btn-sm"
              onclick={() => (creatingDevice = true)}>New device…</button
            >
          {/if}
        </div>
        <ul class="list device-list">
          {#each filtered as d (d.id)}
            <li>
              <button
                type="button"
                class="row"
                class:picked={selectedDeviceId === d.id}
                onclick={() => chooseDevice(d.id)}
              >
                <span class="name">{d.name || d.id}</span>
                <span class="meta text-muted">{d.type}</span>
              </button>
            </li>
          {/each}
          {#if filtered.length === 0}
            <li class="empty text-muted">No device matches.</li>
          {/if}
        </ul>
      </div>

      {#if selectedDevice && tab === "device"}
        <div class="results">
          {#if controls.length === 0}
            <p class="empty text-muted">
              This device has no controls to offer.
            </p>
          {:else if mode === "source"}
            <div class="device-sources-list">
              {#each controls as c (c.id)}
                <button
                  type="button"
                  class="device-source"
                  title={c.stateId ?? c.feature}
                  onclick={() => pickDeviceControl(selectedDevice, c)}
                >
                  {c.label || c.feature || c.id}
                </button>
              {/each}
            </div>
          {:else}
            <ul class="list">
              {#each controls as c (c.id)}
                <li>
                  <label class="row">
                    <input
                      type="checkbox"
                      checked={mode === "slot"
                        ? selectedControls.has(c.id)
                        : pickedStates.has(c.stateId ?? c.id)}
                      onchange={() =>
                        mode === "slot"
                          ? toggleControl(c.id)
                          : toggleDeviceState(c)}
                    />
                    <span class="name">{c.label || c.feature || c.id}</span>
                    <span class="meta text-muted">{c.stateId || c.id}</span>
                    {#if c.unit}
                      <span class="meta text-muted">{c.unit}</span>
                    {/if}
                  </label>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        {#if mode === "slot"}
          <div class="actions">
            <span class="text-muted">{selectedControls.size} selected</span>
            <div class="actions-buttons">
              <button
                type="button"
                class="btn"
                disabled={!suggestions.length}
                title={suggestions.length
                  ? "Add the slots this device type suggests"
                  : "Nothing to suggest for this device"}
                onclick={addSuggested}
              >
                Add suggested{suggestions.length
                  ? ` (${suggestions.length})`
                  : ""}
              </button>
              <button
                type="button"
                class="btn btn-primary"
                disabled={selectedControls.size === 0}
                onclick={addSelected}
              >
                Add {selectedControls.size || ""}
                {selectedControls.size === 1 ? "slot" : "slots"}
              </button>
            </div>
          </div>
        {/if}
      {:else if selectedDevice && tab === "badge"}
        <div class="results">
          <div class="placeholder">
            <div class="row">
              <label class="small">
                <span class="label-mono">Shows</span>
                <select bind:value={badgeKind}>
                  <option value="value">value</option>
                  <option value="ago">time since</option>
                  <option value="offline">device offline</option>
                </select>
              </label>
              {#if badgeKind !== "offline"}
                <label class="small grow">
                  <span class="label-mono">Control</span>
                  <select bind:value={badgeControlId}>
                    <option value="">choose…</option>
                    {#each controls as c (c.id)}
                      <option value={c.id}
                        >{c.label || c.feature || c.id}</option
                      >
                    {/each}
                  </select>
                </label>
                <label class="small grow">
                  <span class="label-mono">or state</span>
                  <input
                    type="text"
                    placeholder="state id or variable"
                    bind:value={badgeState}
                  />
                </label>
              {/if}
            </div>
            <div class="actions">
              <span class="text-muted">
                {badgeKind === "offline"
                  ? "Shown while the device has no reachable state"
                  : badgeKind === "ago"
                    ? "Shown as the time since that control last reported"
                    : "Shown as that control's value in a corner"}
              </span>
              <button
                type="button"
                class="btn btn-primary"
                disabled={badgeKind !== "offline" &&
                  !badgeControlId &&
                  !badgeState.trim()}
                onclick={addBadge}>Add badge</button
              >
            </div>
          </div>
        </div>
      {/if}
    {/if}

    <div class="actions">
      {#if mode === "slot"}
        <span class="text-muted">Adds to this tile</span>
      {:else if mode === "source"}
        <span class="text-muted">Pick a control or a state</span>
      {:else if mode === "state"}
        <span class="text-muted">Pick a state</span>
      {:else}
        <span class="text-muted">{pickedStates.size} selected</span>
      {/if}
      <div class="actions-buttons">
        <button type="button" class="btn" onclick={onClose}>Cancel</button>
        {#if mode === "control"}
          <button
            type="button"
            class="btn btn-primary"
            disabled={pickedStates.size === 0 ||
              (single && pickedStates.size !== 1)}
            onclick={addPicked}
          >
            {single
              ? "Use state"
              : `Add ${pickedStates.size || ""} ${pickedStates.size === 1 ? "state" : "states"}`}
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

{#if creatingDevice && onSaveDevice}
  <div class="modal" role="dialog" aria-modal="true" aria-label="New device">
    <div class="modal-content device-modal">
      <DeviceForm
        device={null}
        objects={ioBroker.objects}
        {roomsOf}
        {rooms}
        devices={allDevices}
        onSave={saveDevice}
        onCancel={() => (creatingDevice = false)}
      />
    </div>
  </div>
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(720px, 100%);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .device-modal {
    width: min(680px, 100%);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-wrap: wrap;
  }

  .tab {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: var(--border-radius-pill);
    cursor: pointer;
  }

  .tab:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .tab.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .kind {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  .kind select {
    padding: 0.25rem;
  }

  .device-pick {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .device-list {
    max-height: 9rem;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.2rem;
  }

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 9rem;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background-color: var(--surface-container);
  }

  .row.picked {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: 0.75rem;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.25rem;
  }

  .row-input {
    display: flex;
    gap: 0.5rem;
  }

  .row-input input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem;
  }

  .row-input select {
    flex: 0 1 9rem;
    min-width: 0;
    padding: 0.35rem;
  }

  .hint-note {
    font-size: 0.75rem;
    margin: 0;
  }

  .html-input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.4;
    resize: vertical;
  }

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .device-sources {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .device-sources-label {
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .device-sources-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    max-height: 7.5rem;
    overflow: auto;
  }

  .device-source {
    border: 1px solid var(--border-color);
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: 999px;
    padding: 0.25rem 0.65rem;
    cursor: pointer;
  }

  .device-source:hover {
    border-color: var(--accent-color, #1976d2);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .actions-buttons {
    display: flex;
    gap: 0.5rem;
  }
</style>
