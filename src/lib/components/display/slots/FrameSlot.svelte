<script lang="ts">
  import { frameUrl } from "$lib/config/frame-url";
  import type { Slot } from "$lib/types/display";

  /**
   * A frame is a window onto another page (A38): an ioBroker web-adapter page
   * (eCharts, Energiefluss) or any URL. It fills whatever space it is given, so
   * the tile's span decides how much shows on the tile and the modal's row how
   * much in the modal.
   *
   * The stored URL is the deployed one (relative to `/ihome/`); the dev server
   * resolves it against the broker origin instead (`VITE_IOBROKER_ORIGIN`).
   */
  let { slot }: { slot: Slot } = $props();

  const url = $derived(
    typeof slot.options?.url === "string"
      ? frameUrl(slot.options.url, {
          dev: import.meta.env.DEV,
          origin:
            import.meta.env.VITE_IOBROKER_ORIGIN || "http://localhost:8082",
          pageOrigin: location.origin,
        })
      : "",
  );
</script>

{#if url}
  <!-- No sandbox: these pages need their own scripts and storage, and they run
       on their own origin — they cannot reach into the display's document. -->
  <iframe
    class="frame"
    class:inert={slot.options?.inert === true}
    src={url}
    title={slot.label || url}
  ></iframe>
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

  /* `options.inert` (A39): the page is a picture here — presses fall through to
     the surface below, so the tile keeps its long-press (its modal) and the
     modal keeps its own gestures. It cannot scroll or click the page, by design. */
  .frame.inert {
    pointer-events: none;
  }

  .empty {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
