<script lang="ts">
  import EnumBadge from "./EnumBadge.svelte";

  export interface MultiOption {
    value: string;
    label: string;
    icon?: string;
  }

  let {
    options,
    selected = [],
    placeholder = "Select…",
    enums = undefined,
    multiple = true,
    onChange,
  }: {
    options: MultiOption[];
    selected?: string[];
    placeholder?: string;
    enums?: any;
    multiple?: boolean;
    onChange: (values: string[]) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let root = $state<HTMLDivElement | null>(null);

  const filtered = $derived(
    query
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(query.toLowerCase()) ||
            o.value.toLowerCase().includes(query.toLowerCase()),
        )
      : options,
  );

  function toggle(value: string) {
    if (!multiple) {
      onChange(selected.includes(value) ? [] : [value]);
      return;
    }
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  function remove(value: string) {
    onChange(selected.filter((v) => v !== value));
  }

  function option(value: string): MultiOption | undefined {
    return options.find((o) => o.value === value);
  }

  function isUrl(icon?: string): boolean {
    return !!icon && (/^https?:/.test(icon) || icon.includes("/"));
  }

  function onWindowClick(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="ms" bind:this={root}>
  <div class="ms-control">
    {#each selected as value (value)}
      <span class="chip">
        {#if enums}
          <EnumBadge id={value} {enums} />
        {:else}
          {#if isUrl(option(value)?.icon)}
            <img src={option(value)?.icon} alt="" />
          {:else if option(value)?.icon}
            <span class="material-symbols-outlined">{option(value)?.icon}</span>
          {/if}
          <span class="chip-label">{option(value)?.label ?? value}</span>
        {/if}
        <button
          type="button"
          class="chip-remove"
          aria-label={`Remove ${value}`}
          onclick={(e) => {
            e.stopPropagation();
            remove(value);
          }}>&times;</button
        >
      </span>
    {/each}
    <input
      class="ms-input"
      type="text"
      bind:value={query}
      placeholder={selected.length ? "" : placeholder}
      onfocus={() => (open = true)}
      onkeydown={(e) => {
        if (e.key === "Escape") open = false;
      }}
    />
  </div>

  {#if open}
    <ul class="ms-list">
      {#each filtered as o (o.value)}
        <li>
          <button
            type="button"
            class="ms-option"
            class:active={selected.includes(o.value)}
            onclick={() => toggle(o.value)}
          >
            {#if enums}
              <EnumBadge id={o.value} {enums} />
            {:else}
              {#if isUrl(o.icon)}
                <img src={o.icon} alt="" />
              {:else if o.icon}
                <span class="material-symbols-outlined">{o.icon}</span>
              {/if}
              <span class="ms-option-label">{o.label}</span>
            {/if}
            {#if selected.includes(o.value)}
              <span class="material-symbols-outlined ms-check">check</span>
            {/if}
          </button>
        </li>
      {/each}
      {#if filtered.length === 0}
        <li class="ms-empty text-muted">No matches</li>
      {/if}
    </ul>
  {/if}
</div>

<style>
  .ms {
    position: relative;
    min-width: 0;
  }

  .ms-control {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.35rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color, #fff);
    min-height: 2.1rem;
    cursor: text;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    max-width: 100%;
  }

  .chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.1rem 0.3rem;
    background: var(--primary-container);
    color: var(--on-primary-container);
    border-radius: var(--border-radius-pill, 999px);
    font-size: 0.75rem;
  }

  .chip img,
  .ms-option img {
    width: 1em;
    height: 1em;
    object-fit: contain;
  }

  .chip .material-symbols-outlined,
  .ms-option .material-symbols-outlined {
    font-size: 15px;
  }

  .chip-remove {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0 0.1rem;
    line-height: 1;
  }

  .ms-input {
    flex: 1;
    min-width: 4rem;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-color);
    font: inherit;
    padding: 0.15rem;
  }

  .ms-list {
    position: absolute;
    z-index: 10;
    top: calc(100% + 2px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0.2rem;
    list-style: none;
    max-height: 16rem;
    overflow: auto;
    background: var(--surface-color, #fff);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    box-shadow: var(--shadow-normal, 0 4px 12px rgba(0, 0, 0, 0.15));
  }

  .ms-option {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.3rem 0.4rem;
    border: none;
    background: transparent;
    color: var(--text-color);
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--border-radius-sm, 4px);
  }

  .ms-option:hover {
    background: var(--surface-container);
  }

  .ms-option.active {
    color: var(--primary);
  }

  .ms-option-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-check {
    color: var(--primary);
  }

  .ms-empty {
    padding: 0.4rem;
    font-size: var(--body-sm);
  }
</style>
