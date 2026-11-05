<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { registerProgramStateId } from "$lib/stores/devices.svelte";
  import {
    messageToastOptions,
    parseMessagePage,
  } from "$lib/config/messages-ops";
  import { toast } from "$lib/stores/toasts.svelte";

  const messagesId = $derived(`${ioBroker.namespace}.info.messages`);
  /** -1 means “not seen yet”: the current page is skipped, never replayed. */
  let lastSeq = -1;

  $effect(() => {
    const id = messagesId;
    registerProgramStateId(id);
    if (!ioBroker.connected) {
      lastSeq = -1;
      return;
    }
    const page = parseMessagePage(ioBroker.states.get(id)?.val);
    if (!page) return;
    // The adapter restarted and its sequence began again.
    if (page.seq < lastSeq) lastSeq = 0;
    if (lastSeq < 0) {
      lastSeq = page.seq;
      return;
    }
    for (const entry of page.entries) {
      if (entry.seq <= lastSeq) continue;
      lastSeq = entry.seq;
      const options = messageToastOptions(entry);
      toast.show(entry.message, options.level, {
        sticky: options.sticky,
        timeout: options.timeout,
      });
    }
  });
</script>
