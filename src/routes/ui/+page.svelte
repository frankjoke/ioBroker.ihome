<script lang="ts">
  import { BREAKPOINTS } from "$lib/config/size-ops";
  import {
    UI_DEFAULTS,
    UI_LIMITS,
    effectiveUi,
    scaledTile,
  } from "$lib/config/ui-settings";
  import {
    getSettings,
    settingsSaveFailed,
    updateSettings,
  } from "$lib/stores/settings.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";

  const ui = $derived(effectiveUi(getSettings()));
  const hidePencil = $derived(getSettings().hidePencil === true);

  // One collapsible item per form; the line keeps what fits, the editor the rest.
  let openSection = $state("");

  // Local drafts: dragging a slider must not write the document on every tick.
  // They follow the document (also a change from another device); the write
  // happens on `change`, when the thumb is released.
  let primary = $state(UI_DEFAULTS.primary);
  let secondary = $state(UI_DEFAULTS.secondary);
  let scale = $state(UI_DEFAULTS.tileScale);
  $effect(() => {
    primary = ui.primary;
    secondary = ui.secondary;
    scale = ui.tileScale;
  });

  const colours = $derived([
    {
      key: "ui.pageBackground",
      label: "Page background",
      hint: "Theme default",
      value: ui.pageBackground,
    },
    {
      key: "ui.sectionBackground",
      label: "Section background",
      hint: "Transparent",
      value: ui.sectionBackground,
    },
    {
      key: "ui.tileBackground",
      label: "Tile background",
      hint: "Theme tile colour",
      value: ui.tileBackground,
    },
  ]);
  const customColours = $derived(
    colours.filter((c) => c.value !== undefined).length,
  );

  function toggle(id: string) {
    openSection = openSection === id ? "" : id;
  }

  /** The free line is a mouse convenience; controls keep their own hit areas. */
  function onLineClick(event: MouseEvent, id: string) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    toggle(id);
  }

  function set(key: string, value: unknown) {
    void updateSettings({ [key]: value });
  }
  function reset(key: string) {
    void updateSettings({ [key]: undefined });
  }
  function px(rem: number): string {
    return `${(rem * 16).toFixed(1)} px`;
  }
</script>

<svelte:head>
  <title>User Interface - iHome</title>
</svelte:head>

