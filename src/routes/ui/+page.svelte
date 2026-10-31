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
  import ThemeToggle from "$lib/ThemeToggle.svelte";

  const ui = $derived(effectiveUi(getSettings()));
  const hidePencil = $derived(getSettings().hidePencil === true);

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

  <section class="card">
    <div class="card-header">
      <span class="material-symbols-outlined">contrast</span>
      <h2 class="card-title">Theme</h2>
    </div>
    <div class="card-body ui-body">
      <div class="ui-row">
        <span class="label-mono row-label">Colour theme</span>
        <ThemeToggle />
      </div>
      <p class="hint text-muted">
        Saved in this browser only. Auto follows the ioBroker admin theme, then
        the operating system.
      </p>
    </div>
  </section>

  <section class="card">
    <div class="card-header">
      <span class="material-symbols-outlined">edit_off</span>
      <h2 class="card-title">Layout editor</h2>
    </div>
    <div class="card-body ui-body">
      <label class="check">
        <input
          type="checkbox"
          checked={hidePencil}
          onchange={(e) =>
            void updateSettings({ hidePencil: e.currentTarget.checked })}
        />
        <span>Hide the layout pencil in the main bar</span>
      </label>
      <p class="hint text-muted">
        Applies to every device using this ioBroker. The editor can still be
        opened with the PIN-gated shortcut (Ctrl/Cmd+click a page tab), so this
        hides the easy entrance; it is not a security boundary.
      </p>
      {#if settingsSaveFailed()}
        <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
      {/if}
    </div>
  </section>

  <section class="card">
    <div class="card-header">
      <span class="material-symbols-outlined">autorenew</span>
      <h2 class="card-title">Automatic reload</h2>
    </div>
    <div class="card-body ui-body">
      <div class="ui-row">
        <label class="label-mono row-label" for="reload-minutes"
          >Reload every</label
        >
        <input
          id="reload-minutes"
          type="number"
          min={UI_LIMITS.reloadMinutes.min}
          max={UI_LIMITS.reloadMinutes.max}
          step={UI_LIMITS.reloadMinutes.step}
          value={ui.reloadMinutes}
          onchange={(e) =>
            set("ui.reloadMinutes", Number(e.currentTarget.value))}
        />
        <span class="hint text-muted">minutes — 0 = off</span>
      </div>
      <p class="hint text-muted">
        For a wall display that runs for days: it reloads itself on this
        interval, clearing a connection that died without an event. The count
        restarts whenever a config document is saved, so configuring never meets
        a reload — and it only runs while the page is visible, never on a config
        page (its edits are only in memory until Save).
      </p>
    </div>
  </section>

  <section class="card">
    <div class="card-header">
      <span class="material-symbols-outlined">palette</span>
      <h2 class="card-title">Colours</h2>
    </div>
    <div class="card-body ui-body">
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
  </section>

  <section class="card">
    <div class="card-header">
      <span class="material-symbols-outlined">text_fields</span>
      <h2 class="card-title">Tile text</h2>
    </div>
    <div class="card-body ui-body">
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
      </div>
      <div class="sample" aria-label="Text sample">
        <span
          class="sample-name"
          style:font-size={`${(primary * 12) / 14.4}rem`}>Kitchen light</span
        >
        <span class="sample-value mono" style:font-size={`${primary}rem`}
          >21.5<span style:font-size={`${primary * 0.8}rem`}> °C</span></span
        >
        <span class="sample-secondary mono" style:font-size={`${secondary}rem`}
          >44.8 %</span
        >
      </div>
    </div>
  </section>

  <section class="card">
    <div class="card-header">
      <span class="material-symbols-outlined">grid_view</span>
      <h2 class="card-title">Tile size</h2>
    </div>
    <div class="card-body ui-body">
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
      </div>
      <ul class="sizes">
        {#each BREAKPOINTS as def (def.name)}
          <li>
            <span class="label-mono row-label">{def.name}</span>
            <span class="mono"
              >{scaledTile(def, scale).w} × {scaledTile(def, scale).h} px</span
            >
          </li>
        {/each}
      </ul>
    </div>
  </section>

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

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .card-header .material-symbols-outlined {
    font-size: 18px;
    color: var(--text-muted);
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
