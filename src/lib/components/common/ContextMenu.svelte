<script lang="ts">
  interface MenuItem {
    id: string;
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    run: () => void;
  }

  let {
    x,
    y,
    items,
    label = "Actions",
    heading = "",
    onclose,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    label?: string;
    /** The target's name, shown above the items. */
    heading?: string;
    onclose: () => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let ready = $state(false);

  function place(): void {
    const node = root;
    if (!node) return;
    const pad = 8;
    const box = node.getBoundingClientRect();
    left = Math.max(pad, Math.min(x, window.innerWidth - box.width - pad));
    top = Math.max(pad, Math.min(y, window.innerHeight - box.height - pad));
    ready = true;
  }

  function enabledItems(): HTMLButtonElement[] {
    return [
      ...(root?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) ?? []),
    ];
  }

  function focusAt(index: number): void {
    const list = enabledItems();
    if (list.length === 0) return;
    list[Math.max(0, Math.min(index, list.length - 1))]?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
      return;
    }
    if (event.key === "Tab") {
      onclose();
      return;
    }
    const list = enabledItems();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusAt(at < 0 ? 0 : at + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(at < 0 ? list.length - 1 : at - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(list.length - 1);
    }
  }

  $effect(() => {
    place();
    root?.focus();
  });

  $effect(() => {
    const outside = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) onclose();
    };
    const scroll = () => onclose();
    const resize = () => onclose();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="context-menu"
  role="menu"
  aria-label={heading ? `${heading} actions` : label}
  tabindex="-1"
  bind:this={root}
  style="left: {left}px; top: {top}px; visibility: {ready
    ? 'visible'
    : 'hidden'}"
  oncontextmenu={(event) => event.preventDefault()}
>
  {#if heading}
    <p class="menu-heading">{heading}</p>
  {/if}
  {#each items as item (item.id)}
    <button
      type="button"
      role="menuitem"
      class:danger={item.danger}
      disabled={item.disabled}
      onclick={() => {
        item.run();
        onclose();
      }}
    >
      {#if item.icon}
        <span class="material-symbols-outlined" aria-hidden="true"
          >{item.icon}</span
        >
      {/if}
      <span>{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .context-menu {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 190px;
    padding: 0.25rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    background: var(--surface-color);
    box-shadow: var(--shadow-big);
  }

  .context-menu button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: 0;
    border-radius: var(--border-radius);
    background: transparent;
    color: var(--text-color);
    font: inherit;
    font-size: var(--body-md);
    text-align: left;
    cursor: pointer;
  }

  .menu-heading {
    max-width: 240px;
    margin: 0 0 2px;
    padding: 0.25rem 0.5rem 0.35rem;
    border-bottom: 1px solid var(--border-color);
    color: var(--text-muted);
    font-size: var(--body-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .context-menu button:hover:not(:disabled),
  .context-menu button:focus-visible {
    background: var(--row-hover);
  }

  .context-menu button.danger {
    color: var(--danger-color);
  }

  .context-menu button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .material-symbols-outlined {
    font-size: 18px;
  }
</style>
