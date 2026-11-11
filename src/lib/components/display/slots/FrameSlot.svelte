<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { frameUrl, safeFrameUrl } from "$lib/config/frame-url";
  import { renderHtmlTemplate } from "$lib/config/html-template";
  import {
    placeholderValue,
    subscribePlaceholders,
  } from "$lib/slot-placeholders";
  import { stateIdFor } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";
  import type { Slot } from "$lib/types/display";

  /**
   * A frame is a window onto another page (A38): an ioBroker web-adapter page
   * (eCharts, Energiefluss) or any URL. It fills whatever space it is given, so
   * the tile's span decides how much shows on the tile and the modal's row how
   * much in the modal.
   *
   * The stored URL is the deployed one (relative to `/ihome/`); the dev server
   * resolves it against the broker origin instead (`VITE_IOBROKER_ORIGIN`).
   * A state source makes the URL live (e.g. a phone's map link); the fixed URL
   * is the fallback while that state is empty. A state is not editor-authored,
   * so only web URLs pass (no `javascript:`/`data:`).
   */
  let { slot }: { slot: Slot } = $props();

  const stateId = $derived(
    slot.source &&
      typeof slot.source === "object" &&
      slot.source.kind === "state"
      ? stateIdFor(slot.source.stateId, getVariables())
      : "",
  );
  const stateValue = $derived(
    stateId ? ioBroker.states.get(stateId)?.val : undefined,
  );
  const rawUrl = $derived(
    stateId && typeof stateValue === "string" && stateValue.trim()
      ? stateValue
      : typeof slot.options?.url === "string"
        ? slot.options.url
        : "",
  );
  /** Subscribe the states the URL names, so a token keeps up. */
  $effect(() => {
    subscribePlaceholders(rawUrl);
  });
  // `{{name}}` fills first, so the scheme check sees what the frame actually
  // loads, including a URL a state supplied. A missing value keeps its
  // placeholder visible (the editor's preview flags it).
  const checked = $derived(
    rawUrl.trim()
      ? safeFrameUrl(renderHtmlTemplate(rawUrl, placeholderValue))
      : "",
  );
  const url = $derived(
    checked
      ? frameUrl(checked, {
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
  <p class="empty text-muted">
    {stateId
      ? "No usable URL in this state."
      : "No page set — add a URL in the pane."}
  </p>
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
