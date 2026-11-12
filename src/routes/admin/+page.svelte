<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getStorage } from "$lib/tools.svelte";
  import { adminPageUrl } from "$lib/transport";

  const storage = getStorage();

  /** The stored Host:Port may hold an unsaved edit; when it is empty the live
   *  broker address decides where the admin UI is. */
  const url = $derived(
    adminPageUrl({
      hostPort: storage.hostPort,
      brokerUrl: ioBroker.brokerUrl,
      cloudHost: storage.cloudHost,
      protocol: typeof location === "undefined" ? "http:" : location.protocol,
      host: typeof location === "undefined" ? "" : location.host,
    }),
  );
</script>

<svelte:head>
  <title>Admin - iHome</title>
</svelte:head>

<div class="admin-page">
  <iframe src={url} title="ioBroker Admin"></iframe>
</div>

<style>
  /* The admin UI is a full page of its own: no local heading, the bar's
     "Plugins › Admin" already names it. */
  .admin-page {
    height: calc(100vh - 70px);
    min-height: 24rem;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    background-color: var(--surface-color, #fff);
  }
</style>
