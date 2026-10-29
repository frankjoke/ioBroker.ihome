<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { stateIdFor } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { registerProgramStateId } from "$lib/stores/devices.svelte.js";
  import {
    placeholderKeys,
    renderHtmlDocument,
  } from "$lib/config/html-template";
  import { installHtmlBridge } from "$lib/html-bridge";
  import type { Slot } from "$lib/types/display";

  /**
   * An HTML slot is a local document, not a URL: the markup is stored in the
   * page document and rendered in a frame so its scripts, styles and document
   * scope stay its own. `allow-same-origin` keeps same-origin fetch/storage
   * working (the Samsung remote needs its WebSocket and wake call); the content
   * is authored by someone with editor access, so it is trusted like the rest
   * of the page document.
   *
   * When the slot names a state, that state's string value is the document and
   * wins over the inline text; an empty/missing state falls back to the text.
   * `{{name}}` placeholders read Global Variables (or raw dotted state ids)
   * before the document is handed to the frame.
   */
  let { slot }: { slot: Slot } = $props();

  // The frame's `ihome.*` bridge is the parent's object; install it before the
  // iframe parses its document.
  installHtmlBridge();

  const stateId = $derived(
    slot.source &&
      typeof slot.source === "object" &&
      slot.source.kind === "state"
      ? stateIdFor(slot.source.stateId, getVariables())
      : "",
  );
  const stateHtml = $derived(
    stateId ? ioBroker.states.get(stateId)?.val : undefined,
  );
  const rawHtml = $derived(
    typeof stateHtml === "string" && stateHtml.trim()
      ? stateHtml
      : typeof slot.options?.html === "string"
        ? slot.options.html
        : "",
  );

  /** Subscribe every state a placeholder names, so a raw state id fills in. */
  $effect(() => {
    for (const key of placeholderKeys(rawHtml)) {
      const variable = getVariables().find((v) => v.name === key);
      const id =
        variable?.kind === "state" && variable.stateId
          ? variable.stateId
          : key.includes(".")
            ? key
            : "";
      if (id) registerProgramStateId(id);
    }
  });

  function placeholderValue(key: string): unknown {
    const variable = getVariables().find((v) => v.name === key);
    if (variable) {
      if (variable.kind === "state" && variable.stateId) {
        return ioBroker.states.get(variable.stateId)?.val;
      }
      return variable.value;
    }
    return key.includes(".") ? ioBroker.states.get(key)?.val : undefined;
  }

  const html = $derived(renderHtmlDocument(rawHtml, placeholderValue));
</script>

{#if html.trim()}
  <iframe
    class="html-slot"
    srcdoc={html}
    title={slot.label || "HTML"}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  ></iframe>
{:else}
  <p class="empty text-muted">No HTML set — edit the slot in the pane.</p>
{/if}

<style>
  .html-slot {
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
