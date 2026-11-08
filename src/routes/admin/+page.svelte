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
      protocol: typeof location === "undefined" ? "http:" : location.protocol,
      host: typeof location === "undefined" ? "" : location.host,
    }),
  );
</script>

<svelte:head>
  <title>Admin - iHome</title>
</svelte:head>

<div class="admin-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>Admin</h1>
      <span class="hint text-muted mono">{url}</span>
    </div>
    <a class="btn" href={url} target="_blank" rel="noopener">Open in new tab</a>
  </div>

  <iframe src={url} title="ioBroker Admin"></iframe>
</div>

<style>
  .admin-page {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: calc(100vh - 70px);
    min-height: 24rem;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  h1 {
    margin: 0;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  iframe {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-color, #fff);
  }
</style>