<div class="ui-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>User Interface</h1>
      <p class="text-muted hint">
        These defaults apply to every device using this ioBroker. A page,
        section or tile with its own background keeps it.
      </p>
    </div>
  </div>

  <div class="settings-list">
    <div class="item" class:open={openSection === "theme"}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, "theme")}>
        <Icon value="contrast" size={18} />
        <button
          type="button"
          class="name"
          aria-expanded={openSection === "theme"}
          onclick={() => toggle("theme")}>Theme</button
        >
        <span class="item-actions">
          <ThemeToggle />
        </span>
      </div>
      {#if openSection === "theme"}
        <div class="item-editor">
          <p class="hint text-muted">
            Saved in this browser only. Auto follows the ioBroker admin theme,
            then the operating system.
          </p>
        </div>
      {/if}
    </div>

    <div class="item" class:open={openSection === "editor"}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, "editor")}>
        <Icon value="edit_off" size={18} />
        <button
          type="button"
          class="name"
          aria-expanded={openSection === "editor"}
          onclick={() => toggle("editor")}>Layout editor</button
        >
        <span class="item-actions">
          <label class="check" title="Hide the layout pencil in the main bar">
            <input
              type="checkbox"
              checked={hidePencil}
              onchange={(e) =>
                void updateSettings({ hidePencil: e.currentTarget.checked })}
            />
            <span>Hide layout pencil</span>
          </label>
        </span>
      </div>
      {#if openSection === "editor"}
        <div class="item-editor">
          <p class="hint text-muted">
            Applies to every device using this ioBroker. The editor can still be
            opened with the PIN-gated shortcut (Ctrl/Cmd+click a page tab), so
            this hides the easy entrance; it is not a security boundary.
          </p>
        </div>
      {/if}
    </div>

    <div class="item" class:open={openSection === "reload"}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, "reload")}>
        <Icon value="autorenew" size={18} />
        <button
          type="button"
          class="name"
          aria-expanded={openSection === "reload"}
          onclick={() => toggle("reload")}>Automatic reload</button
        >
        <span class="item-actions">
          <input
            class="reload-input"
            type="number"
            aria-label="Reload every (minutes)"
            min={UI_LIMITS.reloadMinutes.min}
            max={UI_LIMITS.reloadMinutes.max}
            step={UI_LIMITS.reloadMinutes.step}
            value={ui.reloadMinutes}
            onchange={(e) =>
              set("ui.reloadMinutes", Number(e.currentTarget.value))}
          />
          <span class="hint text-muted">min</span>
        </span>
      </div>
      {#if openSection === "reload"}
        <div class="item-editor">
          <p class="hint text-muted">
            For a wall display that runs for days: it reloads itself on this
            interval, clearing a connection that died without an event. 0 = off.
            The count restarts whenever a config document is saved, so
            configuring never meets a reload — and it only runs while the page
            is visible, never on a config page (its edits are only in memory
            until Save).
          </p>
        </div>
      {/if}
    </div>

    <div class="item" class:open={openSection === "colours"}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, "colours")}>
        <Icon value="palette" size={18} />
        <button
          type="button"
          class="name"
          aria-expanded={openSection === "colours"}
          onclick={() => toggle("colours")}>Colours</button
        >
        <span class="meta mono">{customColours} of 3 set</span>
      </div>
      {#if openSection === "colours"}
        <div class="item-editor ui-body">
          {#each colours as c (c.key)}
            <div class="ui-row">
              <span class="label-mono row-label">{c.label}</span>
              <input
                type="color"
                aria-label={c.label}
                value={c.value ?? "#ffffff"}
                onchange={(e) => set(c.key, e.currentTarget.value)}
              />
              <button
                class="btn btn-sm"
                disabled={c.value === undefined}
                onclick={() => reset(c.key)}>Reset</button
              >
              {#if c.value === undefined}
                <span class="hint text-muted">{c.hint}</span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="item" class:open={openSection === "text"}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, "text")}>
        <Icon value="text_fields" size={18} />
        <button
          type="button"
          class="name"
          aria-expanded={openSection === "text"}
          onclick={() => toggle("text")}>Tile text</button
        >
        <span class="meta mono"
          >{primary.toFixed(2)} / {secondary.toFixed(2)} rem</span
        >
      </div>
      {#if openSection === "text"}
        <div class="item-editor ui-body">
          <div class="ui-row">
            <span class="label-mono row-label">Primary text</span>
            <input
              type="range"
              aria-label="Primary text size"
              min={UI_LIMITS.primary.min}
              max={UI_LIMITS.primary.max}
              step={UI_LIMITS.primary.step}
              value={primary}
              oninput={(e) => (primary = Number(e.currentTarget.value))}
              onchange={() => set("ui.primaryText", primary)}
            />
            <span class="ui-value mono"
              >{primary.toFixed(2)} rem
              <span class="text-muted">({px(primary)})</span></span
            >
            <button
              class="btn btn-sm"
              disabled={primary === UI_DEFAULTS.primary}
              onclick={() => reset("ui.primaryText")}>Reset</button
            >
          </div>
          <div class="ui-row">
            <span class="label-mono row-label">Secondary text</span>
            <input
              type="range"
              aria-label="Secondary text size"
              min={UI_LIMITS.secondary.min}
              max={UI_LIMITS.secondary.max}
              step={UI_LIMITS.secondary.step}
              value={secondary}
              oninput={(e) => (secondary = Number(e.currentTarget.value))}
              onchange={() => set("ui.secondaryText", secondary)}
            />
            <span class="ui-value mono"
              >{secondary.toFixed(2)} rem
              <span class="text-muted">({px(secondary)})</span></span
            >
            <button
              class="btn btn-sm"
              disabled={secondary === UI_DEFAULTS.secondary}
              onclick={() => reset("ui.secondaryText")}>Reset</button
            >
          </div>
          <div class="sample" aria-label="Text sample">
            <span
              class="sample-name"
              style:font-size={`${(primary * 12) / 14.4}rem`}
              >Kitchen light</span
            >
            <span class="sample-value mono" style:font-size={`${primary}rem`}
              >21.5<span style:font-size={`${primary * 0.8}rem`}>
                °C</span
              ></span
            >
            <span
              class="sample-secondary mono"
              style:font-size={`${secondary}rem`}>44.8 %</span
            >
          </div>
        </div>
      {/if}
    </div>

    <div class="item" class:open={openSection === "size"}>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="item-line" onclick={(e) => onLineClick(e, "size")}>
        <Icon value="grid_view" size={18} />
        <button
          type="button"
          class="name"
          aria-expanded={openSection === "size"}
          onclick={() => toggle("size")}>Tile size</button
        >
        <span class="meta mono">{Math.round(scale * 100)} %</span>
      </div>
      {#if openSection === "size"}
        <div class="item-editor ui-body">
          <div class="ui-row">
            <span class="label-mono row-label">1×1 tile scale</span>
            <input
              type="range"
              aria-label="1×1 tile scale"
              min={UI_LIMITS.tileScale.min}
              max={UI_LIMITS.tileScale.max}
              step={UI_LIMITS.tileScale.step}
              value={scale}
              oninput={(e) => (scale = Number(e.currentTarget.value))}
              onchange={() => set("ui.tileScale", scale)}
            />
            <span class="ui-value mono">{Math.round(scale * 100)} %</span>
            <button
              class="btn btn-sm"
              disabled={scale === UI_DEFAULTS.tileScale}
              onclick={() => reset("ui.tileScale")}>Reset</button
            >
          </div>
          <ul class="sizes">
            {#each BREAKPOINTS as def (def.name)}
              <li>
                <span class="label-mono row-label">{def.name}</span>
                <span class="mono"
                  >{scaledTile(def, scale).w} × {scaledTile(def, scale).h}
                  px</span
                >
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </div>

  {#if settingsSaveFailed()}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}
</div>

<style>
  .ui-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 720px;
    margin: 0 auto;
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

  .hint {
    font-size: var(--body-sm);
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .reload-input {
    width: 5.5rem;
  }

  .ui-body {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .ui-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .row-label {
    min-width: 130px;
  }

  .ui-value {
    min-width: 130px;
    font-size: var(--body-sm);
  }

  .ui-row input[type="range"] {
    flex: 1 1 220px;
    max-width: 340px;
  }

  .sample {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.15rem;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-container-lowest);
  }

  .sample-name {
    font-weight: 600;
  }

  .sample-value {
    font-weight: 800;
  }

  .sizes {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .sizes li {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }
</style>
