<script lang="ts">
  import type { Slot } from "$lib/types/display";

  /**
   * A frame is a window onto another page (A38): an ioBroker web-adapter page
   * (eCharts, Energiefluss) or any URL. It fills whatever space it is given, so
   * the tile's span decides how much shows on the tile and the modal's row how
   * much in the modal.
   */
  let { slot }: { slot: Slot } = $props();

  const url = $derived(
    typeof slot.options?.url === "string" ? slot.options.url : "",
  );
</script>

{#if url}
  <!-- No sandbox: these pages need their own scripts and storage, and they run
       on their own origin — they cannot reach into the display's document. -->
  <iframe class="frame" src={url} title={slot.label || url}></iframe>
{:else}
  <p class="empty text-muted">No page set — add a URL in the pane.</p>
{/if}

<style>
  .frame {
    flex: 1 1 auto;
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    border-radius: inherit;
    background: transparent;
  }

  .empty {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
