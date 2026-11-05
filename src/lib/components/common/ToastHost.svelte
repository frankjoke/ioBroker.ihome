<script lang="ts">
  import { flip } from "svelte/animate";
  import { fly } from "svelte/transition";
  import { toast, toasts, type ToastLevel } from "$lib/stores/toasts.svelte";

  // Plain Unicode, no icon font: the controller must also work without
  // internet access to a font CDN.
  const ICONS: Record<ToastLevel, string> = {
    info: "ℹ",
    success: "✔",
    warning: "⚠",
    error: "✖",
  };
</script>

<div class="toast-host">
  {#each toasts.items as item (item.id)}
    <div
      class="toast {item.level}"
      role={item.level === "error" || item.level === "warning"
        ? "alert"
        : "status"}
      in:fly={{ y: -8, duration: 180 }}
      out:fly={{ y: -8, duration: 140 }}
      animate:flip={{ duration: 180 }}
    >
      <span class="toast-icon" aria-hidden="true">{ICONS[item.level]}</span>
      <span class="toast-message">{item.message}</span>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss"
        onclick={() => toast.dismiss(item.id)}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-host {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 56px);
    left: 50%;
    z-index: 900;
    display: grid;
    gap: 8px;
    width: min(92vw, 420px);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 8px 10px 12px;
    border: 1px solid var(--border-color);
    border-left: 3px solid var(--toast-color, var(--primary-color));
    border-radius: var(--border-radius-lg);
    background-color: var(--surface-container-high);
    color: var(--on-surface);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    font-size: var(--body-md);
    pointer-events: auto;
  }

  .toast.info {
    --toast-color: var(--primary-color);
  }

  .toast.success {
    --toast-color: var(--tertiary);
  }

  .toast.warning {
    --toast-color: var(--warning-color);
  }

  .toast.error {
    --toast-color: var(--danger-color);
  }

  .toast-icon {
    flex: 0 0 auto;
    color: var(--toast-color);
    font-size: 20px;
    font-weight: 700;
    line-height: 1;
  }

  .toast-message {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .toast-close {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--border-radius-pill);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .toast-close:hover {
    background-color: var(--surface-container-highest);
    color: var(--on-surface);
  }

  .toast-close span {
    font-size: 16px;
    line-height: 1;
  }
</style>
