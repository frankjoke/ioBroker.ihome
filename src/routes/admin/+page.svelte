<script lang="ts">
  import { page as route } from "$app/state";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getStorage } from "$lib/tools.svelte";
  import { adminPageUrl } from "$lib/transport";

  const storage = getStorage();

  /** The hash router keeps `?tab=` inside the hash, not in `searchParams`. */
  function adminTab(): string {
    const hash = route.url.hash;
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const tab = new URLSearchParams(query).get("tab") ?? "";
    return tab === "objects" || tab === "enums" ? tab : "overview";
  }

  /** The stored Host:Port may hold an unsaved edit; when it is empty the live
   *  broker address decides where the admin UI is. */
  const url = $derived(
    adminPageUrl({
      hostPort: storage.hostPort,
      brokerUrl: ioBroker.brokerUrl,
      cloudHost: storage.cloudHost,
      protocol: typeof location === "undefined" ? "http:" : location.protocol,
      host: typeof location === "undefined" ? "" : location.host,
      tab: adminTab(),
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
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 24rem;
  }

  iframe {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border: 0;
    background-color: var(--surface-color, #fff);
  }
</style>
