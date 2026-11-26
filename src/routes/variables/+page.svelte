<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  onMount(() => {
    void goto("#/states?tab=variables", { replaceState: true });
  });
</script>

<svelte:head>
  <title>Variables & Constants - iHome</title>
</svelte:head>

<p class="hint text-muted">Opening States → Variables…</p>
