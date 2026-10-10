<script>
  import { themeStorage, setTheme } from "./theme.svelte.js";

  const modes = [
    { id: "auto", label: "Auto", icon: "brightness_auto" },
    { id: "light", label: "Light", icon: "light_mode" },
    { id: "dark", label: "Dark", icon: "dark_mode" },
  ];

  const mode = $derived(
    themeStorage.theme === "light" || themeStorage.theme === "dark"
      ? themeStorage.theme
      : "auto",
  );
</script>

<div class="theme-toggle" role="group" aria-label="Color theme">
  {#each modes as m (m.id)}
    <button
      type="button"
      class="theme-option"
      class:active={mode === m.id}
      aria-pressed={mode === m.id}
      title={`${m.label} theme`}
      onclick={() => setTheme(/** @type {any} */ (m.id))}
    >
      <span class="material-symbols-outlined">{m.icon}</span>
      <span class="theme-option-label">{m.label}</span>
    </button>
  {/each}
</div>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background-color: var(--surface-container-lowest);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
  }

  .theme-option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border: none;
    border-radius: var(--border-radius-pill);
    background-color: transparent;
    color: var(--text-muted);
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
  }

  .theme-option:hover {
    color: var(--text-color);
  }

  .theme-option.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .theme-option .material-symbols-outlined {
    font-size: 16px;
  }

  .theme-option-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  @media (max-width: 900px) {
    .theme-option-label {
      display: none;
    }
  }
</style>
