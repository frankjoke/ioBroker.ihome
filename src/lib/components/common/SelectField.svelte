<script lang="ts">
  let {
    value,
    options,
    onchange,
    label,
    disabled = false,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onchange: (value: string) => void;
    label: string;
    disabled?: boolean;
  } = $props();

  const selected = $derived(
    options.find((option) => option.value === value)?.label ?? "",
  );
</script>

<span class="select-field" class:disabled>
  <span class="value" aria-hidden="true">{selected}</span>
  <span class="material-symbols-outlined chevron" aria-hidden="true"
    >expand_more</span
  >
  <select
    {value}
    {disabled}
    aria-label={label}
    onchange={(event) => onchange(event.currentTarget.value)}
  >
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</span>

<style>
  .select-field {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.2rem;
    width: 100%;
    min-width: 0;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    background: var(--surface-container-lowest);
    color: var(--text-color);
  }

  .select-field:focus-within {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  .select-field.disabled {
    opacity: 0.6;
  }

  .value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    /* The distinguishing tail of an id/label; the native popup shows it all. */
    direction: rtl;
    text-align: left;
    font-size: var(--body-sm);
  }

  .chevron {
    flex: none;
    font-size: 18px;
    color: var(--text-muted);
  }

  select {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  select:disabled {
    cursor: default;
  }
</style>
