<script lang="ts">
  // The list and editor land in the next tasks; the route exists so the
  // configuration tab is reachable.
</script>

<svelte:head>
  <title>Logic - iHome</title>
</svelte:head>

<div class="logic-page">
  <div class="page-header">
    <div class="page-heading">
      <h1>Logic</h1>
      <p class="text-muted hint">
        Automations stored in the adapter: switches, sensors and computed values
        with timers. The list arrives with the next build.
      </p>
    </div>
  </div>
</div>

<style>
  .logic-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: 720px;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-heading h1 {
    margin: 0;
  }

  .hint {
    font-size: var(--body-sm);
  }
</style>
