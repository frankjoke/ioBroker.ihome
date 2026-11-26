<script lang="ts">
  import Icon from "./Icon.svelte";
  import { glyphForRole } from "$lib/config/icon-ops";

  let {
    value,
    options,
    onchange,
    label,
    type = "",
    placeholder = "Role",
  }: {
    value: string;
    options: string[];
    onchange: (value: string) => void;
    label: string;
    /** The state type, used for the boolean fallback glyph. */
    type?: string;
    placeholder?: string;
  } = $props();

  const listId = $props.id();
  let open = $state(false);
  let active = $state(-1);
  let query = $state("");
  let root = $state<HTMLElement | null>(null);

  const glyph = $derived(glyphForRole(value, type) ?? "label");
  const shown = $derived.by(() => {
    const text = query.trim().toLowerCase();
    return text
      ? options.filter((role) => role.toLowerCase().includes(text))
      : options;
  });

  function pick(role: string): void {
    onchange(role);
    open = false;
    active = -1;
    query = "";
  }

  function closeOutside(event: MouseEvent): void {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      open = false;
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open = true;
      const step = event.key === "ArrowDown" ? 1 : -1;
      const count = shown.length;
      if (!count) return;
      active =
        active < 0
          ? step > 0
            ? 0
            : count - 1
          : (active + step + count) % count;
      return;
    }
    if (event.key === "Enter" && open && shown[active]) {
      event.preventDefault();
      pick(shown[active]);
    }
  }
</script>

<svelte:window onclick={closeOutside} />

<div class="role-select" bind:this={root}>
  <span class="role-icon"><Icon value={glyph} size={15} /></span>
  <input
    class="role-input"
    {value}
    {placeholder}
    aria-label={label}
    role="combobox"
    aria-expanded={open}
    aria-controls={listId}
    aria-autocomplete="list"
    aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
    spellcheck="false"
    oninput={(event) => {
      onchange(event.currentTarget.value);
      query = event.currentTarget.value;
      open = true;
      active = -1;
    }}
    onfocus={(event) => {
      event.currentTarget.select();
      query = "";
      open = true;
      active = -1;
    }}
    {onkeydown}
  />
  <button
    type="button"
    class="chevron"
    aria-label={`Toggle ${label} options`}
    onclick={() => {
      open = !open;
      active = -1;
      query = "";
    }}
  >
    <span class="material-symbols-outlined" aria-hidden="true">expand_more</span
    >
  </button>

  {#if open}
    <div class="panel">
      {#if shown.length}
        <ul id={listId} class="options" role="listbox" aria-label={label}>
          {#each shown as role, index (role)}
            <li>
              <button
                type="button"
                id={`${listId}-${index}`}
                class="option"
                class:active={index === active}
                role="option"
                aria-selected={role === value}
                onclick={() => pick(role)}
              >
                <Icon value={glyphForRole(role, type) ?? "label"} size={15} />
                <span>{role}</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint text-muted">
          No matching role — the typed value is kept.
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .role-select {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    padding: 0.2rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    background: var(--surface-container-lowest);
    color: var(--text-color);
  }

  .role-select:focus-within {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  .role-icon {
    display: flex;
    flex: none;
    color: var(--text-muted);
  }

  .role-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.1rem 0;
    border: 0;
    background: transparent;
    color: var(--text-color);
    font: inherit;
  }

  .role-input:focus {
    outline: none;
  }

  .chevron {
    display: flex;
    flex: none;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .chevron .material-symbols-outlined {
    font-size: 18px;
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 30;
    max-height: 14rem;
    overflow-y: auto;
    padding: 0.2rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    background: var(--surface-color);
    box-shadow: 0 8px 20px rgb(0 0 0 / 18%);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .option {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.3rem 0.4rem;
    border: 0;
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-color);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .option:hover,
  .option.active {
    background: var(--surface-container-low);
  }

  .option[aria-selected="true"] {
    color: var(--primary-color);
    font-weight: 600;
  }

  .panel .hint {
    margin: 0.3rem 0.4rem;
  }
</style>
